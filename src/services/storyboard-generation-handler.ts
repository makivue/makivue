import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError, apiErrorWithDetails, handleApiError } from '@/lib/utils'
import { generateFrame, generateVideo, isImageProvider, VIDEO_PROMPT_VERSION } from '@/services/ai'
import type { ImageProvider, VideoProvider, VideoReferenceMode } from '@/services/ai'
import { invalidationPatch, resetFollowingContinuousMediaInTransaction, resetStoryboardMediaInTransaction, StaleStoryboardMutationError } from '@/services/artifacts'
import { normalizeImageQuality } from '@/lib/image-quality'
import { recommendMiddleFrameCount } from '@/lib/storyboard-timing'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { getVideoProviderRoutingFeedback, reconcileGenerationTelemetry } from '@/services/production-observability'
import { getConfiguredVideoLanguage, getDialogueSpeakerNames } from '@/services/video-language'
import { analyzeVideoShotConstraints, assessPreviousEndingFrameAnchor, assessSequentialContinuityDependency, recommendVideoProvider } from '@/lib/video-production-plan'
import { refreshEpisodeStoryboardContinuity } from '@/services/storyboard-continuity'
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
import { parseApiId } from '@/lib/api-id'
import type { Generation } from '@/generated/prisma/client'
import { DEFAULT_VIDEO_PROVIDER, getVideoProviderCapability, isAvailableProductionVideoProvider, supportsVideoReferenceMode } from '@/lib/provider-capabilities'
import { formatReferenceVideoDurationViolation, getReferenceVideoDurationViolation, parseStoryboardReferenceVideos } from '@/lib/storyboard-reference-videos'
import { hasRequiredReferenceFrames, minimumReferenceImageCount } from '@/lib/video-timeline-plan'
import { resolveGenerationRequestId } from '@/lib/generation-request'

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

function resolveIllustrationCount(value: unknown, autoMiddleFrameCount: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return autoMiddleFrameCount + 2
    return Math.min(10, Math.max(1, Math.round(value)))
}

function parseMiddleFrameIndex(requestBody: string | null | undefined, fallbackIndex: number) {
    if (!requestBody) return fallbackIndex
    try {
        const parsed = JSON.parse(requestBody)
        const index = Number(parsed?.middleFrameIndex)
        return Number.isFinite(index) && index > 0 ? Math.round(index) : fallbackIndex
    } catch {
        return fallbackIndex
    }
}

async function getCompletedMiddleFrameAnchors(storyboardId: bigint) {
    const rows = await prisma.generation.findMany({
        where: { storyboardId, type: 'middle_frame', status: 'completed', resultUrl: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { resultUrl: true, requestBody: true, createdAt: true }
    })
    return rows
        .map((row, fallbackIndex) => ({
            url: row.resultUrl,
            index: parseMiddleFrameIndex(row.requestBody, fallbackIndex + 1),
            createdAt: row.createdAt
        }))
        .filter((item): item is { url: string; index: number; createdAt: Date } => !!item.url && !!item.createdAt)
        .sort((a, b) => a.index - b.index || a.createdAt.getTime() - b.createdAt.getTime())
}

async function getLastMiddleFrameAnchor(storyboardId: bigint) {
    const anchors = await getCompletedMiddleFrameAnchors(storyboardId)
    const last = anchors[anchors.length - 1]
    return last ? { url: last.url, label: `intermediate frame ${last.index}` } : null
}

async function getNextShotFirstFrameAnchor(storyboard: { episodeId: bigint; order: number }) {
    const nextShot = await prisma.storyboard.findFirst({
        where: { episodeId: storyboard.episodeId, order: { gt: storyboard.order }, deletedAt: null, firstFrameUrl: { not: null } },
        orderBy: { order: 'asc' },
        select: { order: true, firstFrameUrl: true }
    })
    if (nextShot?.firstFrameUrl) return { url: nextShot.firstFrameUrl, label: `next shot ${nextShot.order} opening frame` }

    const episode = await prisma.episode.findFirst({
        where: { id: storyboard.episodeId, deletedAt: null },
        select: { projectId: true, episodeNumber: true }
    })
    if (!episode) return null

    const nextEpisode = await prisma.episode.findFirst({
        where: {
            projectId: episode.projectId,
            episodeNumber: { gt: episode.episodeNumber },
            deletedAt: null,
            storyboards: { some: { deletedAt: null, firstFrameUrl: { not: null } } }
        },
        orderBy: { episodeNumber: 'asc' },
        select: {
            episodeNumber: true,
            storyboards: {
                where: { deletedAt: null, firstFrameUrl: { not: null } },
                orderBy: { order: 'asc' },
                take: 1,
                select: { order: true, firstFrameUrl: true }
            }
        }
    })
    const first = nextEpisode?.storyboards[0]
    return nextEpisode && first?.firstFrameUrl ? { url: first.firstFrameUrl, label: `episode ${nextEpisode.episodeNumber} shot ${first.order} opening frame` } : null
}

async function getPreviousShotEndingFrameAnchor(storyboard: {
    episodeId: bigint
    order: number
    sceneId: bigint | null
    continuityMode: string
    continuityGroup: number | null
    actionDesc: string | null
    characters: Array<{ characterId: bigint }>
    scene?: { timeOfDay?: string | null } | null
}) {
    if (storyboard.continuityMode !== 'stateful' && storyboard.continuityMode !== 'continuous' && storyboard.continuityMode !== 'seamless') return null
    let previous = await prisma.storyboard.findFirst({
        where: {
            episodeId: storyboard.episodeId,
            order: { lt: storyboard.order },
            deletedAt: null
        },
        orderBy: { order: 'desc' },
        select: {
            id: true,
            order: true,
            sceneId: true,
            actionDesc: true,
            continuityGroup: true,
            videoStatus: true,
            lastFrameUrl: true,
            plannedLastFrameUrl: true,
            actualVideoEndFrameUrl: true,
            characters: { select: { characterId: true } },
            scene: { select: { timeOfDay: true } }
        }
    })
    let crossEpisode = false
    if (!previous) {
        const currentEpisode = await prisma.episode.findUnique({ where: { id: storyboard.episodeId }, select: { projectId: true, episodeNumber: true } })
        const previousEpisode = currentEpisode
            ? await prisma.episode.findFirst({
                  where: { projectId: currentEpisode.projectId, episodeNumber: { lt: currentEpisode.episodeNumber }, deletedAt: null },
                  orderBy: { episodeNumber: 'desc' },
                  select: { id: true }
              })
            : null
        if (previousEpisode) {
            previous = await prisma.storyboard.findFirst({
                where: { episodeId: previousEpisode.id, deletedAt: null },
                orderBy: { order: 'desc' },
                select: {
                    id: true,
                    order: true,
                    sceneId: true,
                    actionDesc: true,
                    continuityGroup: true,
                    videoStatus: true,
                    lastFrameUrl: true,
                    plannedLastFrameUrl: true,
                    actualVideoEndFrameUrl: true,
                    characters: { select: { characterId: true } },
                    scene: { select: { timeOfDay: true } }
                }
            })
            crossEpisode = !!previous
        }
    }
    if (!previous) return null
    const pixelContinuous = storyboard.continuityMode === 'continuous' || storyboard.continuityMode === 'seamless'
    const previousInput = {
        order: previous.order,
        sceneId: previous.sceneId,
        sceneTimeOfDay: previous.scene?.timeOfDay,
        continuityGroup: crossEpisode ? storyboard.continuityGroup : previous.continuityGroup,
        characterIds: previous.characters.map(item => item.characterId),
        actionDesc: previous.actionDesc
    }
    const currentInput = {
        order: storyboard.order,
        sceneId: storyboard.sceneId,
        sceneTimeOfDay: storyboard.scene?.timeOfDay,
        continuityMode: storyboard.continuityMode,
        continuityGroup: storyboard.continuityGroup,
        characterIds: storyboard.characters.map(item => item.characterId),
        actionDesc: storyboard.actionDesc
    }
    const assessment = pixelContinuous ? assessSequentialContinuityDependency(previousInput, currentInput) : assessPreviousEndingFrameAnchor(previousInput, currentInput)
    const eligible = 'sequential' in assessment ? assessment.sequential : assessment.eligible
    if (!eligible) {
        console.info(`[continuity] shot ${storyboard.order} rejected previous ending-frame anchor: ${assessment.issues.join(', ')}`)
        return null
    }
    const endingFrameUrl = pixelContinuous
        ? previous.videoStatus === 'completed'
            ? previous.actualVideoEndFrameUrl
            : null
        : (previous.actualVideoEndFrameUrl ?? previous.plannedLastFrameUrl ?? previous.lastFrameUrl ?? null)
    if (!endingFrameUrl) return null
    return {
        storyboardId: previous.id,
        order: previous.order,
        url: endingFrameUrl,
        label: pixelContinuous
            ? crossEpisode
                ? 'previous episode actual video ending frame'
                : `shot ${previous.order} actual video ending frame`
            : crossEpisode
              ? 'previous episode state reference frame'
              : `shot ${previous.order} state reference frame`,
        mode: storyboard.continuityMode as 'stateful' | 'continuous' | 'seamless',
        anchorKind: pixelContinuous ? ('pixel' as const) : 'anchorKind' in assessment ? assessment.anchorKind : ('state' as const)
    }
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

    let storyboard = await prisma.storyboard.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            episode: { select: { projectId: true } },
            characters: { include: { character: true } },
            scene: true
        }
    })
    if (!storyboard) return apiError('Storyboard not found', 404)
    if (await refreshEpisodeStoryboardContinuity(storyboard.episodeId)) {
        storyboard = await prisma.storyboard.findFirst({
            where: { id: idNum, deletedAt: null },
            include: {
                episode: { select: { projectId: true } },
                characters: { include: { character: true } },
                scene: true
            }
        })
        if (!storyboard) return apiError('Storyboard not found', 404)
    }

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
        const constraints = analyzeVideoShotConstraints({
            provider: videoProvider,
            shotType: storyboard.shotType,
            duration: storyboard.duration,
            dialogue: storyboard.dialogue,
            actionDesc: storyboard.actionDesc,
            imagePrompt: storyboard.imagePrompt,
            continuityMode: storyboard.continuityMode,
            characterCount: storyboard.characters.length
        })
        if (constraints.dialogueHandling === 'split') {
            return apiErrorWithDetails(
                `本镜台词预计需要 ${constraints.estimatedDialogueSeconds.toFixed(1)} 秒，超过当前模型单镜 ${constraints.dialogueCapacitySeconds} 秒自然承载上限。请先拆成相邻分镜后再生成视频。`,
                409,
                {
                    code: 'DIALOGUE_SPLIT_REQUIRED',
                    storyboardId: storyboard.id.toString(),
                    actualDurationSeconds: constraints.estimatedDialogueSeconds,
                    durationSource: 'estimated',
                    recommendedSegments: Math.max(2, Math.ceil(constraints.estimatedDialogueSeconds / (constraints.dialogueCapacitySeconds * 0.9))),
                    maxNaturalDialogueSeconds: constraints.dialogueCapacitySeconds,
                    videoProvider,
                    suggestedAction: 'split_storyboard'
                }
            )
        }
        if (constraints.complexActionDetected) {
            return apiErrorWithDetails('本镜包含多个高动态动作阶段，请先拆成连续动作分镜后再生成视频。', 409, {
                code: 'ACTION_SPLIT_REQUIRED',
                storyboardId: storyboard.id.toString(),
                recommendedSegments: constraints.recommendedActionSegments,
                actionStageCount: constraints.actionStageCount,
                videoProvider,
                suggestedAction: 'split_action_storyboard'
            })
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
    const autoMiddleFrameCount = recommendMiddleFrameCount({ ...storyboard, characterCount: storyboard.characters.length })
    const hasRequestedIllustrationCount = typeof requestedIllustrationCount === 'number' && Number.isFinite(requestedIllustrationCount)
    const illustrationCount = type === 'illustrations' ? resolveIllustrationCount(requestedIllustrationCount, autoMiddleFrameCount) : 0
    // Keep accepting the old middle-frame parameter for callers that have not
    // yet refreshed during a rolling deployment.
    const middleFrameCount =
        type === 'illustrations' ? (hasRequestedIllustrationCount ? Math.max(0, illustrationCount - 2) : resolveMiddleFrameCount(requestedMiddleFrameCount, autoMiddleFrameCount)) : 0
    const resolvedIllustrationCount = type === 'illustrations' ? (hasRequestedIllustrationCount ? illustrationCount : middleFrameCount + 2) : 0
    const needsLastFrame = resolvedIllustrationCount >= 2
    const middleFrameMode = hasRequestedIllustrationCount || (typeof requestedMiddleFrameCount === 'number' && Number.isFinite(requestedMiddleFrameCount)) ? 'manual' : 'auto'
    const unitPoints = quoteGenerationPoints(type === 'illustrations' ? 'first_frame' : type, taskProvider, storyboard.duration ?? 0) ?? 0
    const estimatedRequestPoints = type === 'illustrations' ? unitPoints * resolvedIllustrationCount : unitPoints
    const routingFeedback = type === 'video' ? await getVideoProviderRoutingFeedback() : null
    const routingRecommendation =
        type === 'video'
            ? recommendVideoProvider(
                  {
                      shotType: storyboard.shotType,
                      duration: storyboard.duration,
                      dialogue: storyboard.dialogue,
                      actionDesc: storyboard.actionDesc,
                      imagePrompt: storyboard.imagePrompt,
                      continuityMode: storyboard.continuityMode,
                      characterCount: storyboard.characters.length,
                      speakerCount: getDialogueSpeakerNames(storyboard.dialogue).length
                  },
                  routingFeedback?.providers
              )
            : null
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
                promptVersion: type === 'video' ? VIDEO_PROMPT_VERSION : undefined,
                metrics:
                    type === 'video' && routingRecommendation
                        ? {
                              routingDecision: {
                                  ruleVersion: routingRecommendation.ruleVersion,
                                  feedbackWindowDays: routingFeedback?.windowDays,
                                  policyApplied: requestedVideoProvider ? 'explicit_provider_request' : 'global_provider_configuration',
                                  recommendedProvider: routingRecommendation.provider,
                                  appliedProvider: taskProvider,
                                  reason: routingRecommendation.reason,
                                  feedbackSummary: routingRecommendation.feedbackSummary
                              }
                          }
                        : undefined
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

        // 强连续镜头只能使用上一镜成功视频的真实尾帧。
        const previousShotAnchor = await getPreviousShotEndingFrameAnchor(baseStoryboard)
        if ((baseStoryboard.continuityMode === 'continuous' || baseStoryboard.continuityMode === 'seamless') && !previousShotAnchor) {
            throw new Error(`连续镜头 ${baseStoryboard.order} 缺少上一镜成功视频的真实尾帧，已阻断生成`)
        }
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
            ...(previousShotAnchor
                ? {
                      previousShotFrameUrl: previousShotAnchor.url,
                      previousShotFrameLabel: previousShotAnchor.label,
                      previousContinuityMode: previousShotAnchor.mode,
                      previousShotStoryboardId: previousShotAnchor.storyboardId,
                      previousShotOrder: previousShotAnchor.order
                  }
                : {}),
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
            const nextShotAnchor = await getNextShotFirstFrameAnchor(refreshed)
            await generateFrame(lastFrameGeneration.id, refreshed, 'last_frame', {
                ...(videoProvider ? { videoProvider } : {}),
                ...(imageProviderOpt ? { provider: imageProviderOpt } : {}),
                imageQuality: imageQualityOpt,
                continuityFrameUrl,
                continuityFrameLabel,
                ...(nextShotAnchor ? { nextContinuityFrameUrl: nextShotAnchor.url, nextContinuityFrameLabel: nextShotAnchor.label } : {})
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
        const lastMiddleAnchor = type === 'last_frame' ? await getLastMiddleFrameAnchor(storyboardId) : null
        const nextShotAnchor = type === 'last_frame' ? await getNextShotFirstFrameAnchor(current) : null
        const previousShotAnchor = type === 'first_frame' ? await getPreviousShotEndingFrameAnchor(current) : null
        if (type === 'first_frame' && (current.continuityMode === 'continuous' || current.continuityMode === 'seamless') && !previousShotAnchor) {
            throw new Error(`连续镜头 ${current.order} 缺少上一镜成功视频的真实尾帧，已阻断生成`)
        }
        const frameOk = await generateFrame(generation.id, current, type as 'first_frame' | 'last_frame', {
            ...(videoProvider ? { videoProvider } : {}),
            ...(imageProviderOpt ? { provider: imageProviderOpt } : {}),
            imageQuality: imageQualityOpt,
            ...(lastMiddleAnchor ? { continuityFrameUrl: lastMiddleAnchor.url, continuityFrameLabel: lastMiddleAnchor.label } : {}),
            ...(previousShotAnchor
                ? {
                      previousShotFrameUrl: previousShotAnchor.url,
                      previousShotFrameLabel: previousShotAnchor.label,
                      previousContinuityMode: previousShotAnchor.mode,
                      previousShotStoryboardId: previousShotAnchor.storyboardId,
                      previousShotOrder: previousShotAnchor.order
                  }
                : {}),
            ...(nextShotAnchor ? { nextContinuityFrameUrl: nextShotAnchor.url, nextContinuityFrameLabel: nextShotAnchor.label } : {}),
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
