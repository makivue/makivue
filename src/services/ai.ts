import { localFetch } from '@/lib/local-fetch'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import path from 'path'
import fsSync from 'fs'
import fs from 'fs/promises'
import { toLocalMediaUrl, saveImmutableLocalImage, saveLocalMediaFile } from './local-media'
import { BananaImageSafetyError, generateImageWithBanana, inspectCharacterReferenceQuality, inspectImageTextArtifacts, shouldRejectCharacterReferenceImage } from './banana'
import { decodeVeoInlineVideo, extractVeoVideoResult, type VeoVideoResult } from './veo-video-result'
import {
    createHiModelsVideoTask,
    extractHiModelsUsage,
    generateHiModelsImage,
    getHiModelsVideoTask,
    mergeHiModelsUsage,
    HIMODELS_VEO_LABEL,
    type HiModelsUsage,
    type HiModelsVideoReferenceImage
} from './himodels'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { generateImageWithQwenImage3Pro, QwenImageRateLimitError, QWEN_IMAGE_3_PRO_MODEL } from './qwen-image'
import { improveFrameImagePrompt, improveVideoMotionPrompt, rewriteAnimalCharacterAppearance, rewriteImagePromptForSafety } from './llm'
import { getVisualStyleForSetup, getVisualStyleProfile, parseNovelSetup, stringifyNovelSetup, type NovelSetup } from '@/lib/novel'
import { formatVisualStyleProfile } from '@/lib/visual-style-profile'
import { getImageQualityOption, normalizeImageQuality, type ImageQuality } from '@/lib/image-quality'
import { NANO_BANANA_IMAGE_MODEL } from '@/lib/gemini-models'
import { clearEpisodeMergedVideoInTransaction, lockStoryboardMediaInTransaction, StaleStoryboardMutationError } from './artifacts'
import { concatStorageVideos, addContinuousAmbientBedToVideo, extractLastFrameFromVideo, optimizeVideoForStreaming, probeDuration, probeMediaStreams, withFfmpegSlot } from './ffmpeg'
import { generateStoryboardSubtitles } from './subtitle'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import type { VideoLanguage } from '@/lib/video-language'
import { buildVideoLanguageLock, extractDialogueTurns, getConfiguredVideoLanguage, getDialogueSpeakerNames, localizeStoryboardDialogue } from './video-language'
import { buildVisualStyleLock, sanitizePromptForVisualStyle } from '@/lib/visual-style-lock'
import { productionDirection } from '@/lib/production-direction'
import { getSeedanceConfig } from './seedance-config'
import { getDashScopeConfig } from './dashscope-config'
import { prepareWanVideoReferenceImage } from './wan-video-reference-image'
import { createSeedanceTaskWithAssetRecovery } from './seedance-assets'
import { fetchMeteredProvider, reportProviderTokenUsage } from '@/lib/provider-token-usage.server'
import { chargeGenerationUsage } from './billing'
import { releaseModelReservations } from './wallet-reservations'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { buildVideoProviderConstraintPackage } from '@/lib/video-production-plan'
import { resolveStoryboardActionDesc } from '@/lib/storyboard-action-plan'
import { buildAudioTimelineDirection, buildStoryboardAudioPlan, normalizeStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'
import { ImageProviderTimeoutError, ImageRecoveryExhaustedError, shouldUseAutomaticImageFallback, type ImageGenerationResult, type ImageProviderSwitch } from '@/lib/image-generation-recovery'
import { buildStoryboardContinuityState, STORYBOARD_CONTINUITY_STATE_VERSION } from '@/lib/storyboard-state'
import { buildImageReferenceRoleMap, type ImageReferenceRole } from '@/lib/reference-role-map'
import { type ReferenceGenerationProgress, type ReferenceGenerationStage, type ReferenceGenerationTimings } from '@/lib/reference-generation-progress'
import { getSeedanceIllustrationSafety } from '@/lib/seedance-illustration-safety'
import {
    assessCharacterReferenceQuality,
    CHARACTER_SINGLE_SUBJECT_NEGATIVE,
    CHARACTER_TURNAROUND_SHEET_NEGATIVE,
    CHARACTER_TURNAROUND_ASPECT_RATIO,
    characterReferenceFramingPrompt,
    characterReferenceRetryCorrection,
    characterReferenceAnimalSpecies,
    characterReferenceSubjectProfile,
    CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS,
    CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS,
    filterTurnaroundInspectionIssues,
    sanitizeCharacterReferenceSheetPrompt,
    summarizeTurnaroundViews
} from '@/lib/character-reference-retry'
import {
    DEFAULT_VIDEO_PROVIDER,
    getHiModelsVideoApiModel,
    getImageProviderCapability,
    getVideoProviderCapability,
    isAvailableProductionVideoProvider,
    isHiModelsH3Provider,
    isHiModelsVeoProvider,
    isProductionVideoProvider,
    normalizeVideoDuration,
    planVideoDuration,
    resolveImagePromptChannels,
    SEEDANCE_20_BASE_URL,
    SEEDANCE_20_ENDPOINT_ID,
    SEEDANCE_20_LABEL,
    SEEDANCE_25_BASE_URL,
    SEEDANCE_25_ENDPOINT_ID,
    SEEDANCE_25_LABEL,
    WAN_3_LABEL,
    WAN_3_MODEL,
    WAN_3_PRIME_LABEL,
    WAN_3_PRIME_MODEL,
    WAN_3_RESOLUTION,
    supportsVideoReferenceMode,
    type ProductionVideoProvider,
    type VideoReferenceMode as CapabilityVideoReferenceMode
} from '@/lib/provider-capabilities'
import { getHiModelsImageModelCapability, isHiModelsImageModel, type HiModelsImageApiModel } from '@/lib/himodels-models'
import { adaptCharacterReferenceStylePrompt, getCharacterBeautyPrompt, resolveCharacterReferencePolicy, type CharacterReferenceImageProvider } from '@/lib/character-reference-policy'
import { markProjectVisualsStaleInTransaction } from '@/services/content-lineage'
import { resolveCharacterStatesForStoryboard } from '@/services/character-state'
import { createConcurrencyLimiter } from '@/lib/bounded-concurrency'
import { characterReferenceFallbackRoles, characterReferenceRoleForShot, characterReferenceRoleLabel } from '@/lib/character-reference-selection'
import { compileSeedance25Prompt, SEEDANCE_25_PROMPT_COMPILER_VERSION, type Seedance25ReferenceAsset } from '@/lib/seedance25-prompt-compiler'
import { hasRequiredReferenceFrames, isCompleteVideoTimeline, VIDEO_TIMELINE_PLAN_VERSION } from '@/lib/video-timeline-plan'
import { hasRecoverableVideoCheckpoint } from '@/lib/generation-checkpoint-recovery'
import { getSelectedSceneReferenceUrls } from '@/lib/scene-reference-selection'
import { freshGenerationInstruction } from '@/lib/generation-request'
import { formatReferenceVideoDurationViolation, getReferenceVideoDurationViolation, parseStoryboardReferenceVideos, totalReferenceVideoDuration } from '@/lib/storyboard-reference-videos'
import { buildSceneReferenceGenerationPrompt } from '@/lib/scene-reference-prompt'

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

export async function resolveCharacterReferenceRuntimePolicy(projectId: bigint, requestedProvider?: ImageProvider) {
    const style = await getProjectVisualStyle(projectId)
    return resolveCharacterReferencePolicy(style, (requestedProvider ?? 'banana') as CharacterReferenceImageProvider)
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

function getAspectRatioPrompt(ratio: ProjectVideoAspectRatio): string {
    if (ratio === '16:9') return 'cinematic composition, 16:9 horizontal landscape frame, high quality'
    if (ratio === '1:1') return 'cinematic composition, 1:1 square frame, high quality'
    return 'cinematic composition, 9:16 vertical frame, high quality'
}

async function getProjectStyleReferenceImages(projectId: bigint): Promise<string[]> {
    const project = await getProjectNovelSetup(projectId)
    return (project?.setup.styleReferenceImages ?? []).filter(Boolean).slice(0, 4)
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

async function getStoryboardStyleReferenceImages(storyboardId: bigint): Promise<string[]> {
    const projectId = await getStoryboardProjectId(storyboardId)
    return projectId ? getProjectStyleReferenceImages(projectId) : []
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

type StoryboardCharacterRelation = StoryboardWithRelations['characters'][number]

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

function isSuspiciousImageFile(absPath: string) {
    try {
        const stat = fsSync.statSync(absPath)
        return stat.size < 12_000
    } catch {
        return true
    }
}

async function downloadFile(url: string, destPath: string) {
    const res = await localFetch(url, { signal: fetchTimeoutSignal(120_000) })
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.writeFile(destPath, buffer)
    return destPath
}

// 把生成好的本地文件上传到 local storage 并删除本地临时文件，返回 本地素材 URL。
// 所有分镜产物（首/末/中间帧、视频、音频）落盘后都走这里，避免 pod 磁盘重启丢文件 → 前端 404。
// 上传失败直接抛错，让上层 generation 记录变成 failed，用户可重试。
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

// 构建视频模型的文本 prompt
// 注意：由于 Seedance 对真人参考图有严格的隐私审核，生产中最稳定方式是
// 把角色外貌描述直接拼进 text prompt（而非作为 reference_image 传入）
function getStoryboardCharacterMatchText(sb: Pick<StoryboardWithRelations, 'dialogue' | 'actionDesc' | 'imagePrompt' | 'videoPrompt'>) {
    return [sb.dialogue, sb.actionDesc, sb.imagePrompt, sb.videoPrompt].filter(Boolean).join('\n')
}

async function resolveStoryboardVisibleCharacters(storyboard: StoryboardWithRelations): Promise<StoryboardCharacterRelation[]> {
    const byId = new Map<bigint, StoryboardCharacterRelation>()
    for (const item of storyboard.characters) {
        if (item.character?.id) byId.set(item.character.id, item)
    }

    const projectId = await getStoryboardProjectId(storyboard.id)
    const matchText = getStoryboardCharacterMatchText(storyboard)
    if (!projectId || !matchText.trim()) return Array.from(byId.values())

    const projectCharacters = await prisma.character.findMany({
        where: { projectId, deletedAt: null },
        select: {
            id: true,
            name: true,
            appearancePrompt: true,
            referenceImageUrl: true,
            seedanceAssetId: true,
            gender: true
        }
    })
    for (const character of projectCharacters) {
        const name = character.name?.trim()
        if (!name || byId.has(character.id)) continue
        if (matchText.includes(name)) {
            byId.set(character.id, { character })
        }
    }

    return Array.from(byId.values())
}

function getStoryboardEnvironmentText(sb: Pick<StoryboardWithRelations, 'scene' | 'imagePrompt' | 'actionDesc' | 'videoPrompt'>) {
    return [sb.scene?.name, sb.scene?.locationPrompt, sb.imagePrompt, sb.actionDesc, sb.videoPrompt].filter(Boolean).join('\n')
}

function stripCharacterBeautificationFromStylePrompt(prompt: string) {
    const characterOnlyPatterns = [/characters?/i, /face|facial|cheekbone/i, /waist|posture/i, /idol|portrait/i, /handsome|beautiful|attractive/i]
    const parts = prompt
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    const kept = parts.filter(part => !characterOnlyPatterns.some(pattern => pattern.test(part)))
    return kept.length > 0 ? kept.join(', ') : prompt
}

function stripCharacterWardrobeFromStylePrompt(prompt: string) {
    const characterWardrobePatterns = [
        /modern\s+chinese\s+costume\s+details/i,
        /jade\s+and\s+gold\s+accents/i,
        /elegant\s+fantasy\s+architecture/i,
        /ornate\s+(?:costume|robe|clothing|jewelry|accessories)/i,
        /jewelry|accessories|gold(?:en)?\s+trim/i
    ]
    const stripped = stripCharacterBeautificationFromStylePrompt(prompt)
    const parts = stripped
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    const kept = parts.filter(part => !characterWardrobePatterns.some(pattern => pattern.test(part)))
    return kept.length > 0 ? kept.join(', ') : stripped
}

function getStylePromptForCharacterState(prompt: string, hasVisibleCharacters: boolean) {
    return hasVisibleCharacters ? prompt : stripCharacterBeautificationFromStylePrompt(prompt)
}

function buildNoVisibleCharacterLock() {
    return 'NO VISIBLE CHARACTER LOCK: this storyboard has zero visible characters. Do NOT generate any person, humanoid, face, body, hands, clothing, silhouette, statue, portrait, reflection, or extra actor. The subject must be only the described location, object, atmosphere, light, or camera movement.'
}

function buildCloudEnvironmentLock(sb: Pick<StoryboardWithRelations, 'scene' | 'imagePrompt' | 'actionDesc' | 'videoPrompt'>) {
    const text = getStoryboardEnvironmentText(sb)
    if (!/(云|云雾|云层|白云|雾|烟霞|mist|cloud|fog|haze)/i.test(text)) return ''
    return (
        'CLOUD / MIST CONTINUITY LOCK: clouds or mist are a low, semi-transparent atmospheric layer, not an opaque foreground wall. ' +
        'Keep the garden/plaza/path/flower beds/architecture/main subject readable; clouds must not cover the center action, faces, hands, key object, or more than the lower foreground edge. ' +
        'Across frames and video, keep the cloud density, height, color and direction consistent; do not let clouds suddenly disappear or flood the whole frame.'
    )
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

function getSceneReferenceMode(scene: StoryboardWithRelations['scene']): 'exact' | 'identity' {
    return isBroadSceneLocation(scene) ? 'identity' : 'exact'
}

function buildScenePromptLock(scene: StoryboardWithRelations['scene'], hasSceneReference: boolean) {
    if (!scene) return ''
    const mode = getSceneReferenceMode(scene)
    if (hasSceneReference) {
        return mode === 'identity'
            ? 'SCENE IDENTITY LOCK: use the scene reference for the main location style, architecture/material language, color palette, atmosphere and light direction, but follow this storyboard imagePrompt/actionDesc for the specific sub-location and background. Do NOT force every shot into the exact same reference-image corner. CAMERA ANGLE FREEDOM: each shot can have completely different camera angles (wide/medium/close-up, eye-level/low-angle/high-angle, front/side/back) as long as the overall scene style/materials/colors remain consistent.'
            : 'SCENE LOCK: walls/floor color, room layout, light source direction and palette MUST match the scene reference image IDENTICALLY'
    }
    if (!scene.locationPrompt) return ''
    return mode === 'identity'
        ? `main scene identity (allow storyboard-specific sub-location/background): ${scene.locationPrompt}`
        : `scene (lock layout, walls/floor color, light direction verbatim): ${scene.locationPrompt}`
}

function buildVisualStateLock(params: {
    type: 'first_frame' | 'middle_frame' | 'last_frame'
    storyboard: StoryboardWithRelations
    charNames: string[]
    charAppearances: string[]
    frameActionDesc: string | null
    hasStateContinuityAnchor: boolean
    hasPreviousCharacterContinuity: boolean
    hasPreviousShotFrame: boolean
    ownFirstFrame: boolean
    continuityFrameLabel: string
    hasOpeningFrameBackup: boolean
    nextContinuityReferenceNumber: number | null
    nextContinuityFrameLabel: string
    scenePromptLock: string
    isDetailShot: boolean
}) {
    const anchors: string[] = []
    if (params.hasPreviousCharacterContinuity) {
        anchors.push('reference image #1 is the previous shot ending frame and locks current character state')
    } else if (params.hasPreviousShotFrame) {
        anchors.push('reference image #1 is the previous shot/environment anchor')
    } else if (params.ownFirstFrame) {
        anchors.push(`reference image #1 is the same-shot ${params.continuityFrameLabel}`)
    }
    if (params.hasOpeningFrameBackup) anchors.push('the opening-frame backup reference must remain consistent')
    if (params.nextContinuityReferenceNumber) {
        anchors.push(`reference image #${params.nextContinuityReferenceNumber} is the next confirmed ${params.nextContinuityFrameLabel}`)
    }
    if (anchors.length === 0) anchors.push('no prior frame anchor; use storyboard and character state exactly')

    const names = params.charNames.length ? params.charNames.join(', ') : 'no named visible character'
    const characterState = params.charAppearances.length ? params.charAppearances.join('; ') : 'use only explicitly listed visible subjects'
    const action = params.frameActionDesc || params.storyboard.actionDesc || 'a single readable visual beat'
    const scene = [params.storyboard.scene?.name, params.storyboard.scene?.locationPrompt, params.scenePromptLock].filter(Boolean).join(' — ') || 'current storyboard scene'
    const detail = params.isDetailShot
        ? ' Detail frame rule: this is a crop/push-in from the anchored character or object; keep the same sleeve, skin tone, dirt/blood, prop angle, light direction, and background palette.'
        : ''
    const wardrobeSource = params.hasStateContinuityAnchor
        ? 'copy wardrobe/body state from frame anchors, including exact garment colors, materials, silhouette, damage, dirt, blood, footwear and accessories'
        : 'copy wardrobe/body state from the character/storyboard text exactly; do not let style wording invent cleaner or more ornate clothing'

    return [
        `VISUAL STATE LOCK: Anchors: ${anchors.join('; ')}.`,
        `Characters: ${names}. Identity/state text: ${characterState}.`,
        `Wardrobe/body: ${wardrobeSource}; allowed wardrobe change: none unless the script explicitly says changing clothes, cleaning up, adding/removing jewelry, or losing/gaining a prop.`,
        `Expression/emotion: follow only this frame action (${action}); emotional intensity may progress gradually, but must not reset to calm/heroic/beautified if the previous state is painful, fearful, exhausted, dirty, or injured.`,
        `Pose/action: only pose, gaze, hands, body weight, step, hair/fabric motion and action progress may change for this ${params.type}; identity, age, wardrobe, props, lighting and scene state stay locked.${detail}`,
        `Scene/atmosphere: ${scene}; keep time of day, light direction/color, weather, fog/dust/cloud density, color palette, foreground/background anchors and character blocking compatible across adjacent frames.`,
        'Forbidden changes: wardrobe swap, new jewelry, clean makeup, beauty upgrade, face/age/body drift, changed hair, prop disappearance, new prop, extra people, scene reset, lighting/time jump, new architecture, text, subtitles, logos, watermark.'
    ].join(' ')
}

function buildVideoMotionPlan(sb: StoryboardWithRelations, visibleCharacters: StoryboardCharacterRelation[]) {
    const actionDesc = sb.actionDesc?.trim()
    const names = visibleCharacters.map(item => item.character.name).filter(Boolean)
    const hasVisibleCharacters = names.length > 0
    const subject = hasVisibleCharacters ? names.join(', ') : 'the explicit non-human subject, atmosphere, light, and camera'
    const labeled = actionDesc ? parseLabeledActionStates(actionDesc) : { opening: null, ending: null, middles: [] as Array<{ index: number; text: string }> }
    const performanceRule =
        'Give every gaze a named physical target from the shot (another character, a prop, a screen, a doorway, the floor or the event source); never default to the camera lens or vacant forward staring. Use motivated facial, finger, hand, shoulder and body-weight changes to reveal intention, not idle swaying.'

    if (!hasVisibleCharacters) {
        if (labeled.opening && labeled.ending) {
            const middleHint = labeled.middles.length > 0 ? ` Mid-shot must pass through: ${labeled.middles.map(m => m.text).join(' -> ')}.` : ''
            return [
                `MANDATORY MOTION ARC: begin exactly from opening state (${labeled.opening}).`,
                `During the shot, animate only ${subject}: slow cloud drift, petals, light shimmer, object bloom, or a gentle camera move. Do NOT add any people or humanoid figures.`,
                `${middleHint} End exactly at ending state (${labeled.ending}).`,
                'The semantic-beat director plan must derive variable-duration action phases, motivated framing, camera behavior and visual handoffs from this environment/object action.'
            ].join(' ')
        }

        if (actionDesc) {
            return [
                `MANDATORY MOTION ARC: animate this environment/object action visibly: ${actionDesc}.`,
                'No people may appear. Use readable object, atmosphere or light changes across the full duration; derive each variable-duration beat and its camera behavior from the visible progression.'
            ].join(' ')
        }

        return 'MANDATORY MOTION ARC: create subtle but visible environment/object progression with no people or humanoid figures. Derive variable-duration semantic beats and motivated camera behavior from that progression.'
    }

    if (labeled.opening && labeled.ending) {
        const middleHint = labeled.middles.length > 0 ? ` Mid-shot must pass through: ${labeled.middles.map(m => m.text).join(' -> ')}.` : ''
        return [
            `MANDATORY MOTION ARC: begin exactly from opening state (${labeled.opening}).`,
            `During the shot, ${subject} must visibly transition with clear head, gaze, hand, arm, torso, step, clothing or hair motion; do not hold the body centered and frozen.`,
            performanceRule,
            `${middleHint} End exactly at ending state (${labeled.ending}).`,
            'Derive variable-duration semantic beats, framing, camera direction, speed and visual handoffs from the subject action.'
        ].join(' ')
    }

    if (actionDesc) {
        return [
            `MANDATORY MOTION ARC: animate this action visibly: ${actionDesc}.`,
            `${subject} must not stand still in the center; show a readable pose, gaze, hand, body-weight, clothing, hair or step change across the full duration.`,
            performanceRule,
            'Derive variable-duration semantic beats, framing, camera direction, speed and visual handoffs from the subject action.'
        ].join(' ')
    }

    return `MANDATORY MOTION ARC: create a subtle but visible performance for ${subject}; establish an intention, a visible trigger, two motivated micro-actions and a changed ending emotion. ${performanceRule} Do not output a still image or a center-locked standing pose. Derive variable-duration semantic beats, motivated camera behavior and handoffs from the performance.`
}

function buildSeedanceNativeSpeechDirection(sb: StoryboardWithRelations) {
    const dialogue = sb.dialogue?.trim()
    const narration = sb.narration?.trim()
    if (!dialogue && !narration) return ''
    const turns = dialogue ? extractDialogueTurns(dialogue) : []
    const exactTurns = turns.map((turn, index) => `${index + 1}. ${turn.speakerName ? `${turn.speakerName} says` : 'The visible speaker says'} exactly: "${turn.text}"`).join(' ')
    const speakerRule = dialogue
        ? getDialogueSpeakerNames(dialogue).length > 1
            ? 'Only the named visible speaker talks during each dialogue turn; alternate speakers in the written order, with no shared voice, overlap, or reassigned lines.'
            : 'The visible speaking character performs the dialogue line; do not turn it into off-screen narration or add a competing visible speaker.'
        : ''
    const voiceOverTurns = narration ? extractDialogueTurns(narration) : []
    const exactVoiceOver = voiceOverTurns
        .map((turn, index) => `${index + 1}. Off-screen voice-over${turn.speakerName ? ` identified as ${turn.speakerName}` : ''} says exactly: "${turn.text}"`)
        .join(' ')
    const narrationRule = narration
        ? 'VOICE-OVER LOCK: narration remains off-screen. No visible character mouths, whispers, or appears to speak these words; use the visible performance only as a reaction or counterpoint.'
        : ''
    const actingContext = sb.actionDesc?.trim()
        ? `Acting and emotional source of truth: ${sb.actionDesc}. Preserve its intention, trigger, prop interaction and emotional change.`
        : 'Use natural short-drama emotion, motivated pauses and restrained gestures. Keep the speaker looking at a named person, prop or scene target rather than the camera lens.'
    return [
        'NATIVE DIALOGUE AND PERFORMANCE — HIGHEST PRIORITY:',
        exactTurns,
        speakerRule,
        exactVoiceOver,
        narrationRule,
        actingContext,
        'Generate spoken audio, facial expression, mouth articulation, breathing, pauses and matching ambient sound together in this one pass.'
    ]
        .filter(Boolean)
        .join(' ')
}

type VideoPromptCompileContext = {
    referenceAssets?: Seedance25ReferenceAsset[]
    referenceMode?: VideoReferenceMode
    generationNonce?: string
}

function extractExplicitEndingState(actionDesc: string | null | undefined) {
    if (!actionDesc?.trim()) return null
    const match = actionDesc.match(/(?:Ending state|Final state)\s*[:：]\s*([^\n]+)/i) ?? actionDesc.match(/(?:结束时|结束状态|最终状态)\s*[:：]\s*([^\n]+)/)
    return match?.[1]?.trim() || null
}

async function buildVideoText(
    sb: StoryboardWithRelations,
    videoLanguage: VideoLanguage,
    provider: VideoProvider,
    plannedDuration = normalizeVideoDuration(provider, sb.duration),
    compileContext: VideoPromptCompileContext = {}
): Promise<string> {
    const motionOverride = sb.motionOverride?.trim() || sb.videoPrompt?.trim()
    const fullPromptOverride = sb.fullPromptOverride?.trim()
    const referenceMode = compileContext.referenceMode ?? (isHiModelsVeoProvider(provider) ? 'text' : 'single')
    const languageLock = buildVideoLanguageLock(videoLanguage, sb.dialogue, sb.narration)
    const nativeSpeechDirection = provider === 'seedance' || provider === 'seedance25' || isHiModelsH3Provider(provider) ? buildSeedanceNativeSpeechDirection(sb) : ''
    const audioTimelineDirection = buildAudioTimelineDirection(normalizeStoryboardAudioPlan(sb.audioPlan, { duration: plannedDuration, dialogue: sb.dialogue, narration: sb.narration }))
    const providerConstraints = buildVideoProviderConstraintPackage(provider, {
        shotType: sb.shotType,
        duration: plannedDuration,
        dialogue: sb.dialogue,
        actionDesc: sb.actionDesc,
        imagePrompt: sb.imagePrompt,
        continuityMode: sb.continuityMode,
        characterCount: sb.characters.length
    })
    const style = await getStoryboardVisualStyle(sb.id)
    const aspectRatio = await getStoryboardVideoAspectRatio(sb.id)
    const visibleCharacters = await resolveStoryboardVisibleCharacters(sb)
    const characterStates = await resolveCharacterStatesForStoryboard(
        sb.id,
        visibleCharacters.map(item => item.character.id)
    )
    const hasVisibleCharacters = visibleCharacters.length > 0
    const motionPlan = buildVideoMotionPlan(sb, visibleCharacters)
    const cloudEnvironmentLock = buildCloudEnvironmentLock(sb)
    const hardLocks: string[] = []
    if (compileContext.referenceAssets?.some(asset => asset.purpose === 'character_turnaround')) {
        hardLocks.push(
            'CHARACTER TURNAROUND REFERENCE RULE: a supplied multi-view sheet shows repeated depictions of one identity. Reconstruct one coherent character from all angles, render that character only once per intended story occurrence, and never copy the sheet layout, white background, panels or duplicate bodies into the video.'
        )
    }

    // These slots are assembled after any LLM rewrite and cannot be deleted by
    // a custom motion instruction or a full-prompt override.
    if (nativeSpeechDirection && provider !== 'seedance25') hardLocks.push(nativeSpeechDirection)
    if (audioTimelineDirection && provider !== 'seedance25') hardLocks.push(audioTimelineDirection)
    if (provider !== 'seedance25') {
        hardLocks.push(getStylePromptForCharacterState(style.videoPromptPrefix, hasVisibleCharacters))
        hardLocks.push(getAspectRatioPrompt(aspectRatio))
        hardLocks.push(
            'the video MUST start identical to the first frame and end identical to the last frame if both are provided. ' +
                'preserve character identity, exact wardrobe colors and silhouettes, hair, scene layout, light direction, color palette, time of day across all frames. ' +
                'one continuous shot, no cuts, no scene transitions, no rapid wardrobe changes, no extra limbs, no face morphing'
        )
    }
    hardLocks.push(providerConstraints)
    hardLocks.push(productionDirection('video'))
    if (compileContext.generationNonce) hardLocks.push(freshGenerationInstruction(compileContext.generationNonce))
    if (hasVisibleCharacters) {
        hardLocks.push(
            'motion requirement: this must be a real moving video, not a still image. At least one visible character must clearly move through the described action with readable head, gaze, hand, arm, body-weight, clothing or hair motion while keeping identity stable'
        )
    } else {
        hardLocks.push(
            'motion requirement: this must be a real moving video with zero people. Animate only the environment, object, atmosphere, lighting, petals, clouds, or camera movement; do not invent any human figure.'
        )
        hardLocks.push(buildNoVisibleCharacterLock())
    }
    if (cloudEnvironmentLock) hardLocks.push(cloudEnvironmentLock)

    if (sb.actionDesc?.trim()) {
        hardLocks.push(
            `ACTING SOURCE OF TRUTH: ${sb.actionDesc.trim()} Preserve the described intention, trigger, prop interaction, gaze direction and emotional change; do not replace them with generic idle motion.`
        )
    }
    if (hasVisibleCharacters) {
        hardLocks.push(
            'PERFORMANCE LOCK: every gaze has a named physical target in the scene. Unless the storyboard explicitly addresses the viewer, never stare into the camera. Avoid vacant eyes, idle swaying, mannequin-like stillness, frozen opening holds, and generic breathing/blinking/hair motion as the main action.'
        )
    }

    if (sb.imagePrompt && provider !== 'seedance25') hardLocks.push(`visual subject and composition lock: ${sb.imagePrompt}`)

    // 把所有出场角色的外貌描述拼进去（最关键的一致性保证）
    const charDescs = visibleCharacters
        .map(c => {
            const name = c.character.name?.trim()
            const baseAppearance = c.character.appearancePrompt?.trim()
            const currentState = characterStates.get(c.character.id.toString())?.statePrompt
            const appearance = [baseAppearance, currentState ? `CURRENT TIMELINE STATE: ${currentState}` : null].filter(Boolean).join('; ')
            if (name && appearance) return `${name}: ${appearance}`
            return name || appearance || null
        })
        .filter(Boolean)
    if (charDescs.length > 0 && provider !== 'seedance25') {
        hardLocks.push(`characters (must be visible; lock identity & wardrobe verbatim): ${charDescs.join('; ')}`)
    }

    const scenePromptLock = buildScenePromptLock(sb.scene, false)
    if (scenePromptLock && provider !== 'seedance25') hardLocks.push(scenePromptLock)
    if (sb.dialogue && provider !== 'seedance25') hardLocks.push(`character speaks (lip-sync required): "${sb.dialogue}"`)
    if (sb.narration && provider !== 'seedance25') {
        hardLocks.push(`off-screen voice-over (never lip-sync to a visible character): "${sb.narration}"`)
    }
    if (provider !== 'seedance25') {
        hardLocks.push(languageLock)
        hardLocks.push(
            `opening composition: ${sb.shotType ?? 'medium'}. Follow the content-adaptive semantic-beat CAMERA and CONTINUITY/TRANSITION instructions exactly; do not replace them with one fixed movement for the whole video.`
        )
    }

    const compileFinalPrompt = (motionBody: string) => {
        if (provider !== 'seedance25') return [motionBody, ...hardLocks].filter(Boolean).join(', ')
        return compileSeedance25Prompt({
            duration: plannedDuration,
            generationGoal: sb.imagePrompt?.trim() || sb.actionDesc?.trim() || motionPlan,
            motionPlan: motionBody,
            endingState: extractExplicitEndingState(sb.actionDesc),
            characters: charDescs as string[],
            scene: sb.scene?.locationPrompt,
            visualStyle: `${style.label}; ${getStylePromptForCharacterState(style.videoPromptPrefix, hasVisibleCharacters)}`,
            shotType: sb.shotType ?? 'medium',
            referenceAssets: compileContext.referenceAssets,
            audioDirection: [nativeSpeechDirection, audioTimelineDirection].filter(Boolean).join(' '),
            languageDirection: languageLock,
            immutableConstraints: hardLocks
        })
    }

    if (fullPromptOverride) {
        return compileFinalPrompt(`FULL PROMPT OVERRIDE (user-authored creative body): ${fullPromptOverride}`)
    }
    if (motionOverride && isCompleteVideoTimeline(motionOverride, plannedDuration)) {
        return compileFinalPrompt(`SEMANTIC-BEAT ACTION/CAMERA/TRANSITION PLAN: ${motionOverride}`)
    }

    try {
        const improvedMotion = await improveVideoMotionPrompt({
            basePrompt: motionOverride || motionPlan,
            imagePrompt: sb.imagePrompt,
            actionDesc: sb.actionDesc,
            dialogue: sb.dialogue,
            shotType: sb.shotType,
            duration: plannedDuration,
            visualStyleLabel: style.label,
            visualStyleHint: style.hint,
            scenePrompt: sb.scene?.locationPrompt,
            characterDescriptions: charDescs as string[],
            hasFirstFrame: provider === 'seedance25' ? compileContext.referenceAssets?.some(asset => asset.purpose === 'opening_frame') === true : !!sb.firstFrameUrl,
            hasLastFrame: provider === 'seedance25' ? compileContext.referenceAssets?.some(asset => asset.purpose === 'ending_frame') === true : !!(sb.plannedLastFrameUrl ?? sb.lastFrameUrl),
            motionPlan,
            provider,
            referenceMode
        })
        return compileFinalPrompt(`SEMANTIC-BEAT ACTION/CAMERA/TRANSITION PLAN: ${improvedMotion}`)
    } catch (err) {
        console.warn('[Prompt] video motion rewrite failed, using deterministic motion slot:', err)
        return compileFinalPrompt(`SEMANTIC-BEAT ACTION/CAMERA/TRANSITION PLAN: ${motionPlan}`)
    }
}

function middleProgressPercent(index: number, count: number): number {
    return Math.round((index / (count + 1)) * 100)
}

function cleanActionStateText(value: string | undefined): string | null {
    const cleaned = value
        ?.replace(/\s+/g, ' ')
        .replace(/^[;；,，\s]+|[;；,，\s]+$/g, '')
        .trim()
    return cleaned || null
}

function parseLabeledActionStates(desc: string) {
    const labelPattern = [
        'Opening state',
        'Beginning state',
        'Start state',
        'Opening',
        'Middle state\\s*\\d+',
        'Middle\\s*\\d+',
        'Mid state\\s*\\d+',
        'Mid\\s*\\d+',
        'Ending state',
        'End state',
        'Ending',
        '开场状态',
        '首帧状态',
        '开始状态',
        '中间状态\\s*\\d+',
        '中间帧\\s*\\d+',
        '过渡状态\\s*\\d+',
        '过渡帧\\s*\\d+',
        '结束状态',
        '尾帧状态',
        '结尾状态'
    ].join('|')
    const stateRe = new RegExp(`(${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=(?:[;；\\n\\s]*)?(?:${labelPattern})\\s*[:：]|$)`, 'gi')
    const states: {
        opening: string | null
        ending: string | null
        middles: Array<{ index: number; text: string }>
    } = { opening: null, ending: null, middles: [] }

    let match: RegExpExecArray | null
    while ((match = stateRe.exec(desc))) {
        const label = match[1]
        const text = cleanActionStateText(match[2])
        if (!text) continue

        if (/^(opening|beginning|start)/i.test(label) || /^(开场状态|首帧状态|开始状态)$/.test(label)) {
            states.opening = text
            continue
        }
        if (/^(ending|end)/i.test(label) || /^(结束状态|尾帧状态|结尾状态)$/.test(label)) {
            states.ending = text
            continue
        }

        const index = Number(label.match(/\d+/)?.[0] ?? states.middles.length + 1)
        states.middles.push({ index: Number.isFinite(index) && index > 0 ? index : states.middles.length + 1, text })
    }

    states.middles.sort((a, b) => a.index - b.index)
    return states
}

function getExplicitMiddleState(middles: Array<{ index: number; text: string }>, index: number) {
    return middles.find(m => m.index === index)?.text ?? middles[index - 1]?.text ?? null
}

function buildMiddleFrameAction(params: { index: number; count: number; opening?: string | null; ending?: string | null; explicitMiddle?: string | null; rawAction?: string | null }) {
    const progress = middleProgressPercent(params.index, params.count)
    const movementRequirement =
        `This keyframe is about ${progress}% through the action and MUST be visibly different from reference image #1 / the previous frame: ` +
        'advance the active head, gaze, hands, arms, torso, step, clothing or hair motion; do not keep the same pose.'

    if (params.explicitMiddle) {
        const endingHint = params.ending ? ` It should still be moving toward the ending state (${params.ending}).` : ''
        return `middle state ${params.index}/${params.count} (${progress}% action progress): ${params.explicitMiddle}. ${movementRequirement}${endingHint}`
    }

    if (params.opening && params.ending) {
        return `intermediate action state ${params.index}/${params.count} (${progress}% action progress) between opening state (${params.opening}) and ending state (${params.ending}). ${movementRequirement}`
    }

    if (params.rawAction) {
        return `middle action state ${params.index}/${params.count} (${progress}% action progress): ${params.rawAction}. ${movementRequirement}`
    }

    return null
}

function getFrameActionDesc(actionDesc: string | null, type: 'first_frame' | 'middle_frame' | 'last_frame', opts: { middleFrameIndex?: number; middleFrameCount?: number } = {}): string | null {
    const desc = actionDesc?.trim()
    if (!desc) return null

    const middleIndex = Math.max(1, opts.middleFrameIndex ?? 1)
    const middleCount = Math.max(1, opts.middleFrameCount ?? 1)
    const labeled = parseLabeledActionStates(desc)
    if (labeled.opening || labeled.ending || labeled.middles.length > 0) {
        if (type === 'first_frame') {
            return labeled.opening ? `opening state: ${labeled.opening}` : `opening beat before the action progresses: ${desc}`
        }
        if (type === 'last_frame') {
            const ending = labeled.ending ?? labeled.middles[labeled.middles.length - 1]?.text
            return ending
                ? `ending state after the action completes: ${ending}. This final frame must be visibly different from the previous frame and show the completed action.`
                : `ending beat after this action completes: ${desc}`
        }
        return buildMiddleFrameAction({
            index: middleIndex,
            count: middleCount,
            opening: labeled.opening,
            ending: labeled.ending,
            explicitMiddle: getExplicitMiddleState(labeled.middles, middleIndex),
            rawAction: desc
        })
    }

    const structured = desc
        .replace(/\s+/g, ' ')
        .match(/(?:Opening state|Opening|开场状态|首帧状态|开始状态)\s*[:：]\s*([\s\S]*?)[;；]\s*(?:Ending state|Ending|结束状态|尾帧状态|结尾状态)\s*[:：]\s*([\s\S]+)/i)
    if (structured) {
        const opening = structured[1].trim()
        const ending = structured[2].trim()
        if (type === 'middle_frame') {
            return buildMiddleFrameAction({ index: middleIndex, count: middleCount, opening, ending })
        }
        return type === 'first_frame' ? `opening state: ${opening}` : `ending state after the action completes: ${ending}`
    }

    const arrow = desc.match(/^([\s\S]+?)\s*(?:->|→|=>)\s*([\s\S]+)$/)
    if (arrow) {
        const opening = arrow[1].trim()
        const ending = arrow[2].trim()
        if (type === 'middle_frame') {
            return buildMiddleFrameAction({ index: middleIndex, count: middleCount, opening, ending })
        }
        return type === 'first_frame' ? `opening state: ${opening}` : `ending state after the action completes: ${ending}`
    }

    if (type === 'last_frame') return `after this action completes: ${desc}. This final frame must be visibly different from the previous frame and show the completed action.`
    if (type === 'middle_frame') return buildMiddleFrameAction({ index: middleIndex, count: middleCount, rawAction: desc })
    return `action: ${desc}`
}

function pushUniqueReference(refs: string[], src: string | null | undefined) {
    if (src && !refs.includes(src)) refs.push(src)
}

function extractStoryboardAgeHint(storyboard: Pick<StoryboardWithRelations, 'imagePrompt' | 'actionDesc' | 'dialogue'>): string | null {
    const text = [storyboard.imagePrompt, storyboard.actionDesc, storyboard.dialogue].filter(Boolean).join(' ')
    const range = text.match(/\b(\d{1,2})\s*(?:-|~|–|—|to)\s*(\d{1,2})\s*(?:years?\s*old|year-old|岁)\b/i) ?? text.match(/(\d{1,2})\s*[、到至]\s*(\d{1,2})\s*岁/)
    if (range) return `${range[1]}-${range[2]} years old`

    const numeric = text.match(/\b(\d{1,2})\s*(?:years?\s*old|year-old)\b/i) ?? text.match(/(\d{1,2})\s*岁/)
    if (numeric) return `${numeric[1]} years old`

    const chineseAgeMap: Array<[RegExp, string]> = [
        [/十五六岁|十五、六岁|十五到十六岁|十五至十六岁/, '15-16 years old'],
        [/十四五岁|十四、五岁|十四到十五岁|十四至十五岁/, '14-15 years old'],
        [/十六七岁|十六、七岁|十六到十七岁|十六至十七岁/, '16-17 years old'],
        [/十七八岁|十七、八岁|十七到十八岁|十七至十八岁/, '17-18 years old'],
        [/十五岁/, '15 years old'],
        [/十六岁/, '16 years old'],
        [/十七岁/, '17 years old'],
        [/十八岁/, '18 years old'],
        [/十九岁/, '19 years old'],
        [/二十岁/, '20 years old']
    ]
    return chineseAgeMap.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

function sanitizeCharacterAppearanceForFrame(
    appearance: string | null | undefined,
    storyboard: Pick<StoryboardWithRelations, 'imagePrompt' | 'actionDesc' | 'dialogue'>,
    hasSameShotFrameAnchor: boolean
) {
    const raw = appearance?.replace(/\s+/g, ' ').trim()
    if (!raw) return null

    const storyboardAge = extractStoryboardAgeHint(storyboard)
    let cleaned = raw
    if (storyboardAge) {
        cleaned = cleaned.replace(/\bage\s*(?:about\s*)?(?:\d{1,2}|unknown|adult|成年|未知)\b/gi, `age ${storyboardAge}`).replace(/\b\d{1,2}\s*岁\b/g, storyboardAge)
    } else {
        // Tiny ages are often extraction mistakes from episode numbers. Avoid forcing baby/toddler features
        // unless the storyboard itself explicitly says this character is a baby or toddler.
        cleaned = cleaned
            .replace(/,\s*age\s*[0-2]\b/gi, '')
            .replace(/\bage\s*[0-2]\s*,?\s*/gi, '')
            .replace(/,\s*[0-2]\s*岁\b/g, '')
            .replace(/\b[0-2]\s*岁\s*,?\s*/g, '')
    }

    if (hasSameShotFrameAnchor && /consistent wardrobe colors and silhouette/i.test(cleaned)) {
        cleaned = cleaned.replace(/consistent wardrobe colors and silhouette/gi, 'wardrobe copied exactly from the same-shot frame anchor')
    }
    return cleaned.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim()
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

export type CharacterReferenceRole = 'turnaround_sheet' | 'full_body' | 'three_quarter_view' | 'profile' | 'back' | 'face'
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
    // One initial generation and at most one quality-triggered retry.
    const maxAttempts = 2
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
            maxAttempts,
            timings: { ...timings, totalMs: Date.now() - startedAt },
            providerSwitch
        })
    }
    const character = await prisma.character.findFirst({ where: { id: characterId, deletedAt: null } })
    if (!character) throw new Error('Character not found')

    const role = opts.role ?? 'turnaround_sheet'
    const generationQuality: ImageQuality = role === 'turnaround_sheet' ? 'ultra' : normalizeImageQuality(opts.quality)
    const generationSuffix = opts.generationNonce?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36) || String(Date.now())
    const filename = `char_ref_${characterId}_${role}_${Date.now()}_${generationSuffix}.png`
    const absPath = storageAbsPath(filename)

    const style = await getProjectVisualStyle(character.projectId)
    const styleLock = buildVisualStyleLock(style)
    const project = await getProjectNovelSetup(character.projectId)
    const styleRefs = await getProjectStyleReferenceImages(character.projectId)
    // Character references need one clear style signal. Feeding several style
    // boards alongside the identity image encourages image models to compose a
    // collage or reproduce several subjects.
    const characterStyleRefs = styleRefs.slice(0, 1)
    const styleContext = [style.label, style.hint, style.imagePromptPrefix, style.videoPromptPrefix, style.negativePrompt].filter(Boolean).join('\n')
    const animalOnlyStyle = /(?:animal characters?|animal animation|animal adventure|lion|lioness|hyena|dinosaur|dolphin|whale|no humans?|动物动画|动物王国|狮王|恐龙|海洋动物)/i.test(styleContext)
    const characterIdentityContext = [character.name, character.canonicalName, character.role, character.personality, character.appearancePrompt].filter(Boolean).join('\n')
    const explicitAnimalSpecies = characterReferenceAnimalSpecies(characterIdentityContext)
    const appearanceAnimalSpecies = characterReferenceAnimalSpecies(character.appearancePrompt)
    const animalIdentity = animalOnlyStyle || Boolean(explicitAnimalSpecies)
    const conflictingHumanCasting = /(?:\b(?:human|person|actor|actress|man|woman)\b|chinese drama casting|human face|human skin|human hairstyle|真人|人类|演员)/i.test(
        character.appearancePrompt ?? ''
    )
    let appearancePrompt = character.appearancePrompt?.trim() ?? ''
    if (animalIdentity && (!appearanceAnimalSpecies || conflictingHumanCasting)) {
        const storyContext = [project?.description, project?.setup.coreSeed, project?.setup.worldBible, project?.setup.characterArcs].filter(Boolean).join('\n')
        try {
            appearancePrompt = await rewriteAnimalCharacterAppearance({
                character,
                visualStyleContext: styleContext,
                storyContext
            })
        } catch (error) {
            console.warn('[Character] animal appearance rewrite failed, using deterministic fallback:', error instanceof Error ? error.message : error)
            appearancePrompt = `${explicitAnimalSpecies ?? 'story-accurate animal species'}, ${character.gender === '男' ? 'male' : character.gender === '女' ? 'female' : 'story-appropriate sex'}, species-accurate animal character named ${character.name}, ${character.role ?? 'supporting'} role, rendered in the selected ${style.label} style, distinctive species-appropriate colors and markings, authentic animal head and body anatomy, stable animal silhouette, original character design, no human, no humanoid body, no human face, no human skin, no human hairstyle, no human clothing`
        }
        await prisma.character.update({ where: { id: characterId }, data: { appearancePrompt } })
    }
    if (!appearancePrompt) throw new Error('Character has no appearance prompt')
    const resolvedAnimalSpecies = characterReferenceAnimalSpecies(appearancePrompt) ?? explicitAnimalSpecies
    const referencePolicy = resolveCharacterReferencePolicy(style, (opts.provider ?? 'banana') as CharacterReferenceImageProvider)
    const subjectProfile = characterReferenceSubjectProfile([resolvedAnimalSpecies, character.name, appearancePrompt].filter(Boolean).join(', '))
    const stableAppearancePrompt = sanitizeCharacterReferenceSheetPrompt(sanitizePromptForVisualStyle(appearancePrompt, style)) || sanitizePromptForVisualStyle(appearancePrompt, style)
    const referenceStylePrompt = sanitizeCharacterReferenceSheetPrompt(adaptCharacterReferenceStylePrompt(referencePolicy.stylePromptPrefix, referencePolicy.liveAction, animalIdentity))
    const referenceStyleLock =
        role === 'turnaround_sheet'
            ? `AUTHORITATIVE PROJECT CHARACTER STYLE: ${style.label} (${style.hint}). Apply this only to the character design, rendering medium, palette and material treatment; never add architecture, scenery, cinematic lighting, depth of field or a non-white background.`
            : styleLock.positive
    // 真人写实族使用自然妆容与真实皮肤锚；动漫/3D/插画和动物项目保留原有审美语义。
    const beauty =
        animalIdentity || subjectProfile === 'humanoid'
            ? getCharacterBeautyPrompt(character.gender, referencePolicy.liveAction, animalIdentity)
            : 'production-ready original character design, stable anatomy and silhouette, precise material construction, no human beauty reinterpretation'
    const subjectTypeLock = animalIdentity
        ? `ABSOLUTE SUBJECT TYPE: ${resolvedAnimalSpecies ?? 'the story-defined animal species'}, with authentic species anatomy. This character is not a human, actor or generic humanoid. Never render a human face, human skin, human hairstyle, human hands, human body proportions or human wardrobe.`
        : null
    const subjectTypeNegative = animalIdentity
        ? 'human, person, actor, actress, man, woman, human face, human skin, human hair, human hands, human body, human clothing, business suit, generic humanoid'
        : null
    const noTextPrompt =
        role === 'turnaround_sheet'
            ? 'Render character artwork only, with no typography or written glyphs anywhere on the canvas. Do not print titles, headings, module names, view names, angle names, words, letters, numbers, annotations, captions, measurement marks, footer text, signatures, logos or watermarks. The layout instructions must be expressed only through character placement and pose.'
            : 'PURE CHARACTER IMAGE ONLY. No overlaid captions, subtitles, title cards, corner marks, UI, signatures, or watermarks. In-world costume details such as nameplates, badges, insignia, emblems, and armbands are allowed and must be treated as part of the wardrobe, not as overlays.'
    const noTextNegative =
        role === 'turnaround_sheet'
            ? 'text, typography, written words, letters, numbers, headings, module labels, view labels, angle labels, annotations, captions, measurement marks, footer text, signature, watermark, logo, UI overlay, panel border, divider line'
            : 'overlaid caption, subtitle, title card, corner mark, signature, watermark, UI overlay, decorative border text'
    const identityReferenceRoleOrder: CharacterReferenceRole[] =
        role === 'back' ? ['profile', 'turnaround_sheet', 'full_body'] : role === 'profile' ? ['turnaround_sheet', 'full_body'] : ['turnaround_sheet', 'full_body']
    const selectedIdentityRows =
        role === 'turnaround_sheet'
            ? []
            : await prisma.characterReferenceAsset.findMany({
                  where: { characterId, role: { in: identityReferenceRoleOrder }, status: 'selected', deletedAt: null },
                  orderBy: { updatedAt: 'desc' },
                  select: { role: true, url: true }
              })
    const identityReferenceByRole = new Map<string, string>()
    for (const row of selectedIdentityRows) {
        if (!identityReferenceByRole.has(row.role)) identityReferenceByRole.set(row.role, row.url)
    }
    const selectedIdentityReferences =
        role === 'turnaround_sheet'
            ? []
            : Array.from(
                  new Set(
                      identityReferenceRoleOrder
                          .map(referenceRole =>
                              referenceRole === 'turnaround_sheet' ? (identityReferenceByRole.get(referenceRole) ?? character.referenceImageUrl) : identityReferenceByRole.get(referenceRole)
                          )
                          .filter((value): value is string => Boolean(value))
                  )
              )
    if (role !== 'turnaround_sheet' && !selectedIdentityReferences.length) throw new Error('请先定稿多视图角色设定板，再生成同一角色的单角度参考图')
    const framingPrompt = characterReferenceFramingPrompt(role, subjectProfile)
    const stylizedPrompt = [
        role === 'turnaround_sheet'
            ? 'TASK PRIORITY: create a neutral production identity sheet. Reference-sheet composition, neutral lighting and white-background rules override every conflicting cinematic, scene, action, pose, expression, depth-of-field or temporary prop instruction.'
            : 'TASK PRIORITY: create a neutral production identity reference. The requested reference angle, neutral lighting and white-background rules override conflicting cinematic or scene instructions.',
        `RENDERING STYLE ONLY: ${referenceStylePrompt || style.label}. ${referenceStyleLock}`,
        characterStyleRefs.length
            ? 'STYLE REFERENCE SCOPE: match only the art medium, rendering technique, palette, linework and material texture of the supplied style reference. Do not copy its subject, composition, pose, camera, depth of field, lighting, shadows or background.'
            : null,
        `STABLE CHARACTER IDENTITY: ${stableAppearancePrompt}`,
        subjectTypeLock,
        `IDENTITY PRESENTATION: ${beauty}`,
        selectedIdentityReferences.length
            ? 'IMPORTANT: supplied character references are identity, hairstyle, body-proportion and wardrobe evidence only; do not copy their pose or camera angle. The requested target view below has absolute priority.'
            : null,
        `COMPOSITION: ${framingPrompt}`,
        selectedIdentityReferences.length
            ? `${selectedIdentityReferences.length === 1 ? 'reference #1 is an approved view' : `references #1 through #${selectedIdentityReferences.length} are approved views`} of the SAME character; preserve the exact same face identity where visible, apparent age, hair shape and color, body proportions, skin tone, every garment color, material, seam, layer, accessory and footwear; infer only geometry hidden by the approved views, never redesign the character or wardrobe`
            : null,
        noTextPrompt,
        opts.generationNonce ? freshGenerationInstruction(opts.generationNonce) : null
    ]
        .filter(Boolean)
        .join('\n\n')

    let retryCorrection = ''
    let completedAttempt = 1
    let imageGenerationResult: ImageGenerationResult | null = null
    let activeGenerationProvider = referencePolicy.provider
    let retryingIdentityOrAngleMismatch = false
    let qualityProviderSwitch: ImageProviderSwitch | undefined
    let inspectionWarning: string | undefined
    let bestTurnaroundCandidate:
        | {
              bytes: Buffer
              generation: ImageGenerationResult
              score: number
              distinctViewCount: number
              duplicateViewCount: number
              warning: string
          }
        | undefined
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        completedAttempt = attempt + 1
        providerSwitch = qualityProviderSwitch
        await reportProgress('generating', completedAttempt)
        const generationStartedAt = Date.now()
        try {
            // A style board can pull an image model toward its human subject or
            // original pose. On a subject-type or angle retry, retain only the
            // approved identity evidence and remove that competing composition.
            const generationIdentityReferences = selectedIdentityReferences
            const generationStyleReferences = retryingIdentityOrAngleMismatch ? [] : characterStyleRefs
            imageGenerationResult = await generateImageUnified({
                prompt: [stylizedPrompt, retryCorrection].filter(Boolean).join(', '),
                negativePrompt: [
                    styleLock.negative,
                    noTextNegative,
                    role === 'turnaround_sheet' ? CHARACTER_TURNAROUND_SHEET_NEGATIVE : CHARACTER_SINGLE_SUBJECT_NEGATIVE,
                    subjectTypeNegative,
                    referencePolicy.negativePrompt
                ]
                    .filter(Boolean)
                    .join(', '),
                referenceImages: [...generationIdentityReferences, ...generationStyleReferences],
                outputAbsPath: absPath,
                aspectRatio: role === 'turnaround_sheet' ? CHARACTER_TURNAROUND_ASPECT_RATIO : role === 'face' ? '1:1' : '3:4',
                provider: activeGenerationProvider,
                quality: generationQuality,
                // Batch-created turnaround sheets have no established face anchor yet,
                // so they may use the existing provider fallback after Banana recovery is exhausted.
                // Face and three-quarter roles must preserve the selected identity reference and never fall back to text-only generation.
                automaticFallback: role === 'turnaround_sheet',
                contentLabel: `角色“${character.name}”参考图`,
                onProviderSwitch: async nextProviderSwitch => {
                    providerSwitch = nextProviderSwitch
                    await reportProgress('generating', completedAttempt)
                }
            })
            if (imageGenerationResult.providerSwitch && [408, 429].includes(imageGenerationResult.providerSwitch.status ?? 0)) {
                activeGenerationProvider = imageGenerationResult.actualProvider
            }
        } finally {
            timings.generationMs += Date.now() - generationStartedAt
        }

        await reportProgress('inspecting', completedAttempt)
        const inspectionStartedAt = Date.now()
        try {
            // Only overlays/watermarks block an otherwise usable sheet. Small
            // wardrobe glyphs are advisory and must not spend another full
            // image generation attempt.
            const strictNoText = false
            const [inspection, qualityInspection] = await Promise.all([
                inspectImageTextArtifacts(absPath, { strictNoText }),
                inspectCharacterReferenceQuality(absPath, role, subjectProfile, resolvedAnimalSpecies)
            ])
            const textArtifacts = Array.from(new Set([...inspection.blockingRegions, ...(strictNoText ? inspection.regions : [])]))
            if (strictNoText && inspection.hasText && textArtifacts.length === 0) textArtifacts.push('visible typography or annotation text')
            const turnaroundViewSummary = summarizeTurnaroundViews(qualityInspection)
            const turnaroundFullBodyViewCount = turnaroundViewSummary.totalViewCount
            const turnaroundDistinctViewCount = turnaroundViewSummary.distinctViewCount
            const duplicateViewPairs = turnaroundViewSummary.duplicateViewPairs
            const duplicateViews = turnaroundViewSummary.duplicateViewDetected
            const duplicateViewCount = turnaroundViewSummary.redundantViewCount
            const framingReady =
                role === 'turnaround_sheet'
                    ? qualityInspection.faceVisible &&
                      qualityInspection.fullBodyVisible &&
                      turnaroundFullBodyViewCount >= CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS &&
                      turnaroundFullBodyViewCount <= CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS &&
                      turnaroundDistinctViewCount >= CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS &&
                      qualityInspection.angleMatch &&
                      qualityInspection.faceCloseupVisible &&
                      qualityInspection.identityConsistentAcrossViews
                    : role === 'face'
                      ? qualityInspection.faceVisible
                      : qualityInspection.fullBodyVisible && (role === 'back' || qualityInspection.faceVisible)
            const rejectedByText = shouldRejectCharacterReferenceImage(inspection, { strictNoText })
            const qualityDecision = assessCharacterReferenceQuality(role, qualityInspection, rejectedByText)
            // Turnaround sheets must satisfy the same four-view contract
            // used by generation and inspection. Single-view roles keep their
            // existing strict behavior because hardRejected mirrors it there.
            const qualityRejected = qualityDecision.hardRejected
            if (!rejectedByText && !qualityRejected) {
                if (role === 'turnaround_sheet' && qualityDecision.advisoryIssues.length > 0) {
                    inspectionWarning = `多视图角色设定板已满足核心门槛，附加建议：${qualityDecision.advisoryIssues.join('、')}`
                }
                break
            }

            const duplicateReason = duplicateViews
                ? `turnaround_sheet 存在重复或近重复角度${duplicateViewPairs.length ? `（全身视图 ${duplicateViewPairs.join('、')}）` : ''}，${turnaroundFullBodyViewCount} 张全身图中仅有 ${turnaroundDistinctViewCount} 个有效不同角度`
                : ''
            const rejectionReasons = Array.from(
                new Set(
                    [
                        ...textArtifacts,
                        ...(role === 'turnaround_sheet' ? filterTurnaroundInspectionIssues(qualityInspection.issues) : qualityInspection.issues),
                        !qualityInspection.singleCharacter ? '不是同一角色身份' : '',
                        !qualityInspection.subjectTypeMatch ? `角色物种或身体结构不正确，应为 ${resolvedAnimalSpecies ?? subjectProfile}` : '',
                        role !== 'turnaround_sheet' && !qualityInspection.angleMatch ? `${role} 角度不正确` : '',
                        role === 'turnaround_sheet' && turnaroundDistinctViewCount < CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS
                            ? `turnaround_sheet 至少需要 ${CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS} 个真实不同的全身角度（检测到 ${turnaroundDistinctViewCount} 个）`
                            : '',
                        role === 'turnaround_sheet' && turnaroundFullBodyViewCount > CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS
                            ? `turnaround_sheet 最多保留 ${CHARACTER_TURNAROUND_MAX_FULL_BODY_VIEWS} 张全身视图（检测到 ${turnaroundFullBodyViewCount} 张）`
                            : '',
                        role === 'turnaround_sheet' ? duplicateReason : '',
                        !qualityInspection.whiteBackground ? '背景不是纯白' : '',
                        !framingReady ? `${role} 构图或视图覆盖不完整` : ''
                    ].filter(Boolean)
                )
            )
            const betterTurnaroundCandidate =
                !bestTurnaroundCandidate ||
                qualityDecision.candidateScore > bestTurnaroundCandidate.score ||
                (qualityDecision.candidateScore === bestTurnaroundCandidate.score && turnaroundDistinctViewCount > bestTurnaroundCandidate.distinctViewCount) ||
                (qualityDecision.candidateScore === bestTurnaroundCandidate.score &&
                    turnaroundDistinctViewCount === bestTurnaroundCandidate.distinctViewCount &&
                    duplicateViewCount < bestTurnaroundCandidate.duplicateViewCount)
            if (
                role === 'turnaround_sheet' &&
                qualityDecision.fallbackEligible &&
                turnaroundDistinctViewCount >= CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS &&
                imageGenerationResult &&
                betterTurnaroundCandidate
            ) {
                bestTurnaroundCandidate = {
                    bytes: await fs.readFile(/* turbopackIgnore: true */ absPath),
                    generation: imageGenerationResult,
                    score: qualityDecision.candidateScore,
                    distinctViewCount: turnaroundDistinctViewCount,
                    duplicateViewCount,
                    warning: duplicateViews
                        ? `多视图角色设定板重试后仍有重复或近重复角度${duplicateViewPairs.length ? `（全身视图 ${duplicateViewPairs.join('、')}）` : ''}，但保留了 ${turnaroundDistinctViewCount} 个有效不同角度；已选用重试中的最佳可用结果。${rejectionReasons.join('、')}`
                        : `多视图角色设定板未完全满足推荐构图，但保留了 ${turnaroundDistinctViewCount} 个有效不同角度；已选用重试中的最佳可用结果：${rejectionReasons.join('、') || '视图覆盖不完整'}`
                }
            }
            retryCorrection = characterReferenceRetryCorrection(role, qualityInspection, textArtifacts)
            retryingIdentityOrAngleMismatch = !qualityInspection.subjectTypeMatch || (!qualityInspection.angleMatch && ['turnaround_sheet', 'three_quarter_view', 'profile', 'back'].includes(role))
            if (retryingIdentityOrAngleMismatch && attempt + 1 < maxAttempts && !qualityProviderSwitch) {
                const nextProvider: ImageProvider = activeGenerationProvider === 'qwen-image-3.0-pro' ? 'banana' : 'qwen-image-3.0-pro'
                qualityProviderSwitch = {
                    from: activeGenerationProvider,
                    to: nextProvider,
                    reason: `${role} subject-type or fixed-angle gate failed; retrying the same reference with another model and targeted correction`,
                    status: 422,
                    attempts: attempt + 1,
                    contentLabel: `角色“${character.name}”${role}参考图`
                }
                activeGenerationProvider = nextProvider
                providerSwitch = qualityProviderSwitch
                await reportProgress('inspecting', completedAttempt)
                console.warn(`[Character] ${role} subject type or angle remained incorrect; switching only the current reference image to ${imageProviderLabel(nextProvider)}`)
            }
            console.warn(`[Character] rejected reference image (${attempt + 1}/${maxAttempts}), applying targeted composition correction:`, {
                textArtifacts,
                qualityIssues: qualityInspection.issues,
                singleCharacter: qualityInspection.singleCharacter,
                subjectTypeMatch: qualityInspection.subjectTypeMatch,
                fullBodyVisible: qualityInspection.fullBodyVisible,
                identityReady: qualityInspection.identityReady,
                angleMatch: qualityInspection.angleMatch,
                whiteBackground: qualityInspection.whiteBackground,
                frontViewVisible: qualityInspection.frontViewVisible,
                leftThreeQuarterViewVisible: qualityInspection.leftThreeQuarterViewVisible,
                leftProfileViewVisible: qualityInspection.leftProfileViewVisible,
                rearLeftThreeQuarterViewVisible: qualityInspection.rearLeftThreeQuarterViewVisible,
                backViewVisible: qualityInspection.backViewVisible,
                rearRightThreeQuarterViewVisible: qualityInspection.rearRightThreeQuarterViewVisible,
                rightProfileViewVisible: qualityInspection.rightProfileViewVisible,
                rightThreeQuarterViewVisible: qualityInspection.rightThreeQuarterViewVisible,
                faceCloseupVisible: qualityInspection.faceCloseupVisible,
                identityConsistentAcrossViews: qualityInspection.identityConsistentAcrossViews,
                fullBodyViewCount: turnaroundFullBodyViewCount,
                distinctFullBodyViewCount: turnaroundDistinctViewCount,
                duplicateViewDetected: duplicateViews,
                duplicateViewPairs
            })
            if (attempt + 1 === maxAttempts) {
                if (role === 'turnaround_sheet' && bestTurnaroundCandidate && bestTurnaroundCandidate.distinctViewCount >= CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS) {
                    await fs.writeFile(absPath, bestTurnaroundCandidate.bytes)
                    imageGenerationResult = bestTurnaroundCandidate.generation
                    inspectionWarning = bestTurnaroundCandidate.warning
                    console.warn('[Character] turnaround sheet missed advisory composition gates after retries; keeping the best usable candidate:', inspectionWarning)
                    break
                }
                throw new Error(`角色参考图连续 ${maxAttempts} 次未通过身份/构图门禁（${rejectionReasons.join('、') || '质量分不足'}），已停止使用该图片。`)
            }
            timings.retryCount += 1
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('角色参考图连续')) throw error
            inspectionWarning = error instanceof Error ? error.message : String(error)
            if (role === 'turnaround_sheet') {
                if (bestTurnaroundCandidate) {
                    await fs.writeFile(absPath, bestTurnaroundCandidate.bytes)
                    imageGenerationResult = bestTurnaroundCandidate.generation
                    inspectionWarning = `最新图片质检不可用，已恢复此前通过基本门禁的最佳候选：${inspectionWarning}`
                    console.warn('[Character] turnaround inspection failed; restoring the last verified usable candidate:', inspectionWarning)
                    break
                }
                throw new Error(`角色参考图质检失败，无法确认是否按顺序包含 ${CHARACTER_TURNAROUND_MIN_FULL_BODY_VIEWS} 个指定的真实不同角度：${inspectionWarning}`)
            }
            console.warn('[Character] reference inspection unavailable after retries; keeping the generated image:', inspectionWarning)
            break
        } finally {
            timings.inspectionMs += Date.now() - inspectionStartedAt
        }
    }

    if (imageGenerationResult && qualityProviderSwitch && !imageGenerationResult.providerSwitch) {
        imageGenerationResult = {
            ...imageGenerationResult,
            recovery: 'fallback_provider',
            fallbackReason: qualityProviderSwitch.reason,
            providerSwitch: qualityProviderSwitch
        }
    }
    if (imageGenerationResult && inspectionWarning) imageGenerationResult = { ...imageGenerationResult, inspectionWarning }

    await reportProgress('uploading', completedAttempt)
    let mediaUrl: string
    const uploadStartedAt = Date.now()
    try {
        mediaUrl = await saveImmutableLocalImage(absPath, `characters/${character.projectId}`, filename)
    } catch (err) {
        throw new Error(`角色参考图保存本地素材 失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
        timings.uploadMs += Date.now() - uploadStartedAt
    }

    await reportProgress('writing_db', completedAttempt)
    if ((opts.commit ?? true) && role === 'turnaround_sheet') {
        await prisma.character.update({
            where: { id: characterId },
            data: { referenceImageUrl: mediaUrl }
        })
    }
    if (!imageGenerationResult) throw new Error('角色参考图生成完成但缺少模型结果')
    return { url: mediaUrl, generation: imageGenerationResult }
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
export const VIDEO_PROMPT_VERSION = 'video-semantic-beats-v4'

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

type VideoPathFrame = {
    label: string
    providerUrl: string
    sourceUrl: string
}

type VideoSegmentResult = {
    relPath: string
    taskId: string
    requestBody: Record<string, unknown>
}

function parseMiddleFrameIndex(requestBody: string | null, fallback: number) {
    if (!requestBody) return fallback
    try {
        const parsed = JSON.parse(requestBody)
        const index = parsed?.middleFrameIndex
        return typeof index === 'number' && Number.isFinite(index) ? index : fallback
    } catch {
        return fallback
    }
}

async function ensureGenerationResultProviderUrl(generationId: bigint, src: string | null | undefined, provider?: VideoProvider): Promise<string | null> {
    if (provider === 'wan3' || provider === 'wan3prime') {
        return toDashScopeImageSource(src, 'middle_frame')
    }

    const direct = toProviderImageUrl(src, provider)
    if (direct) return direct

    if (!src) return null
    const rel = src.startsWith('/') ? src : `/${src}`
    if (!rel.startsWith('/storage/')) return null

    const filename = path.basename(rel)
    const absPath = storageAbsPath(filename)
    if (!fsSync.existsSync(absPath)) {
        throw new Error(`middle_frame 本地文件不存在，无法保存本地素材：${absPath}`)
    }

    try {
        const gen = await prisma.generation.findFirst({ where: { id: generationId }, select: { storyboard: { select: { episodeId: true } } } })
        const subdir = gen?.storyboard?.episodeId ? `storyboards/${gen.storyboard.episodeId}` : 'storyboards'
        const mediaUrl = await saveImmutableLocalImage(absPath, subdir, filename)
        await prisma.generation.update({
            where: { id: generationId },
            data: { resultUrl: mediaUrl }
        })
        return toLocalMediaUrl(mediaUrl)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`middle_frame 保存本地素材 失败：${msg}`)
    }
}

async function getSegmentVideoPathFrames(storyboard: StoryboardWithRelations, provider: VideoProvider): Promise<VideoPathFrame[]> {
    const middleRows = await prisma.generation.findMany({
        where: {
            storyboardId: storyboard.id,
            type: 'middle_frame',
            status: 'completed',
            resultUrl: { not: null }
        },
        select: { id: true, resultUrl: true, requestBody: true, createdAt: true },
        orderBy: { createdAt: 'asc' }
    })
    if (middleRows.length === 0) return []

    const plannedLastFrameUrl = storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl
    const firstFrameUrl = await ensureStoryboardFrameProviderUrl(storyboard.id, 'firstFrameUrl', storyboard.firstFrameUrl, provider)
    const lastFrameUrl = await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', plannedLastFrameUrl, provider)
    if (!firstFrameUrl || !lastFrameUrl) return []

    const sortedMiddleRows = middleRows
        .map((row, index) => ({ ...row, frameIndex: parseMiddleFrameIndex(row.requestBody, index + 1) }))
        .sort((a, b) => a.frameIndex - b.frameIndex || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))

    const middleFrames: VideoPathFrame[] = []
    for (const row of sortedMiddleRows) {
        const providerUrl = await ensureGenerationResultProviderUrl(row.id, row.resultUrl, provider)
        if (!providerUrl || !row.resultUrl) continue
        middleFrames.push({
            label: `intermediate frame ${middleFrames.length + 1}`,
            providerUrl,
            sourceUrl: row.resultUrl
        })
    }

    if (middleFrames.length === 0) return []
    return [
        { label: 'opening frame', providerUrl: firstFrameUrl, sourceUrl: storyboard.firstFrameUrl ?? firstFrameUrl },
        ...middleFrames,
        { label: 'ending frame', providerUrl: lastFrameUrl, sourceUrl: plannedLastFrameUrl ?? lastFrameUrl }
    ]
}

function buildSegmentVideoPrompt(basePrompt: string, from: VideoPathFrame, to: VideoPathFrame, index: number, total: number) {
    return [
        `SEGMENT ${index}/${total} of one continuous shot.`,
        `[Image 1] is the exact ${from.label}; [Image 2] is the exact ${to.label}.`,
        'Generate visible character motion from Image 1 to Image 2; do not output a still image.',
        'Characters must visibly move through the pose change: head, eyes, hands, arms, torso, body weight, steps, clothing and hair can move naturally.',
        'Do not keep the character standing in the center with only background movement.',
        'Keep identity, wardrobe, camera framing, lighting, scene layout and color palette stable. No cuts, no scene transition, no extra people.',
        basePrompt
    ].join(' ')
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

    // 上传到 local storage，DB 里存 local storage URL 而非本地相对路径，避免 pod 重启丢文件 → 前端 404
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
            // 原生对白必须在一次生成中完成。把多张中间帧拆成多个 Seedance
            // 子任务会让每段重复说整句、声音漂移，最后拼接的对白不可用。
            if (referenceMode === 'first_last' && !localizedStoryboard.dialogue?.trim() && !localizedStoryboard.narration?.trim()) {
                const segmentFrames = await getSegmentVideoPathFrames(localizedStoryboard, activeProvider)
                if (segmentFrames.length >= 3) {
                    if (activeProvider === 'seedance' || activeProvider === 'seedance25') {
                        return generateSegmentedVideoSeedance(generationId, localizedStoryboard, segmentFrames, activeProvider, videoLanguage, opts?.signal, opts?.comparisonOnly)
                    }
                }
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

async function generateSegmentedVideoSeedance(
    generationId: bigint,
    storyboard: StoryboardWithRelations,
    frames: VideoPathFrame[],
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
        const segmentCount = frames.length - 1
        const durationPlan = planVideoDuration(provider, storyboard.duration, segmentCount)
        const referenceVideos = getStoryboardReferenceVideos(storyboard)
        const basePrompt = await buildVideoText(storyboard, videoLanguage, provider, durationPlan.plannedDuration, {
            referenceMode: 'first_last',
            generationNonce: generationId.toString(),
            referenceAssets:
                provider === 'seedance25'
                    ? [
                          { index: 1, purpose: 'opening_frame' },
                          { index: 2, purpose: 'ending_frame' }
                      ]
                    : undefined
        })
        const ratio = await getStoryboardVideoAspectRatio(storyboard.id)
        const segmentResults: VideoSegmentResult[] = []
        const targetDuration = durationPlan.requestedDuration
        const segmentDurations = durationPlan.segmentDurations
        await prisma.generation.update({
            where: { id: generationId },
            data: {
                plannedDuration: durationPlan.plannedDuration,
                inputAssets: [
                    ...frames.map(frame => ({ type: 'image', role: frame.label, url: frame.sourceUrl })),
                    ...referenceVideos.map(video => ({ type: 'video', role: 'reference_video', ...video }))
                ],
                requestBody: JSON.stringify({
                    mode: 'segmented_i2v',
                    provider,
                    videoLanguage,
                    targetDuration,
                    segmentDurations,
                    segmentCount,
                    timelinePlanVersion: VIDEO_TIMELINE_PLAN_VERSION,
                    promptCompiler: provider === 'seedance25' ? SEEDANCE_25_PROMPT_COMPILER_VERSION : 'default',
                    frames: frames.map(f => ({ label: f.label, sourceUrl: f.sourceUrl }))
                })
            }
        })

        for (let index = 0; index < segmentCount; index += 1) {
            const from = frames[index]
            const to = frames[index + 1]
            const segmentPrompt = buildSegmentVideoPrompt(basePrompt, from, to, index + 1, segmentCount)
            const text = [
                referenceVideoPrompt(referenceVideos),
                provider === 'seedance25' ? segmentPrompt : `Use Image 1 as the exact opening frame and Image 2 as the exact final frame. ${segmentPrompt}`
            ]
                .filter(Boolean)
                .join(' ')
            const duration = segmentDurations[index] ?? 5
            const requestBody = {
                model,
                content: [
                    { type: 'text', text },
                    { type: 'image_url', image_url: { url: from.providerUrl }, role: provider === 'seedance25' ? 'reference_image' : 'first_frame' },
                    { type: 'image_url', image_url: { url: to.providerUrl }, role: provider === 'seedance25' ? 'reference_image' : 'last_frame' },
                    ...referenceVideos.map(video => ({ type: 'video_url', video_url: { url: video.url }, role: 'reference_video' }))
                ],
                ratio,
                duration,
                generate_audio: false,
                watermark: false
            }

            const created = await createSeedanceTaskWithAssetRecovery({
                baseUrl,
                apiKey: config.apiKey,
                requestBody,
                seedanceConfig: config,
                errorLabel: `Seedance segment ${index + 1} create error`,
                signal
            })
            const taskId = created.taskId

            await prisma.generation.update({
                where: { id: generationId },
                data: {
                    taskId: [...segmentResults.map(r => r.taskId), taskId].join(','),
                    requestBody: JSON.stringify({
                        mode: 'segmented_i2v',
                        provider,
                        videoLanguage,
                        targetDuration,
                        segmentDurations,
                        segmentCount,
                        promptCompiler: provider === 'seedance25' ? SEEDANCE_25_PROMPT_COMPILER_VERSION : 'default',
                        frames: frames.map(f => ({ label: f.label, sourceUrl: f.sourceUrl })),
                        activeSegment: index + 1,
                        ...(created.recovery ? { materialRecovery: created.recovery } : {})
                    })
                }
            })

            const videoUrl = await pollSeedanceTask(baseUrl, config.apiKey, taskId, undefined, signal)
            const segmentFilename = `video_${generationId}_seg${index + 1}.mp4`
            const segmentAbsPath = storageAbsPath(segmentFilename)
            await downloadFile(videoUrl, segmentAbsPath)
            const segmentDuration = await probeDuration(segmentAbsPath)
            if (!Number.isFinite(segmentDuration) || segmentDuration <= 0.05) {
                throw new Error(`Seedance segment ${index + 1} 视频无效：下载文件时长为 0`)
            }
            segmentResults.push({
                relPath: storageRelPath(segmentFilename),
                taskId,
                requestBody: {
                    ...created.requestBody,
                    ...(created.recovery ? { materialRecovery: created.recovery } : {})
                }
            })
        }

        const concatenatedRelPath = await concatStorageVideos(
            segmentResults.map(result => result.relPath),
            `video_${generationId}.mp4`
        )
        const finalRelPath = await withFfmpegSlot(() => addContinuousAmbientBedToVideo(concatenatedRelPath, storageRelPath(`video_${generationId}_ambient.mp4`)))
        await fs.unlink(storageAbsPath(path.basename(concatenatedRelPath))).catch(() => undefined)
        await completeVideoGeneration(generationId, storyboard.id, finalRelPath, {
            taskId: segmentResults.map(result => result.taskId).join(','),
            comparisonOnly,
            requestBody: JSON.stringify({
                mode: 'segmented_i2v',
                provider,
                audioPolicy: 'segment_audio_disabled_then_continuous_ambient_bed',
                videoLanguage,
                targetDuration,
                segmentDurations,
                segmentCount,
                promptCompiler: provider === 'seedance25' ? SEEDANCE_25_PROMPT_COMPILER_VERSION : 'default',
                frames: frames.map(f => ({ label: f.label, sourceUrl: f.sourceUrl })),
                segments: segmentResults.map((result, index) => ({
                    index: index + 1,
                    from: frames[index].label,
                    to: frames[index + 1].label,
                    taskId: result.taskId,
                    requestBody: result.requestBody
                }))
            })
        })
    } catch (err) {
        await failVideoGeneration(generationId, storyboard.id, err, `${provider === 'seedance25' ? SEEDANCE_25_LABEL : SEEDANCE_20_LABEL} segmented`, comparisonOnly)
    }
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

        const config2 = await getSeedanceConfig(provider)
        let useRefImages = false
        if (config2?.extra) {
            try {
                useRefImages = !!JSON.parse(config2.extra).useRefImages
            } catch {}
        }

        const imageContent: Array<Record<string, unknown>> = []
        const referenceAssets: Seedance25ReferenceAsset[] = []
        let frameReferenceCount = 0

        if (referenceMode !== 'text' && firstFrameUrl) {
            // i2v 模式：首帧 + 尾帧（如果有）一起传，让视频从 first 平滑过渡到 last
            imageContent.push({
                type: 'image_url',
                image_url: { url: firstFrameUrl },
                role: provider === 'seedance25' ? 'reference_image' : 'first_frame'
            })
            referenceAssets.push({ index: 1, purpose: 'opening_frame' })
            frameReferenceCount = 1
            const lastFrameUrl = toProviderImageUrl(plannedLastFrameUrl)
            if (referenceMode === 'first_last' && lastFrameUrl) {
                imageContent.push({
                    type: 'image_url',
                    image_url: { url: lastFrameUrl },
                    role: provider === 'seedance25' ? 'reference_image' : 'last_frame'
                })
                referenceAssets.push({ index: 2, purpose: 'ending_frame' })
                frameReferenceCount = 2
            }
        } else if (useRefImages) {
            // 回退：文生视频 + 风格/角色参考
            const refImages: Array<{ url: string; purpose: Seedance25ReferenceAsset['purpose']; subject?: string }> = []
            const styleRefs = await getStoryboardStyleReferenceImages(storyboard.id)
            for (const url of styleRefs) {
                const refUrl = toProviderImageUrl(url)
                if (refUrl) refImages.push({ url: refUrl, purpose: 'visual_style' })
                if (refImages.length >= 2) break
            }
            for (const c of storyboard.characters) {
                const refUrl = toProviderImageUrl(c.character.referenceImageUrl)
                if (refUrl) {
                    refImages.push({ url: refUrl, purpose: 'character_turnaround', subject: c.character.name ?? undefined })
                }
                if (refImages.length >= 3) break
            }
            for (const reference of refImages) {
                imageContent.push({
                    type: 'image_url',
                    image_url: { url: reference.url },
                    role: 'reference_image'
                })
                referenceAssets.push({ index: referenceAssets.length + 1, purpose: reference.purpose, subject: reference.subject })
            }
        }

        const referenceVideos = getStoryboardReferenceVideos(storyboard)
        const baseText = await buildVideoText(storyboard, videoLanguage, provider, duration, {
            referenceMode,
            generationNonce: generationId.toString(),
            referenceAssets
        })
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
                    promptCompiler: provider === 'seedance25' ? SEEDANCE_25_PROMPT_COMPILER_VERSION : 'default'
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
                    promptCompiler: provider === 'seedance25' ? SEEDANCE_25_PROMPT_COMPILER_VERSION : 'default',
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
        const prompt = await buildVideoText(storyboard, videoLanguage, provider, duration, { referenceMode, generationNonce: generationId.toString() })
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
        const text = await buildVideoText(storyboard, videoLanguage, provider, plannedDuration, { referenceMode, generationNonce: generationId.toString() })
        const ratio = await getStoryboardVideoAspectRatio(storyboard.id)
        const aspectRatio = ratio === '9:16' ? '9:16' : ratio === '1:1' ? '1:1' : '16:9'
        const referenceVideos = getStoryboardReferenceVideos(storyboard)
        const referenceImages: HiModelsVideoReferenceImage[] = []

        if (referenceMode !== 'text') {
            const firstFrameUrl =
                (await ensureStoryboardFrameProviderUrl(storyboard.id, 'firstFrameUrl', storyboard.firstFrameUrl, provider)) ??
                (referenceMode === 'single' ? await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl, provider) : null)
            if (!firstFrameUrl) throw new Error(`${label} 图生视频需要至少一张插图：请先生成插图后再生成视频`)
            referenceImages.push({ url: firstFrameUrl, role: 'first_frame' })

            if (referenceMode === 'first_last') {
                const lastFrameUrl = await ensureStoryboardFrameProviderUrl(storyboard.id, 'plannedLastFrameUrl', storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl, provider)
                if (!lastFrameUrl) throw new Error('首尾帧模式至少需要两张插图，并且必须包含首图和末图')
                referenceImages.push({ url: lastFrameUrl, role: 'last_frame' })
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
        storyboard = { ...storyboard, actionDesc: resolveStoryboardActionDesc(storyboard.actionPlan, storyboard.actionDesc) }
        const imageQuality = normalizeImageQuality(opts?.imageQuality)
        const visibleCharacters = await resolveStoryboardVisibleCharacters(storyboard)
        const characterStates = await resolveCharacterStatesForStoryboard(
            storyboard.id,
            visibleCharacters.map(item => item.character.id)
        )
        // === 收集参考图 ===
        const preferredIdentityRole = characterReferenceRoleForShot({
            shotType: storyboard.shotType,
            actionDesc: storyboard.actionDesc,
            imagePrompt: storyboard.imagePrompt
        })
        const characterIds = visibleCharacters.map(item => item.character.id)
        const identityAssetRows = characterIds.length
            ? await prisma.characterReferenceAsset.findMany({
                  where: {
                      characterId: { in: characterIds },
                      role: 'turnaround_sheet',
                      status: 'selected',
                      deletedAt: null
                  },
                  orderBy: { updatedAt: 'desc' },
                  select: { characterId: true, role: true, url: true }
              })
            : []
        const identityAssetsByCharacter = new Map<string, string>()
        for (const asset of identityAssetRows) {
            const key = `${asset.characterId}:${asset.role}`
            if (!identityAssetsByCharacter.has(key)) identityAssetsByCharacter.set(key, asset.url)
        }
        const characterReferenceSelections = visibleCharacters.map(({ character }) => {
            const currentState = characterStates.get(character.id.toString())
            const primarySheetUrl = identityAssetsByCharacter.get(`${character.id}:turnaround_sheet`) ?? character.referenceImageUrl
            const selectedIdentityRole = characterReferenceFallbackRoles(preferredIdentityRole).find(role => identityAssetsByCharacter.has(`${character.id}:${role}`)) ?? 'turnaround_sheet'
            const identityUrl = identityAssetsByCharacter.get(`${character.id}:${selectedIdentityRole}`) ?? primarySheetUrl ?? null
            return {
                character,
                currentState,
                preferredIdentityRole,
                selectedIdentityRole,
                primaryUrl: identityUrl
            }
        })
        const charRefs: string[] = []
        for (const selection of characterReferenceSelections) pushUniqueReference(charRefs, selection.primaryUrl)
        const hasTurnaroundSheetReference = characterReferenceSelections.some(selection => selection.selectedIdentityRole === 'turnaround_sheet')
        const sceneReferenceRow = storyboard.scene?.id
            ? await prisma.scene.findFirst({
                  where: { id: storyboard.scene.id, deletedAt: null },
                  select: { referenceImageUrl: true, referenceAssets: true }
              })
            : null
        const selectedSceneReferences = getSelectedSceneReferenceUrls(sceneReferenceRow?.referenceAssets, sceneReferenceRow?.referenceImageUrl)

        // 独立镜头自己建立画面；只有通过连续性门禁的 continuous/seamless
        // 镜头，首帧才继承上一镜的规划末图（旧数据才回退实际末帧）。
        const generationSnapshot = await prisma.generation.findUnique({ where: { id: generationId }, select: { resourceVersion: true } })
        const sbRow = await prisma.storyboard.findFirst({
            where: { id: storyboard.id, deletedAt: null },
            select: { episodeId: true, order: true, firstFrameUrl: true, sceneId: true, operationVersion: true }
        })
        if (!generationSnapshot || !sbRow || generationSnapshot.resourceVersion !== sbRow.operationVersion) {
            await cancelStaleGeneration(generationId)
            return false
        }
        const ownFirstFrame = type !== 'first_frame' ? (opts?.continuityFrameUrl ?? sbRow?.firstFrameUrl ?? null) : null
        const previousShotFrame = type === 'first_frame' ? (opts?.previousShotFrameUrl ?? null) : null
        const previousContinuityMode = previousShotFrame ? (opts?.previousContinuityMode ?? 'continuous') : null
        const hasNarrativeStateAnchor = previousContinuityMode === 'stateful'
        const previousShotFrameLabel = opts?.previousShotFrameLabel ?? 'previous shot ending frame'
        const openingFrameAnchor = type !== 'first_frame' ? (sbRow?.firstFrameUrl ?? null) : null
        const hasOpeningFrameBackup = !!ownFirstFrame && !!openingFrameAnchor && ownFirstFrame !== openingFrameAnchor
        const continuityFrameLabel = opts?.continuityFrameLabel ?? 'opening frame'
        const nextContinuityFrameUrl = type !== 'first_frame' ? (opts?.nextContinuityFrameUrl ?? null) : null
        const nextContinuityFrameLabel = opts?.nextContinuityFrameLabel ?? 'next frame'
        let nextContinuityReferenceNumber: number | null = null
        const hasPreviousCharacterContinuity = !!previousShotFrame && visibleCharacters.length > 0
        const hasStateContinuityAnchor = !!ownFirstFrame || !!previousShotFrame

        // 上一镜末帧或同一镜头的上一张关键帧始终作为 reference image #1。
        const requestedImageProvider = opts?.provider ?? (await getImageProvider())
        // Text-only providers are routed to Banana for reference-bearing requests.
        // Budget against the effective provider so this list is never silently truncated later.
        const referenceBudgetProvider = resolveImageProviderForReferences(requestedImageProvider, Math.max(1, selectedSceneReferences.length))
        const referenceImageBudget = getImageProviderCapability(referenceBudgetProvider)?.maxImageReferences ?? 0
        const referenceImages: string[] = []
        const pushBudgetedReference = (url: string | null | undefined) => {
            if (!url || referenceImages.includes(url) || referenceImages.length >= referenceImageBudget) return false
            referenceImages.push(url)
            return true
        }
        pushBudgetedReference(previousShotFrame)
        pushBudgetedReference(ownFirstFrame)
        // 中间帧/末帧如果以上一张中间帧为 #1，也把本镜首帧作为 #2 备份锚点，
        // 防止动作越生成越漂，尤其是年龄、服装和角色轮廓。
        if (hasOpeningFrameBackup) pushBudgetedReference(openingFrameAnchor)
        pushBudgetedReference(nextContinuityFrameUrl)
        if (nextContinuityFrameUrl) {
            const index = referenceImages.indexOf(nextContinuityFrameUrl)
            nextContinuityReferenceNumber = index >= 0 ? index + 1 : null
        }

        // === 构造 prompt ===
        const charNames = visibleCharacters.map(c => c.character.name).filter(Boolean)
        const hasVisibleCharacters = visibleCharacters.length > 0
        let charAppearances = visibleCharacters
            .map(c => {
                const name = c.character.name?.trim()
                const baseAppearance = sanitizeCharacterAppearanceForFrame(c.character.appearancePrompt, storyboard, !!ownFirstFrame)
                const currentState = characterStates.get(c.character.id.toString())?.statePrompt
                const appearance = [baseAppearance, currentState ? `CURRENT TIMELINE STATE: ${currentState}` : null].filter(Boolean).join('; ')
                if (name && appearance) return `${name}: ${appearance}`
                return name || appearance || null
            })
            .filter((value): value is string => !!value)
        const isDetailShot = !!(
            charNames.length > 0 &&
            storyboard.imagePrompt &&
            /\bclose[-\s]?up\b|\bextreme[-\s]?close\b|\bdetail\s+shot\b|\bfeet\b|\bhands?\b|\bfingers?\b|\bfoot\b|\bankle\b|\bwrist\b/i.test(storyboard.imagePrompt) &&
            !/\bfull\s+body\b|\bmedium\s+shot\b|\bwide\s+shot\b/i.test(storyboard.imagePrompt)
        )
        const characterPresenceLock =
            charNames.length > 0
                ? isDetailShot
                    ? `CHARACTER OWNERSHIP LOCK: this is a detail/close-up shot belonging to ${charNames.join(', ')}. The body part, skin tone, garment fabric and accessories shown MUST match ${charNames.join(', ')}'s appearance. Do NOT substitute with a different person, servant, background character, or unidentified extra. The visible detail (feet, hands, clothing fragment, etc.) must visually belong to ${charNames.join(', ')}.`
                    : `MANDATORY CHARACTER PRESENCE LOCK: exactly these ${charNames.length} named character(s) must be visible in this frame: ${charNames.join(', ')}. Do NOT let any listed character disappear, be replaced, be hidden behind objects, be cropped out, or turn into an unrecognizable extra. Do NOT add new people.`
                : ''
        const characterDetailLock =
            charAppearances.length > 0
                ? `VISIBLE CHARACTER DETAILS LOCK: ${charAppearances.join('; ')}. Keep these face, hair, age and body silhouette explicit in the image prompt. ${
                      hasStateContinuityAnchor
                          ? `For this ${previousShotFrame ? 'cross-shot' : 'same-shot'} continuation, wardrobe colors, garment materials and silhouette must come from reference image #1; if an opening-frame backup or next-frame anchor exists, it must remain consistent too.`
                          : 'Keep wardrobe colors and materials explicit in the image prompt.'
                  }`
                : ''
        const previousShotContinuityLock =
            previousShotFrame && type === 'first_frame'
                ? hasNarrativeStateAnchor
                    ? `PREVIOUS SHOT STORY-STATE LOCK: reference image #1 is the ${previousShotFrameLabel}, used as a STATE reference rather than a composition template. Preserve the same story moment, shared character identity, current wardrobe colors/materials/silhouette, dirt/injuries, persistent props, scene identity, time of day, light direction and color palette. Follow the current shot's named-character list as the source of truth: allow the requested reverse shot, new crop/angle, and characters entering or leaving; do not copy a person who is absent from the current list. The result must feel like another camera in the same scene, not a redesigned world.`
                    : `PREVIOUS SHOT CONTINUITY LOCK: reference image #1 is the ${previousShotFrameLabel}. Carry over the exact visible character identities and count, apparent age, hair, wardrobe colors/materials/silhouette, dirt/injuries, props, time of day, light direction and color palette. This new opening frame may change only camera distance/angle and advance to the explicitly described opening pose. It must look like the immediate next shot, not a redesigned scene or reset character state.`
                : ''
        const frameContinuityLock =
            ownFirstFrame && type !== 'first_frame'
                ? `FRAME CONTINUITY LOCK: reference image #1 is the ${continuityFrameLabel} of this same shot. Treat it as the highest-priority visual anchor: same visible characters, same character count, same apparent age, same body proportions, same face identity, same hair, exact same wardrobe colors/materials/silhouette, same camera/framing, same scene layout and same lighting. ${
                      hasOpeningFrameBackup ? 'Reference image #2 is the opening frame of this same shot; use it as the original age/wardrobe backup anchor and keep #1 and #2 consistent. ' : ''
                  }Character reference images are identity references only here; never copy a conflicting age or outfit from them over the same-shot frame anchors. Change only the pose/expression/hand/body movement needed for this ${type === 'middle_frame' ? 'intermediate frame' : 'ending frame'}, but make that movement clearly visible.`
                : ''
        const nextFrameContinuityLock =
            nextContinuityFrameUrl && nextContinuityReferenceNumber && type !== 'first_frame'
                ? `NEXT FRAME CONTINUITY LOCK: reference image #${nextContinuityReferenceNumber} is the ${nextContinuityFrameLabel}. This generated ${type === 'middle_frame' ? 'intermediate frame' : 'ending frame'} must cut smoothly from reference image #1 into reference image #${nextContinuityReferenceNumber}. Preserve visible character count, identity, apparent age, hair, wardrobe colors/materials/silhouette, dirt/injuries, props, scene layout, camera language and lighting across both anchors; interpolate only the pose, expression, gaze, hand/body motion and action progress. Do NOT introduce wardrobe, jewelry, props, people, lighting or background elements that are absent from both continuity anchors, and do NOT contradict the next confirmed frame.`
                : ''
        const noVisibleCharacterLock = hasVisibleCharacters ? '' : buildNoVisibleCharacterLock()
        const cloudEnvironmentLock = buildCloudEnvironmentLock(storyboard)
        const sceneReferenceMode = getSceneReferenceMode(storyboard.scene)
        const shouldUseSceneImageReferences = selectedSceneReferences.length > 0 && (sceneReferenceMode === 'exact' || selectedSceneReferences.length > 1)
        const activeSceneReferences = shouldUseSceneImageReferences ? selectedSceneReferences : []
        let scenePromptLock = buildScenePromptLock(storyboard.scene, shouldUseSceneImageReferences)

        const ep = sbRow ? await prisma.episode.findFirst({ where: { id: sbRow.episodeId }, select: { projectId: true } }) : null
        const frameStyle = ep ? await getProjectVisualStyle(ep.projectId) : getVisualStyleForSetup(undefined)
        const frameStyleLock = buildVisualStyleLock(frameStyle)
        const seedanceIllustrationSafety = getSeedanceIllustrationSafety(opts?.videoProvider, hasVisibleCharacters)
        const imageNegativePrompt = [frameStyleLock.negative, seedanceIllustrationSafety?.negative].filter(Boolean).join(', ')
        charAppearances = charAppearances.map(appearance => sanitizePromptForVisualStyle(appearance, frameStyle))
        scenePromptLock = sanitizePromptForVisualStyle(scenePromptLock, frameStyle)
        const aspectRatio = ep ? await getProjectVideoAspectRatio(ep.projectId) : '9:16'
        const styleRefs = ep ? await getProjectStyleReferenceImages(ep.projectId) : []

        // 强连续镜头只信任上一帧，避免参考卡把衣服拉回初始设定。
        // 剧情连续镜头允许换机位/人物进出，因此同时补充少量标准身份参考；
        // 服装和场景状态仍由 reference #1 决定，身份参考只负责抑制逐镜脸部漂移。
        if (!hasStateContinuityAnchor || hasNarrativeStateAnchor) {
            // Every visible character receives one primary slot before any
            // scene or style slot. Story state stays in the text prompt instead
            // of becoming a pose/expression image that can conflict with the
            // current storyboard action.
            for (const selection of characterReferenceSelections) pushBudgetedReference(selection.primaryUrl)
        }
        for (const sceneReference of activeSceneReferences) pushBudgetedReference(sceneReference)
        if (!hasStateContinuityAnchor || hasNarrativeStateAnchor) {
            for (const ref of styleRefs.slice(0, hasNarrativeStateAnchor ? 1 : 2)) pushBudgetedReference(ref)
        }

        const referenceRoles: ImageReferenceRole[] = [
            {
                url: previousShotFrame,
                description: hasNarrativeStateAnchor
                    ? 'the previous shot planned ending frame; authoritative for current wardrobe/body state, persistent props, scene identity, time of day and lighting, but not the new camera composition or current named-character list'
                    : 'the previous shot planned ending frame; authoritative pixel-continuity anchor for visible identities, character count, wardrobe/body state, props, scene and lighting'
            },
            {
                url: ownFirstFrame,
                description: `the same-shot ${continuityFrameLabel}; authoritative for identity, age, wardrobe/body state, character count, camera, scene and lighting`
            },
            {
                url: hasOpeningFrameBackup ? openingFrameAnchor : null,
                description: 'the original opening-frame backup for this shot; prevents accumulated age, face, wardrobe, camera and scene drift'
            },
            {
                url: nextContinuityFrameUrl,
                description: `the next confirmed ${nextContinuityFrameLabel}; an ending boundary to approach without copying it prematurely`
            },
            ...characterReferenceSelections.map(selection => ({
                url: selection.primaryUrl,
                description: hasStateContinuityAnchor
                    ? `selected ${characterReferenceRoleLabel(selection.selectedIdentityRole)} identity reference for named character "${selection.character.name}"; preferred angle was ${characterReferenceRoleLabel(selection.preferredIdentityRole)}; use all depicted angles only to reconstruct one identity, never copy a multi-view sheet layout or duplicate the person; current wardrobe/body state and props stay controlled by the frame anchor and text state: ${selection.currentState?.statePrompt ?? ''}`
                    : `selected ${characterReferenceRoleLabel(selection.selectedIdentityRole)} identity reference for named character "${selection.character.name}"; preferred angle was ${characterReferenceRoleLabel(selection.preferredIdentityRole)} for shot "${storyboard.shotType ?? 'medium'}"; use all depicted angles only to reconstruct one authoritative face, hair, age and body identity, never copy a multi-view sheet layout or duplicate the person; current story state comes from text: ${selection.currentState?.statePrompt ?? ''}`
            })),
            ...activeSceneReferences.map((url, index) => ({
                url,
                description: `${sceneReferenceMode} scene reference view ${index + 1} of ${activeSceneReferences.length}; use the selected views together to reconstruct one coherent location, preserve architecture, persistent furnishings, materials, palette and base light direction, never copy people or force the current shot to duplicate one reference composition`
            })),
            ...styleRefs.slice(0, !hasStateContinuityAnchor || hasNarrativeStateAnchor ? (hasNarrativeStateAnchor ? 1 : 2) : 0).map(url => ({
                url,
                description: 'project art-direction reference only; copy rendering style, palette and material language, never its people, clothing, objects, pose, layout or composition'
            }))
        ]
        const referenceRoleMap = buildImageReferenceRoleMap(referenceImages, referenceRoles)

        const promptParts: string[] = []
        promptParts.push(
            hasStateContinuityAnchor ? stripCharacterWardrobeFromStylePrompt(frameStyle.imagePromptPrefix) : getStylePromptForCharacterState(frameStyle.imagePromptPrefix, hasVisibleCharacters)
        )
        // 硬锚（fallback 也带这些）
        promptParts.push(
            `style anchors: ${frameStyle.hint}, consistent art style, cinematic quality, no text, no subtitles, no watermark, no logos, no extra limbs, no distorted hands, no face morphing`,
            frameStyleLock.positive
        )
        if (seedanceIllustrationSafety) promptParts.push(seedanceIllustrationSafety.positive)
        promptParts.push(
            'OBJECT SOURCE LOCK: only include props, monuments, stones, tablets, altars, weapons, signs, inscriptions, and symbolic objects that are explicitly named in this storyboard or scene. Do not invent testing stones, soul stones, black stone monuments, carved labels, readable Chinese characters, or written object names.'
        )
        if (noVisibleCharacterLock) promptParts.push(noVisibleCharacterLock)
        if (cloudEnvironmentLock) promptParts.push(cloudEnvironmentLock)
        if (styleRefs.length > 0 && (!hasStateContinuityAnchor || hasNarrativeStateAnchor)) {
            promptParts.push('match the EXACT art direction, rendering style, color palette, linework/material texture and lighting of the provided style reference image')
        }
        const frameActionDesc = storyboard.actionDesc
            ? getFrameActionDesc(storyboard.actionDesc, type, {
                  middleFrameIndex: opts?.middleFrameIndex,
                  middleFrameCount: opts?.middleFrameCount
              })
            : null
        if (charRefs.length > 0 && (!hasStateContinuityAnchor || hasNarrativeStateAnchor)) {
            if (hasTurnaroundSheetReference) {
                promptParts.push(
                    'TURNAROUND SHEET USAGE LOCK: the reference sheet repeats one character across front, 45-degree, side, back and face-detail views. Use it only to reconstruct the requested angle and stable identity. Render each named character once; never output a contact sheet, white studio background, repeated bodies or multiple views.'
                )
            }
            promptParts.push(
                hasNarrativeStateAnchor
                    ? 'CANONICAL IDENTITY RE-ANCHOR: character reference images after reference #1 lock face structure, age, hair and body identity only. Current wardrobe, dirt/injuries, props, scene and lighting MUST continue from reference image #1 and the current shot state; never reset them to an older character-card outfit.'
                    : 'IDENTITY LOCK: face structure, hair color and length, every wardrobe garment color and silhouette MUST match the character reference image(s) IDENTICALLY (do not paraphrase wardrobe colors)'
            )
        }
        const visualStateLock = buildVisualStateLock({
            type,
            storyboard,
            charNames,
            charAppearances,
            frameActionDesc,
            hasStateContinuityAnchor,
            hasPreviousCharacterContinuity,
            hasPreviousShotFrame: !!previousShotFrame,
            ownFirstFrame: !!ownFirstFrame,
            continuityFrameLabel,
            hasOpeningFrameBackup,
            nextContinuityReferenceNumber,
            nextContinuityFrameLabel,
            scenePromptLock,
            isDetailShot
        })
        if (visualStateLock) promptParts.push(visualStateLock)
        promptParts.push(productionDirection('image'))
        if (characterPresenceLock) promptParts.push(characterPresenceLock)
        if (characterDetailLock) promptParts.push(characterDetailLock)
        if (frameContinuityLock) promptParts.push(frameContinuityLock)
        if (nextFrameContinuityLock) promptParts.push(nextFrameContinuityLock)
        if (scenePromptLock) promptParts.push(scenePromptLock)

        if (type === 'last_frame' && ownFirstFrame) {
            promptParts.push(
                'DELTA-ONLY: this is the ENDING frame of the same shot. ' +
                    `Reference image #1 is the ${continuityFrameLabel}. ` +
                    (hasOpeningFrameBackup ? 'Reference image #2 is the original opening frame and must keep the same age and wardrobe. ' : '') +
                    'Output must look like a CONTROLLED EDIT of reference #1, not a new scene. ' +
                    'CHANGED (clear visible movement only): describe the single pose/expression/hand/body difference required by the action below. ' +
                    'UNCHANGED (verbatim, do not regenerate): apparent age, body proportions, facial structure, hair, every wardrobe garment color and silhouette, camera angle, lens, light source direction and color, shadow direction, background composition, props position, time of day. ' +
                    'Do NOT introduce new objects, wardrobe items, lighting setups, camera angles, backgrounds, or changes in character count.'
            )
        } else if (type === 'middle_frame' && ownFirstFrame) {
            const index = opts?.middleFrameIndex ?? 1
            const count = opts?.middleFrameCount ?? 1
            const progress = middleProgressPercent(index, count)
            promptParts.push(
                `INTERMEDIATE ${index}/${count}: this keyframe is about ${progress}% through the action, continue directly from reference image #1 (${continuityFrameLabel}) toward the ending state. ` +
                    (hasOpeningFrameBackup ? 'Reference image #2 is the original opening frame and must keep the same age and wardrobe. ' : '') +
                    (nextContinuityReferenceNumber
                        ? `It must also lead cleanly into reference image #${nextContinuityReferenceNumber} (${nextContinuityFrameLabel}); make the pose/expression/action a believable in-between state between the previous and next anchors. `
                        : '') +
                    'Same apparent age, same body proportions, same identity, same wardrobe (verbatim colors), same lighting, same camera, same scene. ' +
                    'Show a visibly different in-between beat of the action progression; the active head, gaze, hands, arms, torso, step, clothing or hair motion must be more advanced than reference image #1. Keep every listed character visible and recognizable.'
            )
        }

        // When the imagePrompt describes a partial/detail shot (feet, hands, close-up of object),
        // prepend the character's name as explicit subject so the model knows whose body part this is.
        if (storyboard.imagePrompt) {
            const styleSafeImagePrompt = sanitizePromptForVisualStyle(storyboard.imagePrompt, frameStyle)
            promptParts.push(isDetailShot && charNames.length > 0 ? `${charNames.join(' and ')}'s — ${styleSafeImagePrompt}` : styleSafeImagePrompt)
        }
        const shotCharacterVisualLock =
            charNames.length > 0
                ? `SHOT CHARACTER VISUAL LOCK: for ${charNames.join(', ')}, preserve the specific age, identity, pose and action clues from this storyboard, but never preserve era, costume or genre clues that conflict with the authoritative project style: ${sanitizePromptForVisualStyle([storyboard.imagePrompt, frameActionDesc].filter(Boolean).join(' '), frameStyle)}`
                : ''
        if (shotCharacterVisualLock) promptParts.push(shotCharacterVisualLock)
        if (storyboard.actionDesc) {
            if (frameActionDesc) promptParts.push(frameActionDesc)
        }
        promptParts.push(`fresh variation id: ${generationId}`)
        if (charNames.length > 0 && hasStateContinuityAnchor) {
            promptParts.push(
                `featuring ${charNames.join(', ')} — preserve face, hair, apparent age, body, wardrobe, dirt, injuries, props, lighting and scene state from the VISUAL STATE LOCK and frame continuity anchors; character cards/style wording must not override current state`
            )
        } else if (charNames.length > 0 && charRefs.length > 0) {
            promptParts.push(
                `featuring ${charNames.join(', ')} — preserve face structure, hair color & length, EVERY wardrobe garment color and silhouette IDENTICALLY from the character reference image(s); do not paraphrase any wardrobe color`
            )
        } else if (charAppearances.length > 0) {
            promptParts.push(`characters (lock identity & wardrobe verbatim): ${charAppearances.join('; ')}`)
        }
        const avoid = [storyboard.negativePrompt, imageNegativePrompt].filter(Boolean).join(', ')
        if (avoid) promptParts.push(`avoid: ${avoid}`)
        promptParts.push(getAspectRatioPrompt(aspectRatio))
        const basePrompt = promptParts.join(', ')
        let prompt = basePrompt
        try {
            prompt = await improveFrameImagePrompt({
                frameType: type,
                basePrompt,
                frameAction: frameActionDesc,
                dialogue: storyboard.dialogue,
                shotType: storyboard.shotType,
                duration: storyboard.duration,
                visualStyleLabel: frameStyle.label,
                visualStyleHint: frameStyle.hint,
                scenePrompt: storyboard.scene?.locationPrompt,
                sceneReferenceMode,
                characterDescriptions: charAppearances as string[],
                hasStyleReference: styleRefs.length > 0 && !hasStateContinuityAnchor,
                hasCharacterReference: charRefs.length > 0 && !hasStateContinuityAnchor,
                hasSceneReference: shouldUseSceneImageReferences,
                hasPreviousShotEndingFrame: !!previousShotFrame,
                hasOwnFirstFrame: !!ownFirstFrame,
                continuityFrameLabel,
                hasOpeningFrameBackup,
                nextContinuityFrameLabel,
                nextContinuityReferenceNumber,
                middleFrameIndex: opts?.middleFrameIndex,
                middleFrameCount: opts?.middleFrameCount
            })
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Prompt] frame rewrite failed, fallback to base prompt: ${msg}`)
        }
        const hardLocks = [
            freshGenerationInstruction(generationId.toString()),
            referenceRoleMap,
            productionDirection('image'),
            frameStyleLock.positive,
            seedanceIllustrationSafety?.positive,
            visualStateLock,
            characterPresenceLock,
            characterDetailLock,
            shotCharacterVisualLock,
            previousShotContinuityLock,
            frameContinuityLock,
            nextFrameContinuityLock,
            scenePromptLock,
            noVisibleCharacterLock,
            cloudEnvironmentLock
        ]
            .filter(Boolean)
            .join(', ')
        if (hardLocks) prompt = `${prompt}, ${hardLocks}`

        if (type === 'first_frame') {
            const continuityState = buildStoryboardContinuityState({
                continuityMode: storyboard.continuityMode,
                continuityGroup: storyboard.continuityGroup,
                actionDesc: storyboard.actionDesc,
                shotType: storyboard.shotType,
                scene: storyboard.scene,
                characters: visibleCharacters.map(item => item.character),
                inheritedFrom:
                    previousShotFrame && previousContinuityMode && opts?.previousShotStoryboardId != null
                        ? {
                              storyboardId: String(opts.previousShotStoryboardId),
                              order: opts.previousShotOrder ?? Math.max(1, (sbRow?.order ?? 1) - 1),
                              frameUrl: previousShotFrame,
                              mode: previousContinuityMode,
                              anchorKind: hasNarrativeStateAnchor ? 'state' : 'pixel'
                          }
                        : null
            })
            await prisma.storyboard.updateMany({
                where: { id: storyboard.id, deletedAt: null, operationVersion: sbRow.operationVersion },
                data: {
                    continuityState: continuityState as unknown as object,
                    continuityStateVersion: STORYBOARD_CONTINUITY_STATE_VERSION
                }
            })
        }

        const middleSuffix = type === 'middle_frame' ? `_${opts?.middleFrameIndex ?? 1}` : ''
        const filename = `frame_${type}${middleSuffix}_${generationId}.png`
        const absPath = storageAbsPath(filename)

        let finalPrompt = prompt
        let imageGenerationResult: ImageGenerationResult | null = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (!(await isGenerationProcessing(generationId))) return false
            finalPrompt =
                attempt === 0
                    ? prompt
                    : `${prompt}, regenerate as a clearly different premium composition, keep the same story moment and references, sharper face, cleaner hands, stronger lighting, no artifacts, quality retry ${attempt + 1}`
            imageGenerationResult = await generateImageUnified({
                prompt: finalPrompt,
                negativePrompt: imageNegativePrompt,
                referenceImages,
                outputAbsPath: absPath,
                aspectRatio,
                provider: opts?.provider,
                quality: imageQuality,
                automaticFallback: false,
                allowProviderSwitch: false,
                contentLabel: `分镜 ${sbRow.order} · ${type === 'first_frame' ? '主插图' : type === 'middle_frame' ? `插图 ${Number(opts?.middleFrameIndex ?? 1) + 1}` : '规划末图'}`,
                signal: opts?.signal
            })
            if (!(await isGenerationProcessing(generationId))) return false
            if (!isSuspiciousImageFile(absPath)) break
        }
        if (isSuspiciousImageFile(absPath)) {
            throw new Error('生成图片文件异常偏小，疑似坏图，请重试或检查图片模型配置')
        }

        // 上传到 local storage，DB 里存 local storage URL 而非本地相对路径，避免 pod 重启丢文件 → 前端 404
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
                        basePrompt,
                        imageQuality,
                        imageGeneration: imageGenerationResult,
                        referenceImageCount: referenceImages.length,
                        referenceRoleMap: referenceRoleMap || null,
                        continuityFrameLabel: ownFirstFrame ? continuityFrameLabel : null,
                        previousShotFrameLabel: previousShotFrame ? previousShotFrameLabel : null,
                        hasOpeningFrameBackup,
                        nextContinuityFrameLabel: nextContinuityFrameUrl ? nextContinuityFrameLabel : null,
                        nextContinuityReferenceNumber,
                        previousContinuityMode: previousShotFrame ? (opts?.previousContinuityMode ?? 'continuous') : null,
                        continuityStateVersion: STORYBOARD_CONTINUITY_STATE_VERSION,
                        previousCharacterContinuityFrameCount: previousShotFrame ? visibleCharacters.length : 0,
                        hasVisualStateLock: !!visualStateLock,
                        hasStateContinuityAnchor,
                        hasCharacterPresenceLock: !!characterPresenceLock,
                        hasNoVisibleCharacterLock: !!noVisibleCharacterLock,
                        characterStateKeys: [...characterStates.values()].map(state => state.stateKey),
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
