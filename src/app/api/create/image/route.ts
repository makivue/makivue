import { promises as fs } from 'node:fs'
import path from 'node:path'
import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { generateImageUnified, getImageProvider, isImageProvider, resolveImageProviderForReferences, type ImageProvider } from '@/services/ai'
import { isOSSObjectWithinSubdir, uploadToOSS } from '@/services/oss'
import { updateJob } from '@/lib/projectAiJobStore'
import { createCreatorGenerationJob, CreatorGenerationCapacityError } from '@/lib/creator-generation-concurrency'
import { saveCreatorImageAsset } from '@/services/creator-assets'
import { getImageProviderCapability } from '@/lib/provider-capabilities'
import { CREATOR_IMAGE_EXTENSIONS, creatorReferenceLimitMessage } from '@/lib/creator-reference-images'
import { CreatorReferenceImageError, readCreatorReferenceImages } from '@/services/creator-reference-images'
import { assertSufficientPoints, BillingError, chargeModelUsage, quoteGenerationPoints } from '@/services/billing'
import { MAX_IMAGE_REFERENCE_VIDEOS } from '@/lib/creator-reference-video'
import { parseStoryboardReferenceVideos, type StoryboardReferenceVideo } from '@/lib/storyboard-reference-videos'
import { withCreatorReferenceVideoFrames } from '@/services/creator-reference-video-frames'

export const maxDuration = 600

const RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)

    const form = await req.formData()
    const prompt = String(form.get('prompt') ?? '').trim()
    const ratio = String(form.get('ratio') ?? '1:1')
    const providerValue = String(form.get('provider') ?? '')
    let provider: ImageProvider | undefined = isImageProvider(providerValue) ? providerValue : undefined

    if (!prompt) return apiError('请输入图片描述')
    if (prompt.length > 4000) return apiError('图片描述不能超过 4000 字')
    if (!RATIOS.has(ratio)) return apiError('不支持的图片比例')

    let rawReferenceVideos: unknown
    try {
        rawReferenceVideos = JSON.parse(String(form.get('referenceVideos') ?? '[]'))
    } catch {
        return apiError('参考视频参数无效')
    }
    if (!Array.isArray(rawReferenceVideos)) return apiError('参考视频参数无效')
    if (rawReferenceVideos.length > MAX_IMAGE_REFERENCE_VIDEOS) return apiError(`最多上传 ${MAX_IMAGE_REFERENCE_VIDEOS} 个参考视频`)
    const referenceVideos = parseStoryboardReferenceVideos(rawReferenceVideos)
    if (referenceVideos.length !== rawReferenceVideos.length) return apiError('参考视频参数无效')
    if (referenceVideos.some(video => !isOSSObjectWithinSubdir(video.url, `creator/${userId}/reference-videos`))) return apiError('参考视频地址无效')

    let references: Awaited<ReturnType<typeof readCreatorReferenceImages>>
    try {
        references = await readCreatorReferenceImages(form, userId)
        provider ??= await getImageProvider()
        const referenceCount = references.count + (referenceVideos.length > 0 ? 1 : 0)
        provider = resolveImageProviderForReferences(provider, referenceCount)
        const limit = getImageProviderCapability(provider)?.maxImageReferences ?? 0
        if (referenceCount > limit) return apiError(creatorReferenceLimitMessage(limit))
        await assertSufficientPoints(userId, quoteGenerationPoints('image', provider))
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '积分校验失败', error instanceof BillingError || error instanceof CreatorReferenceImageError ? error.status : 500)
    }

    const workDir = path.join(process.cwd(), 'public', 'storage')
    await fs.mkdir(workDir, { recursive: true })
    const token = `${userId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    const outputName = `create_image_${token}.png`
    const outputPath = path.join(workDir, outputName)
    const referencePaths: string[] = []

    try {
        for (const [index, reference] of references.files.entries()) {
            const referencePath = path.join(workDir, `create_reference_${token}_${index}${CREATOR_IMAGE_EXTENSIONS[reference.type]}`)
            referencePaths.push(referencePath)
            await fs.writeFile(referencePath, Buffer.from(await reference.arrayBuffer()))
        }
        const referenceSources = [...references.savedUrls, ...referencePaths]
        const job = await createCreatorGenerationJob(userId, 'image')
        after(() =>
            withHiModelsUsageScope({ userId, jobId: job.id }, () =>
                runCreatorImageJob({
                    jobId: job.id,
                    userId,
                    prompt,
                    ratio: ratio as '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
                    provider,
                    outputName,
                    outputPath,
                    referencePaths,
                    referenceSources,
                    referenceVideo: referenceVideos[0]
                })
            )
        )
        return apiResponse({ jobId: job.id }, 202)
    } catch (error) {
        await Promise.all([outputPath, ...referencePaths].map(file => fs.unlink(file).catch(() => {})))
        return apiError(error instanceof Error ? error.message : '图片任务创建失败', error instanceof CreatorGenerationCapacityError ? 429 : 500)
    }
}

async function runCreatorImageJob(params: {
    jobId: string
    userId: bigint
    prompt: string
    ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
    provider?: ImageProvider
    outputName: string
    outputPath: string
    referencePaths: string[]
    referenceSources: string[]
    referenceVideo?: StoryboardReferenceVideo
}) {
    try {
        await updateJob(params.jobId, { attempts: 1 })
        const generation = await withCreatorReferenceVideoFrames(params.referenceVideo, params.referenceSources, referenceImages =>
            generateImageUnified({
                prompt: params.referenceVideo
                    ? `The last ${referenceImages.length - params.referenceSources.length} reference images are chronological frames sampled from one video. Use them as visual references for subjects, lighting and style to create a single image. ${params.prompt}`
                    : params.prompt,
                referenceImages,
                outputAbsPath: params.outputPath,
                aspectRatio: params.ratio,
                provider: params.provider,
                contentLabel: `${params.ratio} 图片`,
                onProviderSwitch: async providerSwitch => {
                    await updateJob(params.jobId, { result: { providerSwitch } })
                }
            })
        )
        const url = await uploadToOSS(params.outputPath, `creator/${params.userId}/images`, params.outputName)
        const asset = await saveCreatorImageAsset({
            userId: params.userId,
            sourceJobId: BigInt(params.jobId),
            url,
            prompt: params.prompt,
            provider: generation.actualProvider,
            ratio: params.ratio
        })
        await chargeModelUsage({
            userId: params.userId,
            idempotencyKey: `usage:creator-image:${params.jobId}`,
            sourceType: 'creator_image',
            sourceId: params.jobId,
            description: `AI 创作台图片生成 · ${generation.actualProvider}`,
            metadata: { provider: generation.actualProvider, ratio: params.ratio }
        })
        await updateJob(params.jobId, {
            phase: 'done',
            progress: 1,
            total: 1,
            result: { url, asset, providerSwitch: generation.providerSwitch, usage: generation.usage }
        })
    } catch (error) {
        console.error('[creator/image] generation failed:', error)
        await updateJob(params.jobId, { phase: 'error', error: error instanceof Error ? error.message : '图片生成失败' })
    } finally {
        await Promise.all([params.outputPath, ...params.referencePaths].map(file => fs.unlink(file).catch(() => {})))
    }
}
