import type { Generation } from '@/generated/prisma/client'
import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import {
    assertGenerationQueueCapacity,
    cleanupStaleGenerationSlots,
    GenerationQueueFullError,
    getGenerationCategory,
    getGenerationConcurrencyLimitMessage,
    getGenerationConcurrencySummary,
    tryClaimGenerationSlot,
    waitForGenerationSlot
} from '@/lib/generation-concurrency'
import { resolveGenerationRequestId } from '@/lib/generation-request'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { genId } from '@/lib/id'
import { normalizeImageQuality } from '@/lib/image-quality'
import { assertStoryboardOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { DEFAULT_VIDEO_PROVIDER, getVideoProviderCapability, isAvailableProductionVideoProvider, supportsVideoReferenceMode } from '@/lib/provider-capabilities'
import { formatReferenceVideoDurationViolation, getReferenceVideoDurationViolation, parseStoryboardReferenceVideos } from '@/lib/storyboard-reference-videos'
import { apiError, apiErrorWithDetails, apiResponse, handleApiError } from '@/lib/utils'
import { hasRequiredReferenceFrames, minimumReferenceImageCount } from '@/lib/video-timeline-plan'
import type { ImageProvider, VideoProvider, VideoReferenceMode } from '@/services/ai'
import { generateFrame, generateVideo, isImageProvider, VIDEO_PROMPT_VERSION } from '@/services/ai'
import { invalidationPatch, resetFollowingContinuousMediaInTransaction, resetStoryboardMediaInTransaction, StaleStoryboardMutationError } from '@/services/artifacts'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { reconcileGenerationTelemetry } from '@/services/production-observability'
import { getConfiguredVideoLanguage } from '@/services/video-language'
import { after, NextRequest } from 'next/server'

// Video polling can take many minutes. `after` sends the 202 response first,
// then keeps the self-hosted Next.js request context alive for the task.
export const maxDuration = 1800

type Params = { params: Promise<{ id: string }> }

async function isGenerationProcessing(id: bigint) {
    const generation = await prisma.generation.findUnique({
        where: { id },
        select: { status: true }
    })
    return generation?.status === 'processing'
}

function resolveMiddleFrameCount(value: unknown, autoCount: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return autoCount
    return Math.min(3, Math.max(0, Math.round(value)))
}

function resolveIllustrationCount(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1
    return Math.min(10, Math.max(1, Math.round(value)))
}

// type: "illustrations" | "first_frame" | "last_frame" | "video"
async function generateStoryboard(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const {
        type,
        provider,
        videoProvider: requestedVideoProviderField,
        referenceMode,
        imageProvider,
        imageQuality,
        middleFrameCount: requestedMiddleFrameCount,
        illustrationCount: requestedIllustrationCount,
        requestId: requestedRequestId
    } = await req.json()

    if (!['illustrations', 'first_frame', 'last_frame', 'video'].includes(type)) {
        return apiError('Invalid generation type')
    }

    const storyboard = await prisma.storyboard.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            episode: { select: { projectId: true } },
            characters: { include: { character: true } },
            scene: true
        }
    })
    if (!storyboard) return apiError('Storyboard not found', 404)

    // `provider` remains supported for video-generation clients from older
    // deployments. Image-generation clients now send `videoProvider`
    // separately, so `imageProvider` is unambiguously the image model.
    const requestedVideoProviderValue = requestedVideoProviderField ?? provider
    if (type === 'video' && requestedVideoProviderValue !== undefined && !isAvailableProductionVideoProvider(requestedVideoProviderValue)) {
        return apiError('不支持的视频模型', 422)
    }
    const requestedVideoProvider: VideoProvider | undefined = isAvailableProductionVideoProvider(requestedVideoProviderValue) ? requestedVideoProviderValue : undefined
    const globalVideoConfig = type === 'video' && !requestedVideoProvider ? await prisma.aiServiceConfig.findUnique({ where: { provider: 'video' }, select: { modelName: true } }) : null
    const videoProvider: VideoProvider | undefined =
        requestedVideoProvider ?? (isAvailableProductionVideoProvider(globalVideoConfig?.modelName) ? globalVideoConfig.modelName : type === 'video' ? DEFAULT_VIDEO_PROVIDER : undefined)
    const videoLanguage = await getConfiguredVideoLanguage()
    const imageProviderOpt: ImageProvider | undefined = isImageProvider(imageProvider) ? imageProvider : undefined
    const imageQualityOpt = normalizeImageQuality(imageQuality)
    const imageTaskProvider = imageProviderOpt ?? 'banana'
    const generationCategory = getGenerationCategory(type)
    const projectId = storyboard.episode.projectId
    const defaultVideoReferenceMode: VideoReferenceMode = videoProvider && !supportsVideoReferenceMode(videoProvider, 'single') ? 'text' : 'single'
    const videoReferenceMode: VideoReferenceMode = referenceMode === 'text' || referenceMode === 'single' || referenceMode === 'first_last' ? referenceMode : defaultVideoReferenceMode

    if (type === 'video' && videoProvider) {
        const capability = getVideoProviderCapability(videoProvider)
        if (!capability) return apiError('不支持的视频模型', 422)
        const referenceVideos = parseStoryboardReferenceVideos(storyboard.referenceVideoAssets)
        if (referenceVideos.length > capability.maxVideoReferences) {
            return apiError(
                capability.maxVideoReferences === 0
                    ? `${capability.label} 不支持视频作为参考素材，请删除参考视频或更换模型`
                    : `${capability.label} 最多支持 ${capability.maxVideoReferences} 个参考视频`,
                422
            )
        }
        const referenceVideoDurationViolation = getReferenceVideoDurationViolation(referenceVideos, capability.referenceVideoDuration)
        if (referenceVideoDurationViolation) {
            return apiError(formatReferenceVideoDurationViolation(capability.label, referenceVideoDurationViolation), 422)
        }
        if (storyboard.dialogue?.trim() && !capability.nativeDialogue) {
            return apiError(`${capability.label} 不支持原生对白，请改用支持原生对白的视频模型`, 422)
        }
        if (!supportsVideoReferenceMode(videoProvider, videoReferenceMode)) {
            return apiError(`${capability.label} 不支持当前参考方式，请选择“纯文本”`, 422)
        }
        if (!hasRequiredReferenceFrames(videoReferenceMode, storyboard)) {
            const required = minimumReferenceImageCount(videoReferenceMode)
            return apiError(
                videoReferenceMode === 'first_last' ? `首尾帧模式至少需要 ${required} 张插图，并且必须包含首图和末图，请先补齐后再生成视频` : '首帧模式需要先生成第一张插图，请先生成插图后再生成视频',
                422
            )
        }
    }
    const taskProvider: string = type === 'video' ? (videoProvider ?? DEFAULT_VIDEO_PROVIDER) : imageTaskProvider
    const requestId = resolveGenerationRequestId(requestedRequestId)
    const activeKey = `storyboard:${idNum}:${generationCategory}:${requestId}`

    await cleanupStaleGenerationSlots(userId, generationCategory)
    const sameRequestGeneration = await prisma.generation.findUnique({ where: { activeKey } })
    if (sameRequestGeneration) {
        return apiResponse(
            {
                ...sameRequestGeneration,
                duplicate: true,
                queued: sameRequestGeneration.status === 'queued',
                concurrency: getGenerationConcurrencySummary(generationCategory)
            },
            202
        )
    }
    const existingGeneration = await prisma.generation.findFirst({
        where: {
            storyboardId: idNum,
            type: {
                in: generationCategory === 'image' ? ['illustrations', 'first_frame', 'middle_frame', 'last_frame'] : ['video']
            },
            status: { in: ['queued', 'processing'] }
        },
        orderBy: { createdAt: 'desc' }
    })
    if (existingGeneration) {
        return apiErrorWithDetails('这个分镜已有同类任务在排队或生成中，请等待完成或先停止旧任务；本次请求没有复用旧结果。', 409, {
            code: 'GENERATION_ALREADY_ACTIVE',
            category: generationCategory,
            activeGenerationId: existingGeneration.id.toString()
        })
    }
    const autoMiddleFrameCount = 0
    const hasRequestedIllustrationCount = typeof requestedIllustrationCount === 'number' && Number.isFinite(requestedIllustrationCount)
    const illustrationCount = type === 'illustrations' ? resolveIllustrationCount(requestedIllustrationCount) : 0
    // Keep accepting the old middle-frame parameter for callers that have not
    // yet refreshed during a rolling deployment.
    const middleFrameCount =
        type === 'illustrations' ? (hasRequestedIllustrationCount ? Math.max(0, illustrationCount - 2) : resolveMiddleFrameCount(requestedMiddleFrameCount, autoMiddleFrameCount)) : 0
    const resolvedIllustrationCount = type === 'illustrations' ? (hasRequestedIllustrationCount ? illustrationCount : middleFrameCount + 2) : 0
    const needsLastFrame = resolvedIllustrationCount >= 2
    const middleFrameMode = hasRequestedIllustrationCount || (typeof requestedMiddleFrameCount === 'number' && Number.isFinite(requestedMiddleFrameCount)) ? 'manual' : 'auto'
    const unitPoints = quoteGenerationPoints(type === 'illustrations' ? 'first_frame' : type, taskProvider, storyboard.duration ?? 0) ?? 0
    const estimatedRequestPoints = type === 'illustrations' ? unitPoints * resolvedIllustrationCount : unitPoints
    try {
        await assertSufficientPoints(userId, estimatedRequestPoints)
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    try {
        await assertGenerationQueueCapacity(userId, generationCategory)
    } catch (error) {
        if (error instanceof GenerationQueueFullError) {
            return apiErrorWithDetails(error.message, 429, {
                code: error.code,
                category: error.category,
                limit: error.limit
            })
        }
        throw error
    }

    const storyboardId: bigint = idNum
    const baseStoryboard = storyboard!

    const resetPatch =
        type === 'illustrations' || type === 'first_frame'
            ? { ...invalidationPatch(['video']), firstFrameUrl: null, lastFrameUrl: null, plannedLastFrameUrl: null, actualVideoEndFrameUrl: null, frameStatus: 'generating' }
            : type === 'last_frame'
              ? { ...invalidationPatch(['video']), lastFrameUrl: null, plannedLastFrameUrl: null, frameStatus: 'generating' }
              : {
                    ...invalidationPatch(['compose']),
                    videoUrl: null,
                    actualVideoEndFrameUrl: null,
                    videoStatus: 'generating',
                    expectedAudioMode: storyboard.dialogue?.trim() ? 'native_dialogue' : getVideoProviderCapability(videoProvider)?.embeddedAudio ? 'native_ambience' : 'silent_allowed'
                }

    let generation: Generation
    try {
        generation = await prisma.generation.create({
            data: {
                id: genId(),
                storyboardId,
                type,
                provider: taskProvider,
                status: 'queued',
                activeKey,
                resourceVersion: baseStoryboard.operationVersion,
                prompt:
                    type === 'video'
                        ? (baseStoryboard.fullPromptOverride ?? baseStoryboard.motionOverride ?? baseStoryboard.videoPrompt ?? baseStoryboard.imagePrompt ?? '')
                        : (baseStoryboard.imagePrompt ?? ''),
                promptVersion: type === 'video' ? VIDEO_PROMPT_VERSION : undefined
            }
        })
    } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
            const duplicate = await prisma.generation.findUnique({ where: { activeKey } })
            if (duplicate) {
                if (generationCategory === 'image' && duplicate.resourceVersion === storyboard.operationVersion) {
                    await prisma.storyboard.updateMany({
                        where: { id: idNum, deletedAt: null, operationVersion: storyboard.operationVersion },
                        data: { frameStatus: 'generating' }
                    })
                }
                return apiResponse({ ...duplicate, duplicate: true, queued: duplicate.status === 'queued' }, 202)
            }
        }
        throw error
    }
    const slotParams = { userId, projectId, category: generationCategory, generationId: generation.id }
    const slotClaimed = (await tryClaimGenerationSlot(slotParams)) === 'claimed'

    // Manual image/video clicks should never create an unlimited backlog. The
    // atomic slot claim above is the source of truth across tabs and instances;
    // batch episode jobs keep their separate durable queue behavior.
    if (!slotClaimed) {
        const concurrency = getGenerationConcurrencySummary(generationCategory)
        const message = getGenerationConcurrencyLimitMessage(generationCategory)
        await prisma.generation.updateMany({
            where: { id: generation.id, status: 'queued' },
            data: { status: 'failed', activeKey: null, errorMsg: message }
        })
        return apiErrorWithDetails(message, 429, {
            code: 'GENERATION_CONCURRENCY_LIMIT',
            category: generationCategory,
            limit: concurrency.userMaxConcurrent,
            concurrency
        })
    }

    try {
        const updated = await prisma.$transaction(
            async tx => {
                const result = await resetStoryboardMediaInTransaction(
                    tx,
                    baseStoryboard,
                    type === 'first_frame' || type === 'illustrations' ? ['frame'] : ['video'],
                    '媒体重新生成，旧下游任务和结果已重置',
                    { preserveGenerationId: generation.id, patch: { ...resetPatch, staleReason: null } }
                )
                await resetFollowingContinuousMediaInTransaction(tx, baseStoryboard.episodeId, baseStoryboard.order)
                return result
            },
            { timeout: 60_000 }
        )
        // Child illustration jobs and provider callbacks must use the newly claimed version.
        Object.assign(baseStoryboard, updated)
    } catch (error) {
        await prisma.generation.updateMany({
            where: { id: generation.id, status: { in: ['queued', 'processing'] } },
            data: { status: 'cancelled', activeKey: null, errorMsg: '分镜已更新，旧请求作废' }
        })
        if (error instanceof StaleStoryboardMutationError) return apiError(error.message, 409)
        throw error
    }

    function loadLatestStoryboard() {
        return prisma.storyboard.findFirst({
            where: { id: storyboardId, deletedAt: null },
            include: {
                characters: { include: { character: true } },
                scene: true
            }
        })
    }

    async function generateIllustrations() {
        if (!(await isGenerationProcessing(generation.id))) return
        const firstFrameGeneration = await prisma.generation.create({
            data: {
                id: genId(),
                storyboardId,
                type: 'first_frame',
                provider: imageTaskProvider,
                status: 'processing',
                resourceVersion: baseStoryboard.operationVersion,
                prompt: baseStoryboard.imagePrompt ?? ''
            }
        })
        const firstFrameOk = await generateFrame(firstFrameGeneration.id, baseStoryboard, 'first_frame', {
            ...(videoProvider ? { videoProvider } : {}),
            ...(imageProviderOpt ? { provider: imageProviderOpt } : {}),
            imageQuality: imageQualityOpt,
            keepFrameGenerating: middleFrameCount > 0 || needsLastFrame
        })
        if (!(await isGenerationProcessing(generation.id))) return

        const refreshed = await prisma.storyboard.findFirst({
            where: { id: storyboardId, deletedAt: null },
            include: {
                characters: { include: { character: true } },
                scene: true
            }
        })
        if (!firstFrameOk || !refreshed?.firstFrameUrl) {
            const firstFrameFailure = await prisma.generation.findUnique({
                where: { id: firstFrameGeneration.id },
                select: { errorMsg: true }
            })
            await prisma.generation.updateMany({
                where: { id: generation.id, status: 'processing', resourceVersion: baseStoryboard.operationVersion },
                data: {
                    status: 'failed',
                    activeKey: null,
                    errorMsg: firstFrameFailure?.errorMsg?.trim() || '主插图生成失败，未继续生成插图组'
                }
            })
            return
        }

        let continuityFrameUrl: string | null = refreshed.firstFrameUrl
        let continuityFrameLabel = 'illustration 1'
        let generatedExtraCount = 0
        for (let index = 1; index <= middleFrameCount; index += 1) {
            if (!(await isGenerationProcessing(generation.id))) return
            const middleFrameGeneration = await prisma.generation.create({
                data: {
                    id: genId(),
                    storyboardId,
                    type: 'middle_frame',
                    provider: imageTaskProvider,
                    status: 'processing',
                    prompt: refreshed.imagePrompt ?? '',
                    resourceVersion: refreshed.operationVersion
                }
            })
            await generateFrame(middleFrameGeneration.id, refreshed, 'middle_frame', {
                ...(videoProvider ? { videoProvider } : {}),
                ...(imageProviderOpt ? { provider: imageProviderOpt } : {}),
                imageQuality: imageQualityOpt,
                middleFrameIndex: index,
                middleFrameCount,
                keepFrameGenerating: true,
                continuityFrameUrl,
                continuityFrameLabel
            })
            if (!(await isGenerationProcessing(generation.id))) return
            const middleDone = await prisma.generation.findUnique({
                where: { id: middleFrameGeneration.id },
                select: { resultUrl: true }
            })
            if (middleDone?.resultUrl) {
                generatedExtraCount += 1
                continuityFrameUrl = middleDone.resultUrl
                continuityFrameLabel = `illustration ${index + 1}`
            }
        }
        if (!(await isGenerationProcessing(generation.id))) return

        if (needsLastFrame) {
            const lastFrameGeneration = await prisma.generation.create({
                data: {
                    id: genId(),
                    storyboardId,
                    type: 'last_frame',
                    provider: imageTaskProvider,
                    status: 'processing',
                    prompt: refreshed.imagePrompt ?? '',
                    resourceVersion: refreshed.operationVersion
                }
            })
            await generateFrame(lastFrameGeneration.id, refreshed, 'last_frame', {
                ...(videoProvider ? { videoProvider } : {}),
                ...(imageProviderOpt ? { provider: imageProviderOpt } : {}),
                imageQuality: imageQualityOpt,
                continuityFrameUrl,
                continuityFrameLabel
            })
        }
        if (!(await isGenerationProcessing(generation.id))) return

        const done = await prisma.storyboard.findFirst({
            where: { id: storyboardId, deletedAt: null },
            select: { firstFrameUrl: true, plannedLastFrameUrl: true }
        })
        const complete = !!done?.firstFrameUrl && (!needsLastFrame || !!done?.plannedLastFrameUrl) && generatedExtraCount === middleFrameCount
        await prisma.$transaction(async tx => {
            const target = await tx.storyboard.updateMany({
                where: { id: storyboardId, deletedAt: null, operationVersion: baseStoryboard.operationVersion },
                data: { frameStatus: complete ? 'completed' : 'failed' }
            })
            if (target.count !== 1) throw new StaleStoryboardMutationError()
            const applied = await tx.generation.updateMany({
                where: { id: generation.id, status: 'processing', resourceVersion: baseStoryboard.operationVersion },
                data: complete
                    ? {
                          status: 'completed',
                          activeKey: null,
                          resultUrl: done?.firstFrameUrl,
                          requestBody: JSON.stringify({
                              illustrationCount: resolvedIllustrationCount,
                              extraIllustrationCount: middleFrameCount,
                              middleFrameMode,
                              autoMiddleFrameCount,
                              imageQuality: imageQualityOpt
                          })
                      }
                    : { status: 'failed', activeKey: null, errorMsg: `插图组未生成完整：需要 ${resolvedIllustrationCount} 张${needsLastFrame ? '（含规划末图）' : ''}` }
            })
            if (applied.count !== 1) throw new StaleStoryboardMutationError()
        })
    }

    async function runGenerationTask() {
        if (type === 'video') {
            const current = (await loadLatestStoryboard()) ?? baseStoryboard
            await generateVideo(generation.id, current, {
                ...(videoProvider ? { provider: videoProvider } : {}),
                referenceMode: videoReferenceMode,
                videoLanguage
            })
            return
        }
        if (type === 'illustrations') {
            await generateIllustrations()
            return
        }

        const latest = await loadLatestStoryboard()
        const current = latest ?? baseStoryboard
        const frameOk = await generateFrame(generation.id, current, type as 'first_frame' | 'last_frame', {
            ...(videoProvider ? { videoProvider } : {}),
            ...(imageProviderOpt ? { provider: imageProviderOpt } : {}),
            imageQuality: imageQualityOpt,
            keepFrameGenerating: false
        })
        void frameOk
    }

    // Register the long task with Next.js instead of starting an untracked
    // promise inside the request. The caller receives 202 before media work.
    after(async () => {
        try {
            if (!slotClaimed) {
                const claimed = await waitForGenerationSlot(slotParams)
                if (!claimed) return
            }
            await withHiModelsUsageScope({ userId, generationId: generation.id.toString() }, runGenerationTask)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[generation] background task failed:', message)
            await prisma.generation.updateMany({
                where: { id: generation.id, status: { in: ['queued', 'processing'] } },
                data: { status: 'failed', errorMsg: message, activeKey: null }
            })
            const statusPatch = type === 'video' ? { videoStatus: 'failed' } : { frameStatus: 'failed' }
            await prisma.storyboard.updateMany({ where: { id: storyboardId, operationVersion: baseStoryboard.operationVersion, deletedAt: null }, data: statusPatch })
        } finally {
            await prisma.generation
                .updateMany({
                    where: { id: generation.id },
                    data: { activeKey: null }
                })
                .catch(error => console.error('[generation] active key cleanup failed', error))
            try {
                await reconcileGenerationTelemetry(storyboard.episode.projectId)
            } catch (observabilityError) {
                console.error('[generation] billing/telemetry reconciliation failed:', observabilityError)
            }
        }
    })

    return apiResponse(
        {
            ...generation,
            status: slotClaimed ? 'processing' : 'queued',
            queued: !slotClaimed,
            concurrency: getGenerationConcurrencySummary(generationCategory)
        },
        202
    )
}

// A generation request performs several database checks before it persists a
// task. Keep failures in that synchronous setup path visible to the caller;
// otherwise Next returns an empty 500 response and makes the failure look like
// an image-provider error.
export async function POST(req: NextRequest, context: Params) {
    try {
        return await generateStoryboard(req, context)
    } catch (error) {
        console.error('[storyboard-generation] request setup failed', error)
        return handleApiError(error, '生成任务创建失败，请稍后重试', 500)
    }
}
