import type { Prisma } from '@/generated/prisma/client'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { createConcurrencyLimiter } from '@/lib/bounded-concurrency'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import { NANO_BANANA_IMAGE_MODEL } from '@/lib/gemini-models'
import { hasRecoverableVideoCheckpoint } from '@/lib/generation-checkpoint-recovery'
import { getHiModelsImageModelCapability, isHiModelsImageModel, type HiModelsImageApiModel } from '@/lib/himodels-models'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { ImageProviderTimeoutError, ImageRecoveryExhaustedError, shouldUseAutomaticImageFallback, type ImageGenerationResult, type ImageProviderSwitch } from '@/lib/image-generation-recovery'
import { getImageQualityOption, normalizeImageQuality, type ImageQuality } from '@/lib/image-quality'
import { localFetch } from '@/lib/local-fetch'
import { getVisualStyleForSetup, getVisualStyleProfile, parseNovelSetup, stringifyNovelSetup, type NovelSetup } from '@/lib/novel'
import { prisma } from '@/lib/prisma'
import {
    DEFAULT_VIDEO_PROVIDER,
    getHiModelsVideoApiModel,
    getImageProviderCapability,
    getVideoProviderCapability,
    isAvailableProductionVideoProvider,
    isHiModelsVeoProvider,
    isProductionVideoProvider,
    normalizeVideoDuration,
    resolveImagePromptChannels,
    SEEDANCE_20_BASE_URL,
    SEEDANCE_20_ENDPOINT_ID,
    SEEDANCE_20_LABEL,
    SEEDANCE_25_BASE_URL,
    SEEDANCE_25_ENDPOINT_ID,
    SEEDANCE_25_LABEL,
    supportsVideoReferenceMode,
    WAN_3_LABEL,
    WAN_3_MODEL,
    WAN_3_PRIME_LABEL,
    WAN_3_PRIME_MODEL,
    WAN_3_RESOLUTION,
    type VideoReferenceMode as CapabilityVideoReferenceMode,
    type ProductionVideoProvider
} from '@/lib/provider-capabilities'
import { fetchMeteredProvider, reportProviderTokenUsage } from '@/lib/provider-token-usage.server'
import { type ReferenceGenerationProgress, type ReferenceGenerationStage, type ReferenceGenerationTimings } from '@/lib/reference-generation-progress'
import { buildSceneReferenceGenerationPrompt } from '@/lib/scene-reference-prompt'
import { resolveStoryboardActionDesc } from '@/lib/storyboard-action-plan'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'
import { formatReferenceVideoDurationViolation, getReferenceVideoDurationViolation, parseStoryboardReferenceVideos, totalReferenceVideoDuration } from '@/lib/storyboard-reference-videos'
import type { VideoLanguage } from '@/lib/video-language'
import { hasRequiredReferenceFrames, VIDEO_TIMELINE_PLAN_VERSION } from '@/lib/video-timeline-plan'
import { buildVisualStyleLock, sanitizePromptForVisualStyle } from '@/lib/visual-style-lock'
import { formatVisualStyleProfile } from '@/lib/visual-style-profile'
import { markProjectVisualsStaleInTransaction } from '@/services/content-lineage'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { clearEpisodeMergedVideoInTransaction, lockStoryboardMediaInTransaction, StaleStoryboardMutationError } from './artifacts'
import { BananaImageSafetyError, generateImageWithBanana } from './banana'
import { chargeGenerationUsage } from './billing'
import { getDashScopeConfig } from './dashscope-config'
import { extractLastFrameFromVideo, optimizeVideoForStreaming, probeMediaStreams, withFfmpegSlot } from './ffmpeg'
import {
    createHiModelsVideoTask,
    extractHiModelsUsage,
    generateHiModelsImage,
    getHiModelsVideoTask,
    HIMODELS_VEO_LABEL,
    mergeHiModelsUsage,
    type HiModelsUsage,
    type HiModelsVideoReferenceImage
} from './himodels'
import { rewriteImagePromptForSafety } from './llm'
import { saveImmutableLocalImage, saveLocalMediaFile, toLocalMediaUrl } from './local-media'
import { generateImageWithQwenImage3Pro, QWEN_IMAGE_3_PRO_MODEL, QwenImageRateLimitError } from './qwen-image'
import { createSeedanceTaskWithAssetRecovery } from './seedance-assets'
import { getSeedanceConfig } from './seedance-config'
import { generateStoryboardSubtitles } from './subtitle'
import { decodeVeoInlineVideo, extractVeoVideoResult, type VeoVideoResult } from './veo-video-result'
import { buildVideoLanguageLock, getConfiguredVideoLanguage, localizeStoryboardDialogue } from './video-language'
import { releaseModelReservations } from './wallet-reservations'
import { prepareWanVideoReferenceImage } from './wan-video-reference-image'

async function getProjectNovelSetup(projectId: bigint) {
    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true, title: true, genre: true, description: true, novelSetup: true }
    })
    if (!project) return null
    return { ...project, setup: parseNovelSetup(project.novelSetup) }
}

async function getProjectVisualStyle(projectId: bigint) {
    const project = await getProjectNovelSetup(projectId)
    const setup = project?.setup
    return getVisualStyleForSetup(setup)
}

export async function resolveCharacterReferenceRuntimePolicy(_projectId: bigint, requestedProvider?: ImageProvider) {
    return { provider: requestedProvider ?? 'banana', promptVersion: 'character-basic-v1' }
}

type ProjectVideoAspectRatio = '9:16' | '16:9' | '1:1'

function normalizeProjectVideoAspectRatio(value: string | null | undefined): ProjectVideoAspectRatio {
    if (value === '16:9' || value === '1:1') return value
    return '9:16'
}

async function getProjectVideoAspectRatio(projectId: bigint): Promise<ProjectVideoAspectRatio> {
    const project = await getProjectNovelSetup(projectId)
    return normalizeProjectVideoAspectRatio(project?.setup.videoAspectRatio)
}

async function getStoryboardVideoAspectRatio(storyboardId: bigint): Promise<ProjectVideoAspectRatio> {
    const projectId = await getStoryboardProjectId(storyboardId)
    return projectId ? getProjectVideoAspectRatio(projectId) : '9:16'
}

async function getStoryboardVisualStyle(storyboardId: bigint) {
    const row = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        select: { episode: { select: { projectId: true } } }
    })
    return row ? getProjectVisualStyle(row.episode.projectId) : getVisualStyleForSetup(undefined)
}

async function getStoryboardProjectId(storyboardId: bigint): Promise<bigint | null> {
    const row = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        select: { episode: { select: { projectId: true } } }
    })
    return row?.episode.projectId ?? null
}

interface CharacterData {
    id: bigint
    name: string
    appearancePrompt: string | null
    referenceImageUrl: string | null
    seedanceAssetId: string | null
    gender: string | null
}

interface StoryboardWithRelations {
    id: bigint
    shotType?: string | null
    imagePrompt: string | null
    negativePrompt: string | null
    videoPrompt: string | null
    motionOverride?: string | null
    fullPromptOverride?: string | null
    actionDesc: string | null
    actionPlan?: unknown
    audioPlan?: unknown
    duration: number | null
    dialogue: string | null
    narration?: string | null
    continuityMode?: string | null
    continuityGroup?: number | null
    audioUrl: string | null
    firstFrameUrl: string | null
    lastFrameUrl: string | null
    plannedLastFrameUrl?: string | null
    actualVideoEndFrameUrl?: string | null
    referenceVideoAssets?: unknown
    characters: Array<{ character: CharacterData }>
    scene: {
        id: bigint
        name?: string | null
        locationPrompt: string | null
        referenceImageUrl?: string | null
        timeOfDay?: string | null
    } | null
}

async function getModelPreference(provider: string) {
    return prisma.aiServiceConfig.findUnique({ where: { provider }, select: { modelName: true } })
}

function storageRelPath(filename: string) {
    return `/storage/${filename}`
}

function storageAbsPath(filename: string) {
    const storageRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), 'public', 'storage')
    const target = path.resolve(/* turbopackIgnore: true */ storageRoot, filename)
    const relative = path.relative(storageRoot, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid storage filename: ${filename}`)
    return target
}

function isHttpUrl(src: string) {
    return src.startsWith('/api/local-media/') || /^https?:\/\//i.test(src)
}

function isDataImageUrl(src: string) {
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(src)
}

function getStoryboardReferenceVideos(storyboard: StoryboardWithRelations) {
    return parseStoryboardReferenceVideos(storyboard.referenceVideoAssets)
}

function referenceVideoPrompt(videos: ReturnType<typeof getStoryboardReferenceVideos>) {
    if (!videos.length) return ''
    return `Use the ${videos.length} supplied reference video${videos.length > 1 ? 's' : ''} as motion, performance, camera, and timing references only. Preserve the storyboard's characters, setting, composition, and narrative action.`
}

function publicStorageAbsPath(src: string): string | null {
    const rel = src.startsWith('/') ? src.slice(1) : src
    if (!rel.startsWith('storage/')) return null
    return storageAbsPath(rel.slice('storage/'.length))
}

function imageMimeType(absPath: string) {
    const ext = path.extname(absPath).toLowerCase()
    if (ext === '.png') return 'image/png'
    if (ext === '.webp') return 'image/webp'
    if (ext === '.gif') return 'image/gif'
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    return 'image/png'
}

function localImageDataUrl(absPath: string) {
    const data = fsSync.readFileSync(/* turbopackIgnore: true */ absPath).toString('base64')
    return `data:${imageMimeType(absPath)};base64,${data}`
}

function toDashScopeImageSource(src: string | null | undefined, label: string): string | null {
    if (!src) return null
    if (isDataImageUrl(src) || isHttpUrl(src)) return src

    const absPath = publicStorageAbsPath(src)
    if (!absPath) return null
    if (!fsSync.existsSync(absPath)) {
        throw new Error(`${label} 本地文件不存在，无法转 Base64：${absPath}`)
    }
    return localImageDataUrl(absPath)
}

function redactDataUrls(value: unknown): unknown {
    if (typeof value === 'string') {
        if (!isDataImageUrl(value)) return value
        const commaIndex = value.indexOf(',')
        const prefix = commaIndex >= 0 ? value.slice(0, commaIndex + 1) : 'data:image/*;base64,'
        const encodedLength = commaIndex >= 0 ? value.length - commaIndex - 1 : 0
        return `${prefix}[omitted ${encodedLength} base64 chars]`
    }
    if (Array.isArray(value)) return value.map(item => redactDataUrls(item))
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactDataUrls(item)]))
    }
    return value
}

function stringifyRequestBodyForRecord(value: unknown) {
    return JSON.stringify(redactDataUrls(value))
}

async function downloadFile(url: string, destPath: string) {
    const res = await localFetch(url, { signal: fetchTimeoutSignal(120_000) })
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.writeFile(destPath, buffer)
    return destPath
}

// Persist generated media locally, then remove the processing copy.
// A failed save keeps the generation retryable.
async function uploadStoryboardArtifact(storyboardId: bigint, absPath: string, filename: string, kind: 'storyboards' | 'videos'): Promise<string> {
    const sb = await prisma.storyboard.findFirst({ where: { id: storyboardId }, select: { episodeId: true } })
    const subdir = sb?.episodeId ? `${kind}/${sb.episodeId}` : kind
    try {
        const mediaUrl = kind === 'storyboards' ? await saveImmutableLocalImage(absPath, subdir, filename) : await saveLocalMediaFile(absPath, subdir, filename)
        // 上传成功后清理本地临时文件（失败也不影响主流程）
        fs.unlink(absPath).catch(() => {})
        return mediaUrl
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`${kind} 保存本地素材 失败：${msg}`)
    }
}

// 把本地相对路径转为视频模型可拉取的公网 URL。没有公网 base 时返回 null，避免把 localhost 传给外部模型。
// DashScope 的本地帧图转为 data URL；Wan 提交前还会生成有尺寸和体积限制的参考图。
function toProviderImageUrl(src: string | null | undefined, provider?: VideoProvider): string | null {
    if (!src) return null
    if (isHttpUrl(src)) return provider === 'wan3' || provider === 'wan3prime' ? src : toLocalMediaUrl(src)
    const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
    if (!base || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(base)) return null
    const rel = src.startsWith('/') ? src : `/${src}`
    return `${base}${rel}`
}

async function ensureStoryboardFrameProviderUrl(
    storyboardId: bigint,
    field: 'firstFrameUrl' | 'lastFrameUrl' | 'plannedLastFrameUrl',
    src: string | null | undefined,
    provider?: VideoProvider,
    signal?: AbortSignal
): Promise<string | null> {
    if (provider === 'wan3' || provider === 'wan3prime') {
        const source = toDashScopeImageSource(src, field)
        return source ? prepareWanVideoReferenceImage(source, signal) : null
    }

    const direct = toProviderImageUrl(src, provider)
    if (direct) return direct

    if (!src) return null
    const rel = src.startsWith('/') ? src : `/${src}`
    if (!rel.startsWith('/storage/')) return null

    const filename = path.basename(rel)
    const absPath = storageAbsPath(filename)
    if (!fsSync.existsSync(absPath)) {
        throw new Error(`${field} 本地文件不存在，无法保存本地素材：${absPath}`)
    }

    try {
        const sb = await prisma.storyboard.findFirst({ where: { id: storyboardId, deletedAt: null }, select: { episodeId: true, operationVersion: true } })
        if (!sb) throw new StaleStoryboardMutationError()
        const subdir = sb?.episodeId ? `storyboards/${sb.episodeId}` : 'storyboards'
        const mediaUrl = await saveImmutableLocalImage(absPath, subdir, filename)
        const applied = await prisma.storyboard.updateMany({
            where: { id: storyboardId, deletedAt: null, operationVersion: sb.operationVersion, [field]: src },
            data: { [field]: mediaUrl }
        })
        if (applied.count !== 1) throw new StaleStoryboardMutationError()
        return toLocalMediaUrl(mediaUrl)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`${field} 保存本地素材 失败：${msg}`)
    }
}

function isBroadSceneLocation(scene: Pick<NonNullable<StoryboardWithRelations['scene']>, 'name' | 'locationPrompt'> | null | undefined) {
    const text = [scene?.name, scene?.locationPrompt].filter(Boolean).join(' ')
    if (!text.trim()) return false
    // 紧凑室内场景：强制 exact 模式（构图需要严格一致）
    const compactRoom =
        /(小房间|卧室|客厅|厨房|办公室|会议室|咖啡厅|餐厅|酒吧|车内|电梯|病房|教室|卫生间|浴室|走廊|楼梯间|small room|bedroom|office|cafe|restaurant|bar|car interior|elevator|ward|classroom|bathroom|corridor|stairwell)/i
    if (compactRoom.test(text)) return false
    // 宽阔场景：identity 模式（允许多角度，只锁风格/材质/色调）
    // 包括：户外、大型室内（宫殿/大殿/大厅）、自然景观、城市场景
    return /(天庭|御花园|花园|园林|庭院|宫殿|大殿|大厅|广场|城市|街区|街道|巷子|集市|市场|森林|树林|竹林|山|云海|战场|废墟|海边|湖畔|江边|河边|桥|码头|港口|田野|草原|沙漠|雪地|洞穴|峡谷|悬崖|屋顶|天台|阳台|露台|院子|停车场|操场|公园|寺庙|道观|祠堂|garden|palace|courtyard|plaza|square|city|street|alley|market|forest|mountain|cloud sea|battlefield|ruins|shore|riverside|bridge|dock|port|field|grassland|desert|snow|cave|canyon|cliff|rooftop|terrace|balcony|yard|parking|playground|park|temple|shrine)/i.test(
        text
    )
}

export function buildSceneReferenceGenerationPlan(
    scene: { name: string; description?: string | null; locationPrompt: string | null; timeOfDay?: string | null },
    setup: NovelSetup,
    generationNonce?: string
) {
    const style = getVisualStyleForSetup(setup)
    const styleProfile = getVisualStyleProfile(setup)
    const styleReferences = (setup.styleReferenceImages ?? []).filter(Boolean).slice(0, 1)
    const aspectRatio = normalizeProjectVideoAspectRatio(setup.videoAspectRatio)
    const prompts = buildSceneReferenceGenerationPrompt({
        scene,
        style,
        styleProfile,
        broadScene: isBroadSceneLocation(scene),
        aspectRatio,
        hasStyleReference: styleReferences.length > 0,
        generationNonce
    })
    return { ...prompts, styleReferences, aspectRatio }
}

async function buildVideoText(sb: StoryboardWithRelations, videoLanguage: VideoLanguage, provider: VideoProvider, plannedDuration = normalizeVideoDuration(provider, sb.duration)): Promise<string> {
    const body = sb.fullPromptOverride?.trim() || sb.motionOverride?.trim() || sb.videoPrompt?.trim() || sb.actionDesc?.trim() || sb.imagePrompt?.trim()
    if (!body) throw new Error('请先填写视频提示词或分镜动作')
    return [body, `Duration: ${plannedDuration} seconds.`, buildVideoLanguageLock(videoLanguage, sb.dialogue, sb.narration)].filter(Boolean).join('\n')
}

// =================== 角色参考图生成（文生图） ===================
// 当前 provider：
//   - "banana"（默认）: Google Vertex AI 的 Gemini 3.1 Flash Image (Nano Banana 2)
//   - HiModels 图片模型；"doubao" 仅作为旧配置的 Seedream 5.0 Lite 兼容别名
//   - "qwen-image-3.0-pro": 阿里百炼 Qwen-Image 3.0 Pro
// 用户可以在 settings 里设置 aiServiceConfig.provider="image" 的 modelName 来切换
export type ImageProvider = import('@/lib/provider-capabilities').ProductionImageProvider
export type { ImageQuality }

export function isImageProvider(value: unknown): value is ImageProvider {
    return value === 'banana' || value === 'doubao' || value === 'qwen-image-3.0-pro' || isHiModelsImageModel(value)
}

export function resolveImageProviderForReferences(provider: ImageProvider, referenceCount: number): ImageProvider {
    const textOnlyHiModelsImage = isHiModelsImageModel(provider) && getHiModelsImageModelCapability(provider).maxReferenceImages === 0
    return (provider === 'doubao' || textOnlyHiModelsImage) && referenceCount > 0 ? 'banana' : provider
}

export async function getImageProvider(): Promise<ImageProvider> {
    const config = await getModelPreference('image')
    const name = config?.modelName
    if (isImageProvider(name)) return name
    return 'banana' // 默认 nano-banana
}

/**
 * 统一的图像生成入口：支持多参考图（角色 + 场景 + 其他）
 * provider 可显式指定，否则用 settings 里的默认
 */
export const IMAGE_RATE_LIMIT_MAX_ATTEMPTS = 3
export const IMAGE_PROVIDER_HARD_TIMEOUT_MS = 210_000

type GenerateImageUnifiedParams = {
    prompt: string
    negativePrompt?: string
    referenceImages?: string[] // URL 或 /storage/xxx 相对路径
    outputAbsPath: string
    aspectRatio?: '1:1' | '21:9' | '16:9' | '9:16' | '4:3' | '3:4'
    provider?: ImageProvider
    quality?: ImageQuality
    automaticFallback?: boolean
    /** Keep the explicitly selected provider when false, including for references, timeouts and rate limits. */
    allowProviderSwitch?: boolean
    onProviderSwitch?: (providerSwitch: ImageProviderSwitch) => void | Promise<void>
    contentLabel?: string
    signal?: AbortSignal
}

type ImageProviderPool = 'banana' | 'himodels' | 'qwen'

function imageConcurrencyEnv(name: string, fallback: number) {
    const raw = process.env[name]?.trim()
    if (!raw) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : fallback
}

const IMAGE_PROVIDER_DEFAULT_CONCURRENCY = imageConcurrencyEnv('IMAGE_PROVIDER_CONCURRENCY', 8)
export const IMAGE_PROVIDER_CONCURRENCY_LIMITS: Readonly<Record<ImageProviderPool, number>> = {
    banana: imageConcurrencyEnv('IMAGE_PROVIDER_CONCURRENCY_BANANA', IMAGE_PROVIDER_DEFAULT_CONCURRENCY),
    himodels: imageConcurrencyEnv('IMAGE_PROVIDER_CONCURRENCY_HIMODELS', IMAGE_PROVIDER_DEFAULT_CONCURRENCY),
    qwen: imageConcurrencyEnv('IMAGE_PROVIDER_CONCURRENCY_QWEN', 5)
}
// Kept for callers that only need a bounded fan-out value. Actual provider
// calls use the isolated pools below instead of sharing one process-wide pool.
export const IMAGE_GENERATION_MAX_CONCURRENCY = Math.max(...Object.values(IMAGE_PROVIDER_CONCURRENCY_LIMITS))

const imageProviderSlots: Record<ImageProviderPool, ReturnType<typeof createConcurrencyLimiter>> = {
    banana: createConcurrencyLimiter(IMAGE_PROVIDER_CONCURRENCY_LIMITS.banana),
    himodels: createConcurrencyLimiter(IMAGE_PROVIDER_CONCURRENCY_LIMITS.himodels),
    qwen: createConcurrencyLimiter(IMAGE_PROVIDER_CONCURRENCY_LIMITS.qwen)
}

export function imageProviderPool(provider: ImageProvider): ImageProviderPool {
    if (provider === 'banana') return 'banana'
    if (provider === 'qwen-image-3.0-pro') return 'qwen'
    return 'himodels'
}

function withImageProviderSlot<T>(provider: ImageProvider, operation: () => Promise<T>) {
    return imageProviderSlots[imageProviderPool(provider)](operation)
}

function imageProviderAttemptPath(outputAbsPath: string, provider: ImageProvider) {
    const parsed = path.parse(outputAbsPath)
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return path.join(parsed.dir, `${parsed.name}.provider-${provider}-${suffix}${parsed.ext || '.png'}`)
}

/**
 * Bound the complete provider operation, including credentials, reference
 * loading, response parsing and downloads. The provider writes to an isolated
 * staging path so a request that ignores cancellation cannot overwrite a
 * successful fallback image after its deadline.
 */
async function executeImageProviderAttemptWithDeadline(params: GenerateImageUnifiedParams, provider: ImageProvider): Promise<ImageGenerationResult> {
    if (params.signal?.aborted) throw new CancelledError()

    const attemptPath = imageProviderAttemptPath(params.outputAbsPath, provider)
    const controller = new AbortController()
    let acceptResult = true
    let timeout: ReturnType<typeof setTimeout> | undefined
    let removeParentAbortListener: () => void = () => undefined

    const interruption = new Promise<never>((_, reject) => {
        const interrupt = (error: Error) => {
            if (!acceptResult) return
            acceptResult = false
            controller.abort(error)
            void fs.unlink(attemptPath).catch(() => undefined)
            reject(error)
        }

        timeout = setTimeout(() => interrupt(new ImageProviderTimeoutError(provider, IMAGE_PROVIDER_HARD_TIMEOUT_MS, params.contentLabel)), IMAGE_PROVIDER_HARD_TIMEOUT_MS)
        const onParentAbort = () => interrupt(new CancelledError())
        params.signal?.addEventListener('abort', onParentAbort, { once: true })
        removeParentAbortListener = () => params.signal?.removeEventListener('abort', onParentAbort)
    })

    const providerOperation = generateImageWithProvider({
        ...params,
        provider,
        outputAbsPath: attemptPath,
        signal: controller.signal
    })
        .then(async result => {
            if (!acceptResult) return result
            acceptResult = false
            if (fsSync.existsSync(attemptPath)) await fs.rename(attemptPath, params.outputAbsPath)
            return result
        })
        .finally(() => fs.unlink(attemptPath).catch(() => undefined))

    try {
        return await Promise.race([providerOperation, interruption])
    } finally {
        acceptResult = false
        if (timeout) clearTimeout(timeout)
        removeParentAbortListener()
    }
}

function isImageRateLimitError(error: unknown): boolean {
    if (error instanceof QwenImageRateLimitError) return true
    const message = error instanceof Error ? error.message : String(error)
    return /(?:\b429\b|Throttling\.RateQuota|RESOURCE_EXHAUSTED|rate[_ -]?limit|too many requests|请求(?:过于频繁|触发限流)|限流)/i.test(message)
}

function fallbackImageProvider(provider: ImageProvider): ImageProvider {
    return provider === 'banana' ? 'gemini-3.1-flash-image' : 'banana'
}

function imageProviderLabel(provider: ImageProvider): string {
    if (provider === 'banana') return 'Nano Banana'
    if (provider === 'qwen-image-3.0-pro') return 'Qwen-Image'
    if (isHiModelsImageModel(provider)) return getImageProviderCapability(provider)?.label ?? provider
    return 'Seedream 5.0 Lite'
}

function sleepForImageRateLimitRetry(attempt: number, signal?: AbortSignal) {
    const delayMs = attempt === 1 ? 1_000 : 2_500
    return signalSleep(delayMs, signal)
}

async function generateImageWithProvider(params: GenerateImageUnifiedParams): Promise<ImageGenerationResult> {
    const requestedProvider = params.provider ?? (await getImageProvider())
    const quality = normalizeImageQuality(params.quality)
    const qualityOption = getImageQualityOption(quality)
    const requestedRefs = [...new Set((params.referenceImages ?? []).map(reference => reference.trim()).filter(Boolean))]
    const provider = params.allowProviderSwitch === false ? requestedProvider : resolveImageProviderForReferences(requestedProvider, requestedRefs.length)
    const capability = getImageProviderCapability(provider)
    const refs = requestedRefs.slice(0, capability?.maxImageReferences ?? 0)
    const channels = resolveImagePromptChannels(provider, params.prompt, params.negativePrompt)
    const prompt = [channels.prompt, qualityOption.promptSuffix].filter(Boolean).join(', ')
    if (provider !== requestedProvider) {
        console.info(`[image] ${requestedProvider} cannot consume ${refs.length} reference image(s); automatically using Nano Banana`)
    }

    if (provider === 'banana') {
        let currentPrompt = prompt
        let lastSafetyError: BananaImageSafetyError | null = null
        let rewriteCount = 0
        let rewriteFailure: unknown = null
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await generateImageWithBanana({
                    prompt: currentPrompt,
                    outputPath: params.outputAbsPath,
                    aspectRatio: params.aspectRatio ?? '9:16',
                    referenceImages: refs,
                    quality,
                    signal: params.signal
                })
                if (attempt > 0) console.info(`[banana] image succeeded after ${attempt} safety rewrite(s)`)
                return {
                    requestedProvider,
                    initialProvider: provider,
                    actualProvider: 'banana',
                    recovery: rewriteCount > 0 ? 'safety_rewrite' : undefined,
                    safetyRewriteCount: rewriteCount,
                    referenceImagesApplied: refs.length > 0
                }
            } catch (error) {
                if (!(error instanceof BananaImageSafetyError)) throw error
                lastSafetyError = error
                if (attempt === 2) break
                console.warn(`[banana] image blocked by safety filter; rewriting prompt and retrying (${attempt + 1}/2)`)
                try {
                    currentPrompt = await rewriteImagePromptForSafety({ prompt: currentPrompt, attempt: attempt + 1 })
                    rewriteCount += 1
                } catch (rewriteError) {
                    rewriteFailure = rewriteError
                    console.warn('[banana] safety prompt rewrite failed; continuing to the configured recovery path:', rewriteError)
                    break
                }
            }
        }

        const fallbackEligible = params.allowProviderSwitch !== false && shouldUseAutomaticImageFallback(lastSafetyError, provider, params.automaticFallback === true)
        if (fallbackEligible) {
            const fallbackProvider: ImageProvider = 'gemini-3.1-flash-image'
            console.warn(`[image] Nano Banana safety recovery exhausted; automatically trying ${fallbackProvider}`)
            try {
                const fallbackResult = await withImageProviderSlot(fallbackProvider, () =>
                    generateHiModelsImage({
                        model: 'gemini-3.1-flash-image',
                        prompt: currentPrompt,
                        outputPath: params.outputAbsPath,
                        aspectRatio: params.aspectRatio,
                        imageSize: quality === 'ultra' ? '4K' : quality === 'clear' ? '2K' : '1K',
                        referenceImages: refs,
                        signal: params.signal
                    })
                )
                return {
                    requestedProvider,
                    initialProvider: provider,
                    actualProvider: fallbackProvider,
                    recovery: 'fallback_provider',
                    safetyRewriteCount: rewriteCount,
                    referenceImagesApplied: fallbackResult.referenceImagesApplied,
                    fallbackReason: lastSafetyError?.message ?? 'BANANA_IMAGE_SAFETY',
                    usage: fallbackResult.usage
                }
            } catch (fallbackError) {
                const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                throw new ImageRecoveryExhaustedError(
                    `图片自动恢复失败：Nano Banana 在安全改写后仍未返回图片，备用模型 ${fallbackProvider} 也未完成生成：${fallbackMessage}`,
                    {
                        requestedProvider,
                        initialProvider: provider,
                        fallbackProvider,
                        safetyRewriteCount: rewriteCount,
                        bananaReason: lastSafetyError?.message,
                        fallbackReason: fallbackMessage
                    },
                    { cause: fallbackError }
                )
            }
        }

        const rewriteFailureMessage = rewriteFailure ? `；自动改写失败：${rewriteFailure instanceof Error ? rewriteFailure.message : String(rewriteFailure)}` : ''
        throw new Error(`图片在自动安全改写后仍被拦截：${lastSafetyError?.message ?? 'IMAGE_SAFETY'}${rewriteFailureMessage}`, { cause: lastSafetyError })
    }

    if (provider === 'qwen-image-3.0-pro') {
        const { apiKey, baseUrl } = await getDashScopeRuntimeConfig()
        const qwenAspectRatio = params.aspectRatio === '21:9' ? '16:9' : (params.aspectRatio ?? '9:16')
        const result = await generateImageWithQwenImage3Pro({
            prompt,
            negativePrompt: channels.negativePrompt,
            referenceImages: refs,
            outputPath: params.outputAbsPath,
            aspectRatio: qwenAspectRatio,
            quality,
            apiKey,
            baseUrl,
            signal: params.signal
        })
        return {
            requestedProvider,
            initialProvider: provider,
            actualProvider: 'qwen-image-3.0-pro',
            safetyRewriteCount: 0,
            referenceImagesApplied: result.referenceImagesApplied
        }
    }

    const model: HiModelsImageApiModel = provider === 'doubao' ? 'seedream-5-0-lite' : provider
    const result = await generateHiModelsImage({
        model,
        prompt,
        outputPath: params.outputAbsPath,
        aspectRatio: params.aspectRatio,
        imageSize: quality === 'ultra' ? '4K' : quality === 'clear' ? '2K' : '1K',
        referenceImages: refs,
        signal: params.signal
    })
    return {
        requestedProvider,
        initialProvider: provider,
        actualProvider: provider,
        safetyRewriteCount: 0,
        referenceImagesApplied: result.referenceImagesApplied,
        usage: result.usage
    }
}

/**
 * Queue only against the selected upstream provider. Waiting work for Banana,
 * HiModels and Qwen cannot block one another, and the provider timeout starts
 * only after this process has acquired an execution slot.
 */
function generateImageProviderAttemptWithDeadline(params: GenerateImageUnifiedParams, provider: ImageProvider): Promise<ImageGenerationResult> {
    return withImageProviderSlot(provider, () => executeImageProviderAttemptWithDeadline(params, provider))
}

async function generateImageWithRateLimitRecovery(params: GenerateImageUnifiedParams): Promise<ImageGenerationResult> {
    const requestedProvider = params.provider ?? (await getImageProvider())
    const allowProviderSwitch = params.allowProviderSwitch !== false
    const initialProvider = allowProviderSwitch ? resolveImageProviderForReferences(requestedProvider, (params.referenceImages ?? []).filter(Boolean).length) : requestedProvider
    let lastRateLimitError: unknown
    let timeoutError: ImageProviderTimeoutError | undefined

    for (let attempt = 1; attempt <= IMAGE_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
        try {
            const result = await generateImageProviderAttemptWithDeadline(params, initialProvider)
            return requestedProvider === initialProvider ? result : { ...result, requestedProvider }
        } catch (error) {
            if (error instanceof ImageProviderTimeoutError) {
                timeoutError = error
                break
            }
            if (!isImageRateLimitError(error)) throw error
            lastRateLimitError = error
            if (attempt < IMAGE_RATE_LIMIT_MAX_ATTEMPTS) {
                console.warn(`[image] ${imageProviderLabel(initialProvider)} rate limited; retrying current content (${attempt}/${IMAGE_RATE_LIMIT_MAX_ATTEMPTS})`)
                await sleepForImageRateLimitRetry(attempt, params.signal)
            }
        }
    }

    const recoveryError = timeoutError ?? lastRateLimitError
    if (!allowProviderSwitch) throw recoveryError

    const fallbackProvider = fallbackImageProvider(initialProvider)
    const timedOut = !!timeoutError
    const providerSwitch: ImageProviderSwitch = {
        from: initialProvider,
        to: fallbackProvider,
        reason: timedOut
            ? `${imageProviderLabel(initialProvider)} timed out after ${IMAGE_PROVIDER_HARD_TIMEOUT_MS}ms`
            : `${imageProviderLabel(initialProvider)} 429 after ${IMAGE_RATE_LIMIT_MAX_ATTEMPTS} attempts`,
        status: timedOut ? 408 : 429,
        attempts: timedOut ? 1 : IMAGE_RATE_LIMIT_MAX_ATTEMPTS,
        contentLabel: params.contentLabel
    }
    if (timedOut) {
        console.warn(
            `[image] ${imageProviderLabel(initialProvider)} timed out after ${IMAGE_PROVIDER_HARD_TIMEOUT_MS}ms; switching only the current content${params.contentLabel ? ` (${params.contentLabel})` : ''} to ${imageProviderLabel(fallbackProvider)}`
        )
    } else {
        console.warn(
            `[image] ${imageProviderLabel(initialProvider)} remained rate limited after ${IMAGE_RATE_LIMIT_MAX_ATTEMPTS} attempts; switching only the current content${params.contentLabel ? ` (${params.contentLabel})` : ''} to ${imageProviderLabel(fallbackProvider)}`
        )
    }
    await params.onProviderSwitch?.(providerSwitch)

    try {
        const fallbackResult = await generateImageWithRateLimitRecovery({
            ...params,
            provider: fallbackProvider,
            allowProviderSwitch: false,
            onProviderSwitch: undefined
        })
        return {
            ...fallbackResult,
            requestedProvider,
            initialProvider,
            recovery: 'fallback_provider',
            fallbackReason: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            providerSwitch
        }
    } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        const initialFailure = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        throw new ImageRecoveryExhaustedError(
            timedOut
                ? `图片自动切换失败：当前图片生成超时，备用通道也未完成生成：${fallbackMessage}`
                : `图片自动切换失败：当前图片连续 ${IMAGE_RATE_LIMIT_MAX_ATTEMPTS} 次触发限流，备用通道也未完成生成：${fallbackMessage}`,
            {
                requestedProvider,
                initialProvider,
                fallbackProvider,
                ...(timedOut ? { timeoutReason: initialFailure, timeoutMs: IMAGE_PROVIDER_HARD_TIMEOUT_MS } : { rateLimitReason: initialFailure }),
                fallbackReason: fallbackMessage
            },
            { cause: fallbackError }
        )
    }
}

export async function generateImageUnified(params: GenerateImageUnifiedParams): Promise<ImageGenerationResult> {
    return generateImageWithRateLimitRecovery(params)
}

export async function generateProjectStyleReference(
    projectId: bigint,
    opts: { provider?: ImageProvider; quality?: ImageQuality; beforeSave?: (tx: Prisma.TransactionClient, generation: ImageGenerationResult) => Promise<unknown> } = {}
): Promise<GeneratedReferenceImage> {
    const project = await getProjectNovelSetup(projectId)
    if (!project) throw new Error('Project not found')

    const style = getVisualStyleForSetup(project.setup)
    const styleProfile = getVisualStyleProfile(project.setup)
    const styleLock = buildVisualStyleLock(style)
    const filename = `style_ref_${projectId}_${Date.now()}.png`
    const absPath = storageAbsPath(filename)
    const extraPrompt = project.setup.styleReferencePrompt?.trim()
    const prompt = [
        style.imagePromptPrefix,
        formatVisualStyleProfile(styleProfile),
        styleLock.positive,
        `art direction reference board for the short drama "${project.title}"`,
        project.genre ? `story category (project style remains authoritative): ${sanitizePromptForVisualStyle(project.genre, style)}` : null,
        project.description ? `story mood and subject only: ${sanitizePromptForVisualStyle(project.description, style)}` : null,
        extraPrompt ? `additional subject and mood direction: ${sanitizePromptForVisualStyle(extraPrompt, style)}` : null,
        'show the final visual language only: character rendering style, color palette, lighting, linework or material texture, cinematic vertical drama composition',
        'single coherent style guide image, no text, no logo, no watermark, no UI, no split-screen labels'
    ]
        .filter(Boolean)
        .join(', ')

    const generation = await generateImageUnified({
        prompt,
        negativePrompt: styleLock.negative,
        outputAbsPath: absPath,
        aspectRatio: normalizeProjectVideoAspectRatio(project.setup.videoAspectRatio),
        provider: opts.provider,
        quality: opts.quality,
        contentLabel: `项目“${project.title}”风格参考图`
    })

    let mediaUrl: string
    try {
        mediaUrl = await saveImmutableLocalImage(absPath, `style/${projectId}`, filename)
    } catch (err) {
        throw new Error(`风格参考图保存本地素材 失败：${err instanceof Error ? err.message : String(err)}`)
    }

    await prisma.$transaction(async tx => {
        const current = await tx.project.findUnique({ where: { id: projectId }, select: { novelSetup: true } })
        const currentSetup = parseNovelSetup(current?.novelSetup)
        const styleReferenceImages = [...new Set([...(currentSetup.styleReferenceImages ?? []), mediaUrl])].slice(-4)
        await opts.beforeSave?.(tx, generation)
        await tx.project.update({
            where: { id: projectId },
            data: {
                novelSetup: stringifyNovelSetup({ ...currentSetup, styleReferenceImages }),
                sourceVersion: { increment: 1 }
            }
        })
        await markProjectVisualsStaleInTransaction(tx, projectId, 'AI 风格参考图已追加，请重新生成视觉资产')
    }, BILLING_TRANSACTION_OPTIONS)

    return { url: mediaUrl, generation }
}

export type CharacterReferenceRole = 'full_body'
export type GeneratedReferenceImage = { url: string; generation: ImageGenerationResult }

export async function generateCharacterReference(
    characterId: bigint,
    opts: {
        commit?: boolean
        provider?: ImageProvider
        quality?: ImageQuality
        role?: CharacterReferenceRole
        generationNonce?: string
        onProgress?: (progress: ReferenceGenerationProgress) => void | Promise<void>
    } = {}
): Promise<GeneratedReferenceImage> {
    if (opts.role && opts.role !== 'full_body') throw new Error('基础版支持单张全身角色参考图')
    const character = await prisma.character.findFirst({ where: { id: characterId, deletedAt: null } })
    if (!character) throw new Error('Character not found')
    if (!character.appearancePrompt?.trim()) throw new Error('Character has no appearance prompt')
    const startedAt = Date.now()
    const timings: ReferenceGenerationTimings = { generationMs: 0, inspectionMs: 0, uploadMs: 0, totalMs: 0, retryCount: 0 }
    const reportProgress = async (stage: ReferenceGenerationStage) => {
        await opts.onProgress?.({ stage, attempt: 1, maxAttempts: 1, timings: { ...timings, totalMs: Date.now() - startedAt } })
    }
    const style = await getProjectVisualStyle(character.projectId)
    const generationSuffix = opts.generationNonce?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36) || String(Date.now())
    const filename = `char_ref_${characterId}_${Date.now()}_${generationSuffix}.png`
    const absPath = storageAbsPath(filename)
    await reportProgress('generating')
    const generation = await generateImageUnified({
        prompt: `Single full-body character reference, front view, plain background. ${character.appearancePrompt}. Style: ${style.label}.`,
        negativePrompt: 'text, watermark',
        referenceImages: [],
        outputAbsPath: absPath,
        aspectRatio: '3:4',
        provider: opts.provider,
        quality: normalizeImageQuality(opts.quality),
        automaticFallback: false,
        allowProviderSwitch: false,
        contentLabel: `角色“${character.name}”参考图`
    })
    timings.generationMs = Date.now() - startedAt
    await reportProgress('uploading')
    const uploadStartedAt = Date.now()
    const mediaUrl = await saveImmutableLocalImage(absPath, `characters/${character.projectId}`, filename)
    timings.uploadMs = Date.now() - uploadStartedAt
    await reportProgress('writing_db')
    if (opts.commit ?? true) {
        await prisma.character.update({ where: { id: characterId }, data: { referenceImageUrl: mediaUrl } })
    }
    return { url: mediaUrl, generation }
}

/**
 * 场景参考图生成
 */
export async function generateSceneReference(
    sceneId: bigint,
    opts: {
        commit?: boolean
        provider?: ImageProvider
        quality?: ImageQuality
        generationNonce?: string
        onProgress?: (progress: ReferenceGenerationProgress) => void | Promise<void>
    } = {}
): Promise<GeneratedReferenceImage> {
    const startedAt = Date.now()
    let providerSwitch: ImageProviderSwitch | undefined
    const timings: ReferenceGenerationTimings = {
        generationMs: 0,
        inspectionMs: 0,
        uploadMs: 0,
        totalMs: 0,
        retryCount: 0
    }
    const reportProgress = async (stage: ReferenceGenerationStage, attempt: number) => {
        if (!opts.onProgress) return
        await opts.onProgress({
            stage,
            attempt,
            maxAttempts: 1,
            timings: { ...timings, totalMs: Date.now() - startedAt },
            providerSwitch
        })
    }
    const scene = await prisma.scene.findFirst({ where: { id: sceneId, deletedAt: null } })
    if (!scene) throw new Error('Scene not found')
    if (!scene.locationPrompt) throw new Error('Scene has no locationPrompt')

    const generationSuffix = opts.generationNonce?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36) || String(Date.now())
    const filename = `scene_ref_${sceneId}_${Date.now()}_${generationSuffix}.png`
    const absPath = storageAbsPath(filename)

    const project = await getProjectNovelSetup(scene.projectId)
    if (!project) throw new Error('Project not found')
    // Multiple style-board references often make image models return a
    // contact sheet/collage instead of one reusable location master.
    const scenePlan = buildSceneReferenceGenerationPlan(scene, project.setup, opts.generationNonce)

    let imageGenerationResult: ImageGenerationResult | null = null
    await reportProgress('generating', 1)
    const generationStartedAt = Date.now()
    try {
        imageGenerationResult = await generateImageUnified({
            prompt: scenePlan.prompt,
            negativePrompt: scenePlan.negativePrompt,
            referenceImages: scenePlan.styleReferences,
            outputAbsPath: absPath,
            aspectRatio: scenePlan.aspectRatio,
            provider: opts.provider,
            quality: opts.quality,
            automaticFallback: true,
            contentLabel: `场景“${scene.name}”参考图`,
            onProviderSwitch: async nextProviderSwitch => {
                providerSwitch = nextProviderSwitch
                await reportProgress('generating', 1)
            }
        })
    } finally {
        timings.generationMs += Date.now() - generationStartedAt
    }

    await reportProgress('uploading', 1)
    let mediaUrl: string
    const uploadStartedAt = Date.now()
    try {
        mediaUrl = await saveImmutableLocalImage(absPath, `scenes/${scene.projectId}`, filename)
    } catch (err) {
        throw new Error(`场景参考图保存本地素材 失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
        timings.uploadMs += Date.now() - uploadStartedAt
    }

    await reportProgress('writing_db', 1)
    if (opts.commit ?? true) {
        await prisma.scene.update({
            where: { id: sceneId },
            data: { referenceImageUrl: mediaUrl }
        })
    }
    if (!imageGenerationResult) throw new Error('场景参考图生成完成但缺少模型结果')
    return { url: mediaUrl, generation: imageGenerationResult }
}

// =================== 分镜视频生成（Seedance） ===================
// 文本 + 角色参考图 → 带音效的视频（一步到位）
export type VideoProvider = ProductionVideoProvider
export type VideoReferenceMode = CapabilityVideoReferenceMode
export const VIDEO_PROMPT_VERSION = 'video-basic-v1'

/**
 * 选择视频 provider：优先 opts，其次项目/全局默认（settings 里 provider="video" 的 modelName）
 */
async function getVideoProvider(opts?: { provider?: VideoProvider }): Promise<VideoProvider> {
    if (opts?.provider) {
        if (!isAvailableProductionVideoProvider(opts.provider)) throw new Error('不支持的视频模型')
        return opts.provider
    }
    const cfg = await getModelPreference('video')
    if (isAvailableProductionVideoProvider(cfg?.modelName)) return cfg.modelName
    return DEFAULT_VIDEO_PROVIDER
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export class CancelledError extends Error {
    constructor(message = '已取消') {
        super(message)
        this.name = 'CancelledError'
    }
}

export function isCancelledError(err: unknown): boolean {
    return err instanceof Error && (err.name === 'CancelledError' || err.name === 'AbortError')
}

function signalSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new CancelledError())
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(timer)
            reject(new CancelledError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

function normalizeDashScopeError(body: string, label = 'DashScope') {
    try {
        const parsed = JSON.parse(body)
        const code = parsed?.code
        const message = parsed?.message
        if (code === 'Throttling.RateQuota') {
            return `${label} 请求触发限流：当前账号视频生成 QPS/并发额度已满，请稍后再试，或减少同时生成的视频任务。`
        }
        if (code === 'InvalidParameter' && typeof message === 'string' && message.toLowerCase().includes('url')) {
            return `${label} 图片 URL 校验失败：${message}`
        }
        return `${label} create error: ${message ? `${code ? `${code}: ` : ''}${message}` : body}`
    } catch {
        if (body.includes('Throttling.RateQuota')) return `${label} 请求触发限流：当前账号视频生成 QPS/并发额度已满，请稍后再试，或减少同时生成的视频任务。`
        return `${label} create error: ${body}`
    }
}

async function createDashScopeVideoTask(baseUrl: string, apiKey: string, requestBody: Record<string, unknown>, endpointPath: string, inputVideoDuration = 0, label = 'DashScope') {
    const retryDelays = [8000, 20000]
    let lastBody = ''
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        const url = `${baseUrl}${endpointPath}`
        const sentAt = new Date().toISOString()
        const createRes = await fetchMeteredProvider(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'X-DashScope-Async': 'enable'
                },
                body: JSON.stringify(requestBody),
                signal: fetchTimeoutSignal(60_000)
            },
            {
                provider: 'qwen',
                model: String(requestBody.model),
                billingRequestBody: inputVideoDuration > 0 ? { ...requestBody, input_video_duration: inputVideoDuration } : requestBody
            }
        )
        lastBody = await createRes.text()
        let payload: unknown = lastBody
        try {
            payload = lastBody ? JSON.parse(lastBody) : {}
        } catch {}
        const taskId = typeof payload === 'object' && payload !== null && 'output' in payload ? (payload as { output?: { task_id?: unknown } }).output?.task_id : undefined
        await reportProviderTokenUsage({
            provider: 'qwen',
            model: typeof requestBody.model === 'string' ? requestBody.model : 'dashscope-video',
            endpoint: endpointPath,
            response: createRes,
            payload,
            sentAt,
            operationKey: typeof taskId === 'string' ? `dashscope-video:${taskId}` : undefined
        })
        if (createRes.ok) {
            if (typeof taskId !== 'string' || !taskId.trim()) throw new Error(`${label} 创建响应未返回有效任务 ID`)
            return { output: { task_id: taskId } }
        }

        const isRateLimited = createRes.status === 429 || lastBody.includes('Throttling.RateQuota')
        if (!isRateLimited || attempt === retryDelays.length) break
        await sleep(retryDelays[attempt])
    }
    throw new Error(normalizeDashScopeError(lastBody, label))
}

async function completeVideoGeneration(
    generationId: bigint,
    storyboardId: bigint,
    relPath: string,
    patch: { taskId?: string; requestBody?: string; comparisonOnly?: boolean; metrics?: Record<string, unknown> } = {}
) {
    if (!(await isGenerationProcessing(generationId))) return
    const snapshot = await prisma.generation.findUnique({
        where: { id: generationId },
        select: { resourceVersion: true, metrics: true }
    })
    const storyboardSnapshot = await prisma.storyboard.findUnique({
        where: { id: storyboardId },
        select: {
            episodeId: true,
            operationVersion: true,
            deletedAt: true
        }
    })
    if (!snapshot || !storyboardSnapshot || storyboardSnapshot.deletedAt || snapshot.resourceVersion !== storyboardSnapshot.operationVersion) {
        await cancelStaleGeneration(generationId)
        return
    }
    const { comparisonOnly = false, metrics: patchMetrics, ...generationPatch } = patch
    const filename = path.basename(relPath)
    const absPath = storageAbsPath(filename)

    // 第三方任务返回 completed 不代表下载到的是可播放视频。必须在保存本地素材、写入
    // storyboard.videoUrl 之前检查文件大小和真实时长，否则前端会看到“已完成但 0:00”。
    const stat = await fs.stat(absPath).catch(() => null)
    if (!stat || stat.size < 1024) {
        throw new Error(`视频文件无效：文件不存在或大小异常（${stat?.size ?? 0} bytes）`)
    }
    const mediaStreams = await withFfmpegSlot(() => probeMediaStreams(absPath))
    const duration = mediaStreams.duration
    if (!mediaStreams.hasVideo || !Number.isFinite(duration) || duration <= 0.05) {
        throw new Error(`视频文件无效：未检测到视频流或时长为 0（${duration.toFixed(3)}s）`)
    }

    // 第三方返回的视频可能把 moov 索引放在文件末尾，先做 faststart 重封装，
    // 否则浏览器播放前需要下载整个视频，看起来像“加载很慢”。
    await withFfmpegSlot(() => optimizeVideoForStreaming(absPath)).catch(err => console.warn('[ffmpeg] faststart skipped:', err instanceof Error ? err.message : err))

    const existingMetrics = snapshot.metrics && typeof snapshot.metrics === 'object' && !Array.isArray(snapshot.metrics) ? snapshot.metrics : {}
    const mergedMetrics = patchMetrics ? ({ ...existingMetrics, ...patchMetrics } as Prisma.InputJsonValue) : undefined

    // 保存本地素材 之前从结尾 0.5 秒多候选中择优抽取清晰末帧（需要本地文件），
    // 然后再上传（上传成功会删本地）。
    // 抽帧本身失败不阻塞主流程，只是丢锚点。
    const localEndFrameRelPath = comparisonOnly ? null : await withFfmpegSlot(() => extractLastFrameFromVideo(relPath)).catch(() => null)

    // Persist the generated file before atomically completing the task.
    const finalUrl = await uploadStoryboardArtifact(storyboardId, absPath, filename, 'videos')

    // Subtitle generation is part of this operation and must finish before its
    // cost is settled. A detached continuation could otherwise escape billing.
    await generateStoryboardSubtitles(storyboardId).catch(err => console.warn('[subtitle] generation failed:', err instanceof Error ? err.message : err))
    const applied = await prisma.$transaction(async tx => {
        await lockStoryboardMediaInTransaction(tx, { id: storyboardId, ...storyboardSnapshot })
        const generation = await tx.generation.updateMany({
            where: { id: generationId, status: 'processing', resourceVersion: storyboardSnapshot.operationVersion },
            data: {
                status: 'completed',
                activeKey: null,
                resultUrl: finalUrl,
                actualDuration: duration,
                leaseOwner: null,
                leaseExpiresAt: null,
                ...(mergedMetrics ? { metrics: mergedMetrics } : {}),
                ...generationPatch
            }
        })
        if (generation.count !== 1) return false
        await chargeGenerationUsage(generationId, tx, duration)
        if (comparisonOnly) return true
        const target = await tx.storyboard.updateMany({
            where: { id: storyboardId, deletedAt: null, operationVersion: storyboardSnapshot.operationVersion },
            data: { videoUrl: finalUrl, videoStatus: 'completed', composedVideoUrl: null, composeStatus: 'pending' }
        })
        if (target.count !== 1) throw new Error('STALE_GENERATION_RESULT')
        await clearEpisodeMergedVideoInTransaction(tx, storyboardSnapshot.episodeId)
        return true
    }, BILLING_TRANSACTION_OPTIONS)
    if (!applied || comparisonOnly) return

    // 保存本镜视频的实际末帧。对 continuous/seamless 后继镜头，这是唯一
    // 允许的像素连续锚点；抽帧失败不会推翻本镜视频，但会硬阻断后继镜头。
    if (localEndFrameRelPath) {
        const endFrameFilename = path.basename(localEndFrameRelPath)
        const endFrameAbsPath = storageAbsPath(endFrameFilename)
        try {
            const endFrameMediaUrl = await uploadStoryboardArtifact(storyboardId, endFrameAbsPath, endFrameFilename, 'storyboards')
            await prisma.storyboard.updateMany({
                where: { id: storyboardId, operationVersion: storyboardSnapshot.operationVersion, deletedAt: null },
                data: { actualVideoEndFrameUrl: endFrameMediaUrl }
            })
        } catch (err) {
            // 末帧锚点失败不推翻已经成功的视频，但需要在返回前结束尝试，
            // 以免批量流程下一镜在上传尚未完成时错误地判定“没有连续性锚点”。
            console.warn('[ffmpeg] end frame upload failed:', err instanceof Error ? err.message : err)
        }
    }
}

async function failVideoGeneration(generationId: bigint, storyboardId: bigint, err: unknown, label: string, comparisonOnly = false) {
    const msg = err instanceof Error ? err.message : String(err)
    const cancelled = isCancelledError(err)
    const [generationSnapshot, storyboardSnapshot] = await Promise.all([
        prisma.generation.findUnique({ where: { id: generationId }, select: { status: true, resourceVersion: true } }),
        prisma.storyboard.findUnique({ where: { id: storyboardId }, select: { operationVersion: true, deletedAt: true } })
    ])
    if (!generationSnapshot || generationSnapshot.status !== 'processing') {
        if (cancelled) throw err
        return
    }
    if (!storyboardSnapshot || storyboardSnapshot.deletedAt || generationSnapshot.resourceVersion !== storyboardSnapshot.operationVersion) {
        await cancelStaleGeneration(generationId)
        if (cancelled) throw err
        return
    }
    await prisma.generation.updateMany({
        where: { id: generationId, status: 'processing', resourceVersion: storyboardSnapshot.operationVersion },
        data: { status: cancelled ? 'cancelled' : 'failed', activeKey: null, errorMsg: msg, leaseOwner: null, leaseExpiresAt: null }
    })
    if (!comparisonOnly) {
        await prisma.storyboard.updateMany({
            where: { id: storyboardId, deletedAt: null, operationVersion: storyboardSnapshot.operationVersion },
            data: { videoStatus: cancelled ? 'pending' : 'failed' }
        })
    }
    if (!cancelled) console.error(`[${label}] generate failed:`, msg)
    if (cancelled) throw err
}

export async function generateVideo(...args: Parameters<typeof generateVideoWithUsage>) {
    const owner = await prisma.generation.findUnique({ where: { id: args[0] }, select: { storyboard: { select: { episode: { select: { project: { select: { userId: true } } } } } } } })
    return withHiModelsUsageScope({ userId: owner?.storyboard.episode.project.userId, generationId: args[0].toString() }, async () => {
        try {
            return await generateVideoWithUsage(...args)
        } finally {
            const result = await prisma.generation.findUnique({ where: { id: args[0] }, select: { status: true } })
            if (result && ['failed', 'cancelled'].includes(result.status ?? '')) await releaseModelReservations(`generation:${args[0]}`)
        }
    })
}

async function generateVideoWithUsage(
    generationId: bigint,
    storyboard: StoryboardWithRelations,
    opts?: { provider?: VideoProvider; referenceMode?: VideoReferenceMode; signal?: AbortSignal; videoLanguage?: VideoLanguage; comparisonOnly?: boolean }
) {
    try {
        const provider = await getVideoProvider(opts)
        const providerCapability = getVideoProviderCapability(provider)
        const storyboardReferenceVideos = getStoryboardReferenceVideos(storyboard)
        if (!providerCapability || storyboardReferenceVideos.length > providerCapability.maxVideoReferences) {
            throw new Error(
                providerCapability?.maxVideoReferences
                    ? `${providerCapability.label} 最多支持 ${providerCapability.maxVideoReferences} 个参考视频`
                    : `${providerCapability?.label ?? provider} 不支持视频作为参考素材`
            )
        }
        const referenceVideoDurationViolation = getReferenceVideoDurationViolation(storyboardReferenceVideos, providerCapability.referenceVideoDuration)
        if (referenceVideoDurationViolation) {
            throw new Error(formatReferenceVideoDurationViolation(providerCapability.label, referenceVideoDurationViolation))
        }
        const videoLanguage = opts?.videoLanguage ?? (await getConfiguredVideoLanguage())
        const [localizedDialogue, localizedNarration] = await Promise.all([
            localizeStoryboardDialogue(storyboard.dialogue, videoLanguage),
            localizeStoryboardDialogue(storyboard.narration, videoLanguage)
        ])
        const localizedStoryboard = {
            ...storyboard,
            dialogue: localizedDialogue,
            narration: localizedNarration,
            audioPlan: buildStoryboardAudioPlan({ duration: storyboard.duration, dialogue: localizedDialogue, narration: localizedNarration }),
            actionDesc: resolveStoryboardActionDesc(storyboard.actionPlan, storyboard.actionDesc)
        }
        const requestedReferenceMode = opts?.referenceMode ?? 'single'
        if (!supportsVideoReferenceMode(provider, requestedReferenceMode)) {
            throw new Error(`${provider} 不支持 ${requestedReferenceMode} 参考模式，请改用文本模式`)
        }
        const referenceMode = requestedReferenceMode
        if (!hasRequiredReferenceFrames(referenceMode, localizedStoryboard)) {
            throw new Error(referenceMode === 'first_last' ? '首尾帧模式至少需要两张插图，并且必须包含首图和末图' : '首帧模式需要先生成第一张插图')
        }
        const runProvider = async (activeProvider: VideoProvider, referenceMode: VideoReferenceMode) => {
            if (getHiModelsVideoApiModel(activeProvider)) {
                return generateVideoHiModels(generationId, localizedStoryboard, referenceMode, activeProvider, videoLanguage, opts?.signal, opts?.comparisonOnly)
            }
            if (activeProvider === 'wan3' || activeProvider === 'wan3prime') {
                return generateVideoWan3(generationId, localizedStoryboard, referenceMode, activeProvider, videoLanguage, opts?.signal, opts?.comparisonOnly)
            }
            if (activeProvider === 'seedance' || activeProvider === 'seedance25') {
                return generateVideoSeedance(generationId, localizedStoryboard, referenceMode, activeProvider, videoLanguage, opts?.signal, opts?.comparisonOnly)
            }
            throw new Error(`不支持的视频模型：${activeProvider}`)
        }

        return await runProvider(provider, referenceMode)
    } catch (error) {
        return failVideoGeneration(generationId, storyboard.id, error, 'Video language preparation', opts?.comparisonOnly)
    }
}

/** Continue polling a provider task whose local request worker was interrupted. */
export async function resumeVideoGenerationFromCheckpoint(generationId: bigint) {
    return withHiModelsUsageScope({ generationId: generationId.toString() }, () => resumeVideoGenerationWithUsage(generationId))
}

async function resumeVideoGenerationWithUsage(generationId: bigint) {
    const generation = await prisma.generation.findFirst({
        where: { id: generationId, type: 'video', status: 'processing' },
        select: { id: true, storyboardId: true, type: true, provider: true, taskId: true, requestBody: true }
    })
    if (!generation || !hasRecoverableVideoCheckpoint(generation)) return false

    const taskId = generation.taskId!
    const checkpointProvider = isProductionVideoProvider(generation.provider) ? generation.provider : null
    try {
        let videoResult: VeoVideoResult | { kind: 'uri'; uri: string }
        let metrics: Record<string, unknown> = { recoveredFromCheckpoint: true }

        if (generation.provider === 'wan3' || generation.provider === 'wan3prime' || generation.provider === 'wanx') {
            const { apiKey, baseUrl } = await getDashScopeRuntimeConfig()
            videoResult = { kind: 'uri', uri: await pollDashScopeVideoTask(baseUrl, apiKey, taskId, undefined, undefined, getVideoProviderCapability(generation.provider)?.label) }
        } else if (generation.provider === 'seedance' || generation.provider === 'seedance25') {
            const config = await getSeedanceConfig(generation.provider)
            if (!config?.apiKey) throw new Error('Seedance API key not configured')
            const baseUrl = config.baseUrl ?? (generation.provider === 'seedance25' ? SEEDANCE_25_BASE_URL : SEEDANCE_20_BASE_URL)
            videoResult = { kind: 'uri', uri: await pollSeedanceTask(baseUrl, config.apiKey, taskId) }
        } else if (checkpointProvider && getHiModelsVideoApiModel(checkpointProvider)) {
            const projectId = await getStoryboardProjectId(generation.storyboardId)
            const owner = projectId ? await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } }) : null
            if (!owner) throw new Error('无法确认视频任务所有者，暂停 HiModels 用量采集与恢复轮询')
            const poll = () => pollHiModelsVideoOperation(taskId, checkpointProvider)
            const recovered = await withHiModelsUsageScope({ userId: owner.userId }, poll)
            videoResult = recovered.videoResult
            metrics = {
                ...metrics,
                himodelsUsage: recovered.usage,
                himodelsUsageReturned: recovered.usage !== null
            }
        } else {
            throw new Error(`无法恢复未知视频模型任务：${generation.provider}`)
        }

        const filename = `video_${generation.id}.mp4`
        const absPath = storageAbsPath(filename)
        if (videoResult.kind === 'inline') {
            await fs.mkdir(path.dirname(absPath), { recursive: true })
            await fs.writeFile(absPath, decodeVeoInlineVideo(videoResult))
        } else {
            await downloadFile(videoResult.uri, absPath)
        }
        await completeVideoGeneration(generation.id, generation.storyboardId, storageRelPath(filename), {
            taskId,
            requestBody: generation.requestBody ?? undefined,
            metrics
        })
    } catch (error) {
        const label =
            generation.provider === 'wan3'
                ? WAN_3_LABEL
                : generation.provider === 'wan3prime'
                  ? WAN_3_PRIME_LABEL
                  : checkpointProvider && getHiModelsVideoApiModel(checkpointProvider)
                    ? checkpointProvider === 'veo3'
                        ? HIMODELS_VEO_LABEL
                        : checkpointProvider
                    : generation.provider === 'seedance25'
                      ? SEEDANCE_25_LABEL
                      : generation.provider === 'seedance'
                        ? SEEDANCE_20_LABEL
                        : (getVideoProviderCapability(generation.provider)?.label ?? generation.provider)
        await failVideoGeneration(generation.id, generation.storyboardId, error, `${label} checkpoint recovery`)
    }
    return true
}

async function generateVideoSeedance(
    generationId: bigint,
    storyboard: StoryboardWithRelations,
    referenceMode: VideoReferenceMode,
    provider: 'seedance' | 'seedance25',
    videoLanguage: VideoLanguage,
    signal?: AbortSignal,
    comparisonOnly = false
) {
    try {
        const config = await getSeedanceConfig(provider)
        if (!config?.apiKey) throw new Error('Seedance API key not configured')

        const baseUrl = config.baseUrl ?? (provider === 'seedance25' ? SEEDANCE_25_BASE_URL : SEEDANCE_20_BASE_URL)
        const model = config.modelName ?? (provider === 'seedance25' ? SEEDANCE_25_ENDPOINT_ID : SEEDANCE_20_ENDPOINT_ID)

        const duration = normalizeVideoDuration(provider, storyboard.duration)

        // 新流程：优先使用 firstFrameUrl；规划末图仅用于显式首尾帧模式。
        // 老流程回退：没有参考图时才走"文本 + 可选角色参考图"的文生视频
        const plannedLastFrameUrl = storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl
        const firstFrameUrl = toProviderImageUrl(storyboard.firstFrameUrl) ?? (referenceMode === 'single' ? toProviderImageUrl(plannedLastFrameUrl) : null)

        const imageContent: Array<Record<string, unknown>> = []
        let frameReferenceCount = 0
        if (referenceMode !== 'text' && firstFrameUrl) {
            imageContent.push({ type: 'image_url', image_url: { url: firstFrameUrl }, role: provider === 'seedance25' ? 'reference_image' : 'first_frame' })
            frameReferenceCount = 1
            const lastFrameUrl = toProviderImageUrl(plannedLastFrameUrl)
            if (referenceMode === 'first_last' && lastFrameUrl) {
                imageContent.push({ type: 'image_url', image_url: { url: lastFrameUrl }, role: provider === 'seedance25' ? 'reference_image' : 'last_frame' })
                frameReferenceCount = 2
            }
        }

        const referenceVideos = getStoryboardReferenceVideos(storyboard)
        const baseText = await buildVideoText(storyboard, videoLanguage, provider, duration)
        const text = [referenceVideoPrompt(referenceVideos), baseText].filter(Boolean).join(' ')
        const videoContent = referenceVideos.map(video => ({ type: 'video_url', video_url: { url: video.url }, role: 'reference_video' }))
        const content: Array<Record<string, unknown>> = [{ type: 'text', text }, ...imageContent, ...videoContent]

        if (frameReferenceCount > 0 && provider !== 'seedance25') {
            content[0] = {
                type: 'text',
                text: frameReferenceCount === 2 ? `Use Image 1 as the exact opening frame and Image 2 as the exact final frame. ${text}` : `Use Image 1 as the exact opening frame. ${text}`
            }
        }

        // duration is kept close to the storyboard timing and clamped to the provider range.
        const ratio = await getStoryboardVideoAspectRatio(storyboard.id)

        const requestBody = {
            model,
            content,
            ratio,
            duration,
            generate_audio: true,
            watermark: false
        }
        await prisma.generation.update({
            where: { id: generationId },
            data: {
                requestBody: JSON.stringify({
                    ...requestBody,
                    referenceMode,
                    videoLanguage,
                    timelinePlanVersion: VIDEO_TIMELINE_PLAN_VERSION,
                    promptCompiler: 'basic-v1'
                }),
                plannedDuration: duration,
                inputAssets: JSON.parse(JSON.stringify(content.filter(item => item.type === 'image_url' || item.type === 'video_url')))
            }
        })

        // 创建任务
        const created = await createSeedanceTaskWithAssetRecovery({
            baseUrl,
            apiKey: config.apiKey,
            requestBody,
            seedanceConfig: config,
            signal
        })
        const taskId = created.taskId

        await prisma.generation.update({
            where: { id: generationId },
            data: {
                taskId,
                requestBody: JSON.stringify({
                    ...created.requestBody,
                    referenceMode,
                    videoLanguage,
                    timelinePlanVersion: VIDEO_TIMELINE_PLAN_VERSION,
                    promptCompiler: 'basic-v1',
                    ...(created.recovery ? { materialRecovery: created.recovery } : {})
                })
            }
        })

        // 轮询
        const videoUrl = await pollSeedanceTask(baseUrl, config.apiKey, taskId, undefined, signal)

        // 下载视频到本地
        const filename = `video_${generationId}.mp4`
        const absPath = storageAbsPath(filename)
        await downloadFile(videoUrl, absPath)
        const relPath = storageRelPath(filename)

        await completeVideoGeneration(generationId, storyboard.id, relPath, { comparisonOnly })
    } catch (err) {
        await failVideoGeneration(generationId, storyboard.id, err, provider === 'seedance25' ? SEEDANCE_25_LABEL : SEEDANCE_20_LABEL, comparisonOnly)
    }
}

async function getDashScopeRuntimeConfig() {
    const { apiKey, baseUrl } = getDashScopeConfig()
    if (!apiKey) throw new Error('DashScope API key 未配置，请设置 DASHSCOPE_API_KEY')
    return { apiKey, baseUrl }
}

async function generateVideoWan3(
    generationId: bigint,
    storyboard: StoryboardWithRelations,
    referenceMode: VideoReferenceMode,
    provider: 'wan3' | 'wan3prime',
    videoLanguage: VideoLanguage,
    signal?: AbortSignal,
    comparisonOnly = false
) {
    const model = provider === 'wan3prime' ? WAN_3_PRIME_MODEL : WAN_3_MODEL
    const label = provider === 'wan3prime' ? WAN_3_PRIME_LABEL : WAN_3_LABEL
    try {
        const { apiKey, baseUrl } = await getDashScopeRuntimeConfig()
        const duration = normalizeVideoDuration(provider, storyboard.duration)
        const prompt = await buildVideoText(storyboard, videoLanguage, provider, duration)
        const ratio = await getStoryboardVideoAspectRatio(storyboard.id)
        const endpointPath = '/api/v1/services/aigc/video-generation/video-synthesis'
        const media: Array<{ type: 'reference_image' | 'reference_video'; url: string }> = []
        const referenceVideos = getStoryboardReferenceVideos(storyboard)

        if (referenceMode !== 'text') {
            const firstFrameUrl =
                (await ensureStoryboardFrameProviderUrl(storyboard.id, 'firstFrameUrl', storyboard.firstFrameUrl, provider, signal)) ??
                (referenceMode === 'single'
                    ? await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl, provider, signal)
                    : null)
            if (!firstFrameUrl) throw new Error(`${label} 图生视频需要至少一张插图：请先生成插图后再生成视频`)
            media.push({ type: 'reference_image', url: firstFrameUrl })

            if (referenceMode === 'first_last') {
                const lastFrameUrl = await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl, provider, signal)
                if (lastFrameUrl) media.push({ type: 'reference_image', url: lastFrameUrl })
            }
        }
        media.push(...referenceVideos.map(video => ({ type: 'reference_video' as const, url: video.url })))

        const referenceImages = media.filter(item => item.type === 'reference_image')
        const referenceInstruction =
            referenceImages.length === 2
                ? 'Use reference image 1 as the opening frame and reference image 2 as the ending frame. Keep one continuous shot and arrive at the ending state naturally. '
                : referenceImages.length === 1
                  ? 'Use reference image 1 as the opening-frame visual anchor and begin motion immediately. '
                  : ''
        const requestBody = {
            model,
            input: {
                prompt: `${referenceInstruction}${referenceVideoPrompt(referenceVideos)} ${prompt}`.trim(),
                ...(media.length ? { media } : {})
            },
            parameters: {
                resolution: WAN_3_RESOLUTION,
                ratio,
                duration
            }
        }

        await prisma.generation.update({
            where: { id: generationId },
            data: {
                plannedDuration: duration,
                inputAssets: {
                    firstFrameUrl: storyboard.firstFrameUrl,
                    plannedLastFrameUrl: storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl,
                    referenceVideos,
                    inputVideoDuration: totalReferenceVideoDuration(referenceVideos),
                    referenceMode
                },
                requestBody: stringifyRequestBodyForRecord({
                    provider,
                    model,
                    videoLanguage,
                    timelinePlanVersion: VIDEO_TIMELINE_PLAN_VERSION,
                    endpointPath,
                    referenceMode,
                    requestBody
                })
            }
        })

        const created = await createDashScopeVideoTask(baseUrl, apiKey, requestBody, endpointPath, totalReferenceVideoDuration(referenceVideos), label)
        const taskId = created?.output?.task_id
        if (!taskId) throw new Error(`${label} 未返回任务 ID：${JSON.stringify(created).slice(0, 300)}`)
        await prisma.generation.update({ where: { id: generationId }, data: { taskId } })

        const videoUrl = await pollDashScopeVideoTask(baseUrl, apiKey, taskId, undefined, signal, label)
        const filename = `video_${generationId}.mp4`
        const absPath = storageAbsPath(filename)
        await downloadFile(videoUrl, absPath)
        await completeVideoGeneration(generationId, storyboard.id, storageRelPath(filename), {
            taskId,
            comparisonOnly,
            requestBody: stringifyRequestBodyForRecord({
                provider,
                model,
                videoLanguage,
                endpointPath,
                referenceMode,
                requestBody
            })
        })
    } catch (err) {
        await failVideoGeneration(generationId, storyboard.id, err, label, comparisonOnly)
    }
}

export async function pollHiModelsVideoOperation(operationName: string, label: string, maxAttempts = 72, signal?: AbortSignal): Promise<{ videoResult: VeoVideoResult; usage: HiModelsUsage | null }> {
    let consecutiveErrors = 0
    let usage: HiModelsUsage | null = null
    for (let i = 0; i < maxAttempts; i++) {
        await signalSleep(15000, signal)
        let data: Awaited<ReturnType<typeof getHiModelsVideoTask>>
        try {
            data = await getHiModelsVideoTask(operationName, signal, label)
        } catch (error) {
            consecutiveErrors++
            if (signal?.aborted || isCancelledError(error) || consecutiveErrors >= 5) throw error
            console.warn(`[${label}] poll ${i + 1} failed (${consecutiveErrors}/5):`, error)
            continue
        }
        consecutiveErrors = 0
        usage = mergeHiModelsUsage(usage, extractHiModelsUsage(data))
        // A terminal provider result must end the job and release its hold.
        // Only transport failures above can recover by repeating a status query.
        if (data.error) {
            const message = typeof data.error === 'string' ? data.error : data.error.message
            throw new Error(`${label} 任务失败：${message ?? '未知错误'}`)
        }
        const status = data.status?.toLowerCase()
        if (status && ['failed', 'cancelled', 'canceled', 'error', 'unknown'].includes(status)) throw new Error(`${label} 任务失败：${data.message ?? status}`)
        if (data.done || (status && ['succeeded', 'completed', 'success'].includes(status))) {
            const videoResult = extractVeoVideoResult(data)
            if (!videoResult) throw new Error('视频任务已完成，但返回文件格式无法识别，请重新生成当前视频')
            return { videoResult, usage }
        }
        console.log(`[${label}] poll ${i + 1}/${maxAttempts}: not done yet`)
    }
    throw new Error(`${label} 轮询超时`)
}

async function generateVideoHiModels(
    generationId: bigint,
    storyboard: StoryboardWithRelations,
    referenceMode: VideoReferenceMode,
    provider: VideoProvider,
    videoLanguage: VideoLanguage,
    signal?: AbortSignal,
    comparisonOnly = false
) {
    const model = getHiModelsVideoApiModel(provider)
    if (!model) throw new Error(`不支持的 Himodels 视频模型：${provider}`)
    const label = provider === 'veo3' ? HIMODELS_VEO_LABEL : provider
    try {
        const plannedDuration = normalizeVideoDuration(provider, storyboard.duration)
        const text = await buildVideoText(storyboard, videoLanguage, provider, plannedDuration)
        const ratio = await getStoryboardVideoAspectRatio(storyboard.id)
        const aspectRatio = ratio === '9:16' ? '9:16' : ratio === '1:1' ? '1:1' : '16:9'
        const referenceVideos = getStoryboardReferenceVideos(storyboard)
        const referenceImages: HiModelsVideoReferenceImage[] = []

        if (referenceMode !== 'text') {
            const firstFrameUrl =
                (await ensureStoryboardFrameProviderUrl(storyboard.id, 'firstFrameUrl', storyboard.firstFrameUrl, provider)) ??
                (referenceMode === 'single' ? await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl, provider) : null)
            if (!firstFrameUrl) throw new Error(`${label} 图生视频需要至少一张插图：请先生成插图后再生成视频`)
            referenceImages.push({ url: firstFrameUrl, role: provider === 'seedance25' ? 'reference_image' : 'first_frame' })

            if (referenceMode === 'first_last') {
                const lastFrameUrl = await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl, provider)
                if (!lastFrameUrl) throw new Error('首尾帧模式至少需要两张插图，并且必须包含首图和末图')
                referenceImages.push({ url: lastFrameUrl, role: provider === 'seedance25' ? 'reference_image' : 'last_frame' })
            }
        }

        const referenceImagePrompt =
            referenceImages.length === 2
                ? 'Use Image 1 as the exact opening frame and Image 2 as the exact final frame.'
                : referenceImages.length === 1
                  ? 'Use Image 1 as the exact opening frame.'
                  : ''

        const created = await createHiModelsVideoTask({
            model,
            prompt: [referenceImagePrompt, referenceVideoPrompt(referenceVideos), text].filter(Boolean).join(' '),
            aspectRatio,
            duration: plannedDuration,
            referenceImages,
            referenceVideos,
            signal
        })

        await prisma.generation.update({
            where: { id: generationId },
            data: {
                taskId: created.taskId,
                requestBody: JSON.stringify({ provider, referenceMode, videoLanguage, timelinePlanVersion: VIDEO_TIMELINE_PLAN_VERSION, ...created.requestBody }),
                plannedDuration,
                inputAssets: {
                    firstFrameUrl: storyboard.firstFrameUrl,
                    plannedLastFrameUrl: storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl,
                    referenceImages,
                    referenceVideos,
                    inputVideoDuration: totalReferenceVideoDuration(referenceVideos),
                    referenceMode
                }
            }
        })

        const { videoResult, usage: completedUsage } = await pollHiModelsVideoOperation(created.taskId, label, isHiModelsVeoProvider(provider) ? 72 : 120, signal)
        const usage = mergeHiModelsUsage(created.usage, completedUsage)

        const filename = `video_${generationId}.mp4`
        const absPath = storageAbsPath(filename)
        if (videoResult.kind === 'inline') {
            await fs.mkdir(path.dirname(absPath), { recursive: true })
            await fs.writeFile(absPath, decodeVeoInlineVideo(videoResult))
        } else {
            await downloadFile(videoResult.uri, absPath)
        }
        const relPath = storageRelPath(filename)

        await completeVideoGeneration(generationId, storyboard.id, relPath, {
            taskId: created.taskId,
            comparisonOnly,
            requestBody: JSON.stringify({ provider, model, referenceMode, videoLanguage, aspectRatio, duration: plannedDuration, referenceImages, referenceVideos }),
            metrics: { himodelsUsage: usage, himodelsUsageReturned: usage !== null }
        })
    } catch (err) {
        await failVideoGeneration(generationId, storyboard.id, err, label, comparisonOnly)
    }
}

async function pollDashScopeVideoTask(
    baseUrl: string,
    apiKey: string,
    taskId: string,
    maxAttempts = 120, // 120 * 15s = 30 min
    signal?: AbortSignal,
    label = 'DashScope'
): Promise<string> {
    let consecutiveErrors = 0
    for (let i = 0; i < maxAttempts; i++) {
        await signalSleep(15000, signal)
        const sentAt = new Date().toISOString()
        const res = await fetchMeteredProvider(
            `${baseUrl}/api/v1/tasks/${taskId}`,
            {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: fetchTimeoutSignal(30_000, signal)
            },
            { provider: 'qwen', model: 'dashscope-video' }
        )
        if (!res.ok) {
            consecutiveErrors++
            console.warn(`[${label}] poll ${i + 1}: HTTP ${res.status} (consecutive errors: ${consecutiveErrors})`)
            if (consecutiveErrors >= 5) throw new Error(`${label} API error ${res.status} (${consecutiveErrors} consecutive failures)`)
            continue
        }
        consecutiveErrors = 0
        const data = await res.json()
        await reportProviderTokenUsage({
            provider: 'qwen',
            model: 'dashscope-video',
            endpoint: '/api/v1/tasks/:taskId',
            response: res,
            payload: data,
            sentAt,
            operationKey: `dashscope-video:${taskId}`
        })
        const status = data?.output?.task_status
        if (status === 'SUCCEEDED') {
            const url = data?.output?.video_url
            if (!url) throw new Error(`${label} SUCCEEDED but no video_url: ${JSON.stringify(data).slice(0, 200)}`)
            return url
        }
        if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
            const reason = [data?.output?.code, data?.output?.message].filter(Boolean).join(': ') || 'unknown reason'
            throw new Error(`${label} task ${status}: ${reason}`)
        }
        console.log(`[${label}] poll ${i + 1}/${maxAttempts}: status=${status}`)
    }
    throw new Error(`${label} polling timeout (30 min)`)
}

async function pollSeedanceTask(
    baseUrl: string,
    apiKey: string,
    taskId: string,
    maxAttempts = 240, // 240 * 10s = 40 min
    signal?: AbortSignal
): Promise<string> {
    let consecutiveErrors = 0
    for (let i = 0; i < maxAttempts; i++) {
        await signalSleep(10000, signal)
        const sentAt = new Date().toISOString()
        const res = await fetchMeteredProvider(
            `${baseUrl}/api/v3/contents/generations/tasks/${taskId}`,
            {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: fetchTimeoutSignal(30_000, signal)
            },
            { provider: 'volcengine', model: 'seedance' }
        )
        if (!res.ok) {
            consecutiveErrors++
            console.warn(`[Seedance] poll ${i + 1}: HTTP ${res.status} (consecutive errors: ${consecutiveErrors})`)
            if (consecutiveErrors >= 5) throw new Error(`Seedance API error ${res.status} (${consecutiveErrors} consecutive failures)`)
            continue
        }
        consecutiveErrors = 0
        const data = await res.json()
        await reportProviderTokenUsage({
            provider: 'volcengine',
            model: 'seedance',
            endpoint: '/api/v3/contents/generations/tasks/:taskId',
            response: res,
            payload: data,
            sentAt,
            operationKey: `seedance-video:${taskId}`
        })
        if (data.status === 'succeeded') {
            const url = data?.content?.video_url
            if (!url) throw new Error('Succeeded but no video_url')
            return url
        }
        if (data.status === 'failed' || data.status === 'cancelled') {
            throw new Error(data.error?.message ?? `Task ${data.status}`)
        }
        console.log(`[Seedance] poll ${i + 1}/${maxAttempts}: status=${data.status}`)
        // running / pending 继续
    }
    throw new Error('Seedance polling timeout (40 min)')
}

// =================== 插图生成（真正调图像模型 + 多参考图一致性） ===================
// 输入：storyboard.imagePrompt + 所有出场角色的 referenceImageUrl + 场景 referenceImageUrl
// 输出：首帧写到 firstFrameUrl，规划末图写到 plannedLastFrameUrl；视频实际末帧另存 actualVideoEndFrameUrl。
// 模型：banana（默认）/ doubao / qwen-image-3.0-pro / HiModels，可由调用方覆盖
type FrameType = 'first_frame' | 'middle_frame' | 'last_frame'

async function isGenerationProcessing(generationId: bigint) {
    const generation = await prisma.generation.findUnique({
        where: { id: generationId },
        select: { status: true }
    })
    return generation?.status === 'processing'
}

async function cancelStaleGeneration(generationId: bigint, reason = '分镜内容已修改，旧任务作废') {
    await prisma.generation.updateMany({
        where: { id: generationId, status: 'processing' },
        data: { status: 'cancelled', activeKey: null, errorMsg: reason }
    })
}

export async function generateFrame(...args: Parameters<typeof generateFrameWithUsage>) {
    const owner = await prisma.generation.findUnique({ where: { id: args[0] }, select: { storyboard: { select: { episode: { select: { project: { select: { userId: true } } } } } } } })
    return withHiModelsUsageScope({ userId: owner?.storyboard.episode.project.userId, generationId: args[0].toString() }, async () => {
        try {
            return await generateFrameWithUsage(...args)
        } finally {
            const result = await prisma.generation.findUnique({ where: { id: args[0] }, select: { status: true } })
            if (result && ['failed', 'cancelled'].includes(result.status ?? '')) await releaseModelReservations(`generation:${args[0]}`)
        }
    })
}

async function generateFrameWithUsage(
    generationId: bigint,
    storyboard: StoryboardWithRelations,
    type: FrameType,
    opts?: {
        provider?: ImageProvider
        imageQuality?: ImageQuality
        videoProvider?: VideoProvider
        middleFrameIndex?: number
        middleFrameCount?: number
        keepFrameGenerating?: boolean
        continuityFrameUrl?: string | null
        continuityFrameLabel?: string
        previousShotFrameUrl?: string | null
        previousShotFrameLabel?: string
        previousContinuityMode?: 'stateful' | 'continuous' | 'seamless'
        previousShotStoryboardId?: bigint | string | null
        previousShotOrder?: number
        nextContinuityFrameUrl?: string | null
        nextContinuityFrameLabel?: string
        signal?: AbortSignal
    }
) {
    try {
        if (!(await isGenerationProcessing(generationId))) return false
        const imageQuality = normalizeImageQuality(opts?.imageQuality)
        const generationSnapshot = await prisma.generation.findUnique({ where: { id: generationId }, select: { resourceVersion: true } })
        const sbRow = await prisma.storyboard.findFirst({
            where: { id: storyboard.id, deletedAt: null },
            select: { episodeId: true, order: true, operationVersion: true }
        })
        if (!generationSnapshot || !sbRow || generationSnapshot.resourceVersion !== sbRow.operationVersion) {
            await cancelStaleGeneration(generationId)
            return false
        }
        const style = await getStoryboardVisualStyle(storyboard.id)
        const aspectRatio = await getStoryboardVideoAspectRatio(storyboard.id)
        const referenceImages = [...new Set(storyboard.characters.map(({ character }) => character.referenceImageUrl).filter((url): url is string => Boolean(url)))]
        const prompt = [
            storyboard.imagePrompt,
            storyboard.actionDesc,
            storyboard.scene?.locationPrompt,
            ...storyboard.characters.map(({ character }) => `${character.name}: ${character.appearancePrompt ?? ''}`),
            `Style: ${style.label}. Shot: ${storyboard.shotType ?? 'medium'}.`,
            referenceImages.length ? 'Use the supplied character references.' : null
        ]
            .filter(Boolean)
            .join('\n')
        if (!storyboard.imagePrompt?.trim() && !storyboard.actionDesc?.trim()) throw new Error('请先填写分镜插图提示词或动作描述')
        const middleSuffix = type === 'middle_frame' ? `_${opts?.middleFrameIndex ?? 1}` : ''
        const filename = `frame_${type}${middleSuffix}_${generationId}.png`
        const absPath = storageAbsPath(filename)
        const finalPrompt = prompt
        const imageGenerationResult = await generateImageUnified({
            prompt,
            negativePrompt: storyboard.negativePrompt ?? undefined,
            referenceImages,
            outputAbsPath: absPath,
            aspectRatio,
            provider: opts?.provider,
            quality: imageQuality,
            automaticFallback: false,
            allowProviderSwitch: false,
            contentLabel: `分镜 ${sbRow.order} · 插图`,
            signal: opts?.signal
        })
        if (!(await isGenerationProcessing(generationId))) return false

        // Persist the generated file before atomically completing the task.
        const finalUrl = await uploadStoryboardArtifact(storyboard.id, absPath, filename, 'storyboards')

        let frameData: Record<string, string | null> | null = null
        if (type !== 'middle_frame') {
            const frameField = type === 'first_frame' ? 'firstFrameUrl' : 'plannedLastFrameUrl'
            frameData =
                type === 'first_frame'
                    ? {
                          [frameField]: finalUrl,
                          lastFrameUrl: null,
                          plannedLastFrameUrl: null,
                          actualVideoEndFrameUrl: null,
                          frameStatus: opts?.keepFrameGenerating ? 'generating' : 'completed',
                          videoUrl: null,
                          videoStatus: 'pending',
                          composedVideoUrl: null,
                          composeStatus: 'pending'
                      }
                    : {
                          [frameField]: finalUrl,
                          frameStatus: opts?.keepFrameGenerating ? 'generating' : 'completed',
                          videoUrl: null,
                          videoStatus: 'pending',
                          composedVideoUrl: null,
                          composeStatus: 'pending'
                      }
        }
        const hasHiModelsImageProvider = imageGenerationResult?.actualProvider === 'doubao' || isHiModelsImageModel(imageGenerationResult?.actualProvider)
        const himodelsImageMetrics = hasHiModelsImageProvider ? { himodelsUsage: imageGenerationResult?.usage ?? null, himodelsUsageReturned: imageGenerationResult?.usage != null } : {}
        await prisma.$transaction(async tx => {
            await lockStoryboardMediaInTransaction(tx, { id: storyboard.id, episodeId: sbRow.episodeId, operationVersion: sbRow.operationVersion })
            await chargeGenerationUsage(generationId, tx)
            const completed = await tx.generation.updateMany({
                where: { id: generationId, status: 'processing', resourceVersion: sbRow.operationVersion },
                data: {
                    status: 'completed',
                    activeKey: null,
                    provider: imageGenerationResult?.actualProvider ?? opts?.provider ?? 'banana',
                    modelName:
                        imageGenerationResult?.actualProvider === 'banana'
                            ? (process.env.NANO_BANANA_MODEL ?? NANO_BANANA_IMAGE_MODEL)
                            : imageGenerationResult?.actualProvider === 'doubao'
                              ? 'doubao-seedream'
                              : imageGenerationResult?.actualProvider === 'qwen-image-3.0-pro'
                                ? QWEN_IMAGE_3_PRO_MODEL
                                : undefined,
                    prompt: finalPrompt,
                    resultUrl: finalUrl,
                    metrics:
                        imageGenerationResult?.recovery || hasHiModelsImageProvider
                            ? {
                                  ...himodelsImageMetrics,
                                  ...(imageGenerationResult?.recovery
                                      ? {
                                            imageRecovery: {
                                                recovery: imageGenerationResult.recovery,
                                                requestedProvider: imageGenerationResult.requestedProvider,
                                                initialProvider: imageGenerationResult.initialProvider,
                                                actualProvider: imageGenerationResult.actualProvider,
                                                safetyRewriteCount: imageGenerationResult.safetyRewriteCount,
                                                referenceImagesApplied: imageGenerationResult.referenceImagesApplied,
                                                fallbackReason: imageGenerationResult.fallbackReason
                                            }
                                        }
                                      : {})
                              }
                            : undefined,
                    requestBody: stringifyRequestBodyForRecord({
                        prompt,
                        finalPrompt,
                        imageQuality,
                        imageGeneration: imageGenerationResult,
                        referenceImageCount: referenceImages.length,
                        ...(type === 'middle_frame' ? { middleFrameIndex: opts?.middleFrameIndex ?? 1, middleFrameCount: opts?.middleFrameCount ?? 1 } : {})
                    })
                }
            })
            if (completed.count !== 1) throw new Error('STALE_GENERATION_RESULT')
            if (type !== 'middle_frame' && frameData) {
                const target = await tx.storyboard.updateMany({
                    where: { id: storyboard.id, deletedAt: null, operationVersion: sbRow.operationVersion },
                    data: frameData
                })
                if (target.count !== 1) throw new Error('STALE_GENERATION_RESULT')
            }
            if (type !== 'middle_frame') await clearEpisodeMergedVideoInTransaction(tx, sbRow.episodeId)
        }, BILLING_TRANSACTION_OPTIONS)
        return true
    } catch (err) {
        if (err instanceof StaleStoryboardMutationError || (err instanceof Error && err.message === 'STALE_GENERATION_RESULT')) {
            await cancelStaleGeneration(generationId)
            return false
        }
        const msg = err instanceof Error ? err.message : String(err)
        const [generationSnapshot, storyboardSnapshot] = await Promise.all([
            prisma.generation.findUnique({ where: { id: generationId }, select: { status: true, resourceVersion: true } }),
            prisma.storyboard.findUnique({ where: { id: storyboard.id }, select: { operationVersion: true, deletedAt: true } })
        ])
        if (!generationSnapshot || generationSnapshot.status !== 'processing') return false
        if (!storyboardSnapshot || storyboardSnapshot.deletedAt || generationSnapshot.resourceVersion !== storyboardSnapshot.operationVersion) {
            await cancelStaleGeneration(generationId)
            return false
        }
        await prisma.generation.updateMany({
            where: { id: generationId, status: 'processing', resourceVersion: storyboardSnapshot.operationVersion },
            data: {
                status: 'failed',
                activeKey: null,
                errorMsg: msg,
                errorCode: err instanceof ImageRecoveryExhaustedError ? err.code : undefined,
                metrics: err instanceof ImageRecoveryExhaustedError && err.details ? { imageRecoveryFailure: JSON.parse(JSON.stringify(err.details)) } : undefined
            }
        })
        await prisma.storyboard.updateMany({
            where: { id: storyboard.id, deletedAt: null, operationVersion: storyboardSnapshot.operationVersion },
            data: { frameStatus: 'failed' }
        })
        console.error('[Frame] generate failed:', msg)
        return false
    }
}
