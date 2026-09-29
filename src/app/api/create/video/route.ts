import { promises as fs } from 'node:fs'
import path from 'node:path'
import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { fetchMeteredProvider } from '@/lib/provider-token-usage.server'
import { currentUserId } from '@/lib/current-user'
import { getDashScopeConfig } from '@/services/dashscope-config'
import { prepareWanVideoReferenceImage } from '@/services/wan-video-reference-image'
import { apiError, apiResponse } from '@/lib/utils'
import { localMediaMatchesSubdirectory, saveLocalMediaFile } from '@/services/local-media'
import { updateJob } from '@/lib/projectAiJobStore'
import { createCreatorGenerationJob, CreatorGenerationCapacityError } from '@/lib/creator-generation-concurrency'
import { getSeedanceConfig } from '@/services/seedance-config'
import { createHiModelsVideoTask, type HiModelsVideoReferenceImage } from '@/services/himodels'
import { CREATOR_IMAGE_EXTENSIONS, creatorReferenceLimitMessage } from '@/lib/creator-reference-images'
import { CreatorReferenceImageError, readCreatorReferenceImages } from '@/services/creator-reference-images'
import { CreatorReferenceVideoError, readCreatorVideoAssetReferences } from '@/services/creator-reference-videos'
import type { CreatorReferenceVideo } from '@/lib/creator-reference-video'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { formatReferenceVideoDurationViolation, getReferenceVideoDurationViolation, MAX_STORYBOARD_REFERENCE_VIDEOS, parseStoryboardReferenceVideos } from '@/lib/storyboard-reference-videos'
import {
    DEFAULT_VIDEO_PROVIDER,
    getHiModelsVideoApiModel,
    getVideoProviderCapability,
    isAvailableProductionVideoProvider,
    isHiModelsH3Provider,
    normalizeVideoDuration,
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
    type ProductionVideoProvider
} from '@/lib/provider-capabilities'

export const maxDuration = 120

const RATIOS = new Set(['21:9', '16:9', '9:16', '1:1'])

function referenceVideoPrompt(videos: readonly CreatorReferenceVideo[]) {
    if (videos.length === 0) return ''
    return `Use the ${videos.length} supplied reference video${videos.length > 1 ? 's' : ''} as motion, performance, camera, and timing references only.`
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)

    const form = await req.formData()
    const prompt = String(form.get('prompt') ?? '').trim()
    const ratio = String(form.get('ratio') ?? '16:9')
    const provider = String(form.get('provider') ?? DEFAULT_VIDEO_PROVIDER)
    const rawReferenceVideosValue = String(form.get('referenceVideos') ?? '[]')

    if (!prompt) return apiError('请输入视频描述')
    if (prompt.length > 4000) return apiError('视频描述不能超过 4000 字')
    if (!RATIOS.has(ratio)) return apiError('不支持的视频比例')
    if (!isAvailableProductionVideoProvider(provider)) return apiError('不支持的视频模型')
    if (ratio === '21:9' && !isHiModelsH3Provider(provider)) return apiError('当前视频模型不支持 21:9 比例')
    const capability = getVideoProviderCapability(provider)
    let rawReferenceVideos: unknown
    try {
        rawReferenceVideos = JSON.parse(rawReferenceVideosValue)
    } catch {
        return apiError('参考视频参数无效')
    }
    if (!Array.isArray(rawReferenceVideos)) return apiError('参考视频参数无效')
    if (rawReferenceVideos.length > MAX_STORYBOARD_REFERENCE_VIDEOS) return apiError(`最多上传 ${MAX_STORYBOARD_REFERENCE_VIDEOS} 个参考视频`)
    let referenceVideos: CreatorReferenceVideo[] = parseStoryboardReferenceVideos(rawReferenceVideos)
    if (referenceVideos.length !== rawReferenceVideos.length) return apiError('参考视频参数无效')
    if (referenceVideos.some(video => !localMediaMatchesSubdirectory(video.url, `creator/${userId}/reference-videos`))) return apiError('参考视频地址无效')
    const duration = normalizeVideoDuration(provider, Number(form.get('duration') ?? 5))
    let references: Awaited<ReturnType<typeof readCreatorReferenceImages>>
    try {
        const savedVideos = await readCreatorVideoAssetReferences(form, userId)
        referenceVideos = [...savedVideos, ...referenceVideos]
        if (referenceVideos.length > MAX_STORYBOARD_REFERENCE_VIDEOS) return apiError(`最多上传 ${MAX_STORYBOARD_REFERENCE_VIDEOS} 个参考视频`)
        if (referenceVideos.length > (capability?.maxVideoReferences ?? 0)) {
            return apiError(capability?.maxVideoReferences ? `${capability.label} 最多支持 ${capability.maxVideoReferences} 个参考视频` : `${capability?.label ?? provider} 不支持视频作为参考素材`)
        }
        const referenceVideoDurationViolation = getReferenceVideoDurationViolation(referenceVideos, capability?.referenceVideoDuration)
        if (referenceVideoDurationViolation) return apiError(formatReferenceVideoDurationViolation(capability?.label ?? provider, referenceVideoDurationViolation))
        references = await readCreatorReferenceImages(form, userId)
        if (references.count > (capability?.maxImageReferences ?? 0)) return apiError(creatorReferenceLimitMessage(capability?.maxImageReferences ?? 0))
        await assertSufficientPoints(userId, quoteGenerationPoints('video', provider, duration))
    } catch (error) {
        return apiError(
            error instanceof Error ? error.message : '积分校验失败',
            error instanceof BillingError || error instanceof CreatorReferenceImageError || error instanceof CreatorReferenceVideoError ? error.status : 500
        )
    }
    const localPaths: string[] = []
    try {
        if (references.files.length) {
            const workDir = path.join(process.cwd(), 'public', 'storage')
            await fs.mkdir(workDir, { recursive: true })
            const token = `${userId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
            for (const [index, reference] of references.files.entries()) {
                const localPath = path.join(workDir, `video_reference_${token}_${index}${CREATOR_IMAGE_EXTENSIONS[reference.type]}`)
                localPaths.push(localPath)
                await fs.writeFile(localPath, Buffer.from(await reference.arrayBuffer()))
            }
        }

        const job = await createCreatorGenerationJob(userId, 'video')
        after(() =>
            withHiModelsUsageScope({ userId, jobId: job.id }, () =>
                runCreatorVideoJob({ jobId: job.id, userId, prompt, ratio, duration, provider, localPaths, savedReferenceUrls: references.savedUrls, referenceVideos })
            )
        )
        return apiResponse({ jobId: job.id }, 202)
    } catch (error) {
        await Promise.all(localPaths.map(file => fs.unlink(file).catch(() => {})))
        console.error('[creator/video] task creation failed:', error)
        return apiError(error instanceof Error ? error.message : '视频任务创建失败', error instanceof CreatorGenerationCapacityError ? 429 : 500)
    }
}

async function runCreatorVideoJob(params: {
    jobId: string
    userId: bigint
    prompt: string
    ratio: string
    duration: number
    provider: ProductionVideoProvider
    localPaths: string[]
    savedReferenceUrls: string[]
    referenceVideos: CreatorReferenceVideo[]
}) {
    try {
        await updateJob(params.jobId, { attempts: 1 })
        const uploadedUrls: string[] = []
        for (const file of params.localPaths) uploadedUrls.push(await saveLocalMediaFile(file, `creator/${params.userId}/references`, path.basename(file)))
        const referenceUrls = [...params.savedReferenceUrls, ...uploadedUrls]
        const referenceUrl = referenceUrls[0]

        const { provider, prompt, ratio, duration, referenceVideos } = params
        const videoPrompt = referenceVideoPrompt(referenceVideos)
        const hiModelsModel = getHiModelsVideoApiModel(provider)
        if (hiModelsModel) {
            const referenceImages: HiModelsVideoReferenceImage[] = referenceUrls.map((url, index) => ({
                url,
                role: index === 0 ? 'first_frame' : isHiModelsH3Provider(provider) && index > 1 ? 'reference_image' : 'last_frame'
            }))
            const referenceImagePrompt =
                referenceImages.length >= 2
                    ? `Use Image 1 as the exact opening frame and Image 2 as the exact final frame.${referenceImages.length > 2 ? ' Use every remaining image as an identity, object, scene, or style reference.' : ''}`
                    : referenceImages.length === 1
                      ? 'Use Image 1 as the exact opening frame.'
                      : ''
            const created = await createHiModelsVideoTask({
                model: hiModelsModel,
                prompt: [referenceImagePrompt, videoPrompt, prompt].filter(Boolean).join(' '),
                aspectRatio: ratio as '21:9' | '16:9' | '9:16' | '1:1',
                duration,
                referenceImages,
                referenceVideos,
                signal: AbortSignal.timeout(55_000)
            })
            await updateJob(params.jobId, { result: { taskId: created.taskId, provider, prompt, ratio, duration, usage: created.usage } })
            return
        }

        const config = provider === 'seedance' || provider === 'seedance25' ? await getSeedanceConfig(provider) : getDashScopeConfig()
        const seedanceLabel = provider === 'seedance25' ? SEEDANCE_25_LABEL : SEEDANCE_20_LABEL
        const isWan3 = provider === 'wan3' || provider === 'wan3prime'
        const isWan = isWan3
        const wan3Label = provider === 'wan3prime' ? WAN_3_PRIME_LABEL : WAN_3_LABEL
        if (!config?.apiKey) throw new Error(`${isWan ? `${wan3Label} / 阿里百炼` : seedanceLabel} API key 未配置，请先在设置中配置`)
        const baseUrl = (config.baseUrl ?? (isWan ? 'https://dashscope.aliyuncs.com' : provider === 'seedance25' ? SEEDANCE_25_BASE_URL : SEEDANCE_20_BASE_URL)).replace(/\/$/, '')
        const preparedReferenceUrls = isWan3 ? await Promise.all(referenceUrls.map(url => prepareWanVideoReferenceImage(url))) : referenceUrls
        const requestBody = isWan3
            ? {
                  model: provider === 'wan3prime' ? WAN_3_PRIME_MODEL : WAN_3_MODEL,
                  input: {
                      prompt: [referenceUrl ? 'Use reference image 1 as the opening-frame visual anchor.' : '', videoPrompt, prompt].filter(Boolean).join(' '),
                      ...((referenceUrls.length || referenceVideos.length) && {
                          media: [...preparedReferenceUrls.map(url => ({ type: 'reference_image', url })), ...referenceVideos.map(video => ({ type: 'reference_video', url: video.url }))]
                      })
                  },
                  parameters: { resolution: WAN_3_RESOLUTION, ratio, duration }
              }
            : {
                  model: config.modelName ?? (provider === 'seedance25' ? SEEDANCE_25_ENDPOINT_ID : SEEDANCE_20_ENDPOINT_ID),
                  content: [
                      {
                          type: 'text',
                          text: [
                              referenceUrls.length === 2 ? 'Use Image 1 as the opening frame and Image 2 as the ending frame.' : referenceUrl ? 'Use Image 1 as the exact opening frame.' : '',
                              videoPrompt,
                              prompt
                          ]
                              .filter(Boolean)
                              .join(' ')
                      },
                      ...referenceUrls.map((url, index) => ({
                          type: 'image_url',
                          image_url: { url },
                          role: provider === 'seedance25' ? 'reference_image' : index === 0 ? 'first_frame' : 'last_frame'
                      })),
                      ...referenceVideos.map(video => ({ type: 'video_url', video_url: { url: video.url }, role: 'reference_video' }))
                  ],
                  ratio,
                  duration,
                  generate_audio: true,
                  watermark: false
              }
        const response = await fetchMeteredProvider(
            `${baseUrl}${isWan ? '/api/v1/services/aigc/video-generation/video-synthesis' : '/api/v3/contents/generations/tasks'}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey}`,
                    ...(isWan ? { 'X-DashScope-Async': 'enable' } : {})
                },
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(55_000)
            },
            { provider: isWan ? 'qwen' : 'volcengine', model: requestBody.model }
        )
        if (!response.ok) throw new Error(`视频任务创建失败：${await response.text()}`)
        const data = await response.json()
        const taskId = isWan ? data?.output?.task_id : data?.id
        if (!taskId) throw new Error('视频服务未返回任务 ID')
        await updateJob(params.jobId, { result: { taskId, provider, prompt, ratio, duration } })
    } catch (error) {
        console.error('[creator/video] task creation failed:', error)
        await updateJob(params.jobId, { phase: 'error', error: error instanceof Error ? error.message : '视频任务创建失败' })
    } finally {
        await Promise.all(params.localPaths.map(file => fs.unlink(file).catch(() => {})))
    }
}
