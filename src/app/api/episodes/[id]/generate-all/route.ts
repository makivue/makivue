import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError, apiErrorWithDetails } from '@/lib/utils'
import { CancelledError, generateFrame, generateVideo, isCancelledError, isImageProvider } from '@/services/ai'
import type { ImageProvider, ImageQuality, VideoProvider } from '@/services/ai'
import { normalizeImageQuality } from '@/lib/image-quality'
import { createEpJob, finalizeEpJob, getActiveEpJobForEpisode, getEpJobSignal, heartbeatEpJob, isEpJobCancelled, updateShot } from '@/lib/episodeJobStore'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertEpisodeOwner } from '@/lib/ownership'
import { reconcileGenerationTelemetry, runProjectQualityReview } from '@/services/production-observability'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { getConfiguredVideoLanguage, getDialogueSpeakerNames } from '@/services/video-language'
import { analyzeVideoShotConstraints, assessPreviousEndingFrameAnchor, assessSequentialContinuityDependency, recommendVideoProvider } from '@/lib/video-production-plan'
import { refreshEpisodeStoryboardContinuity } from '@/services/storyboard-continuity'
import { getGenerationCategory, tryClaimGenerationSlot, waitForGenerationQueueAdmission, waitForGenerationSlot, type GenerationCategory } from '@/lib/generation-concurrency'
import { assertNanoBananaCredentialsConfigured } from '@/services/banana'
import type { Prisma } from '@/generated/prisma/client'
import { EPISODE_BATCH_REPEATED_FAILURE_LIMIT, presentEpisodeBatchFailure, repeatedEpisodeBatchFailureMessage } from '@/lib/episode-batch-failure-policy'
import { resetEpisodeGeneratedMedia, resetStoryboardMediaInTransaction, StaleStoryboardMutationError } from '@/services/artifacts'
import { DEFAULT_VIDEO_PROVIDER, getVideoProviderCapability, isAvailableProductionVideoProvider } from '@/lib/provider-capabilities'

export const maxDuration = 1800

async function resolveGlobalVideoProvider(): Promise<VideoProvider> {
    const cfg = await prisma.aiServiceConfig.findUnique({ where: { provider: 'video' }, select: { modelName: true } })
    return isAvailableProductionVideoProvider(cfg?.modelName) ? cfg.modelName : DEFAULT_VIDEO_PROVIDER
}

async function resolveGlobalImageProvider(): Promise<ImageProvider> {
    const cfg = await prisma.aiServiceConfig.findUnique({ where: { provider: 'image' }, select: { modelName: true } })
    if (isImageProvider(cfg?.modelName)) return cfg.modelName
    return 'banana'
}

async function resolveGlobalImageQuality(): Promise<ImageQuality> {
    const cfg = await prisma.aiServiceConfig.findUnique({ where: { provider: 'image_quality' }, select: { modelName: true } })
    return normalizeImageQuality(cfg?.modelName)
}

type Params = { params: Promise<{ id: string }> }

interface ShotLite {
    id: bigint
    order: number
    episodeId: bigint
    sceneId: bigint | null
    continuityMode: string
    continuityGroup: number | null
    imagePrompt: string | null
    videoPrompt: string | null
    motionOverride: string | null
    fullPromptOverride: string | null
    negativePrompt: string | null
    actionDesc: string | null
    shotType?: string | null
    narration?: string | null
    duration: number
    dialogue: string | null
    audioUrl: string | null
    firstFrameUrl: string | null
    lastFrameUrl: string | null
    plannedLastFrameUrl: string | null
    actualVideoEndFrameUrl: string | null
    frameStatus: string
    videoStatus: string
    operationVersion: number
    characters: Array<{
        character: {
            id: bigint
            name: string
            appearancePrompt: string | null
            referenceImageUrl: string | null
            seedanceAssetId: string | null
            gender: string | null
        }
    }>
    scene: { id: bigint; locationPrompt: string | null; timeOfDay?: string | null } | null
}

async function getPreviousShotEndingFrameAnchor(storyboard: ShotLite) {
    if (storyboard.continuityMode !== 'stateful' && storyboard.continuityMode !== 'continuous' && storyboard.continuityMode !== 'seamless') return null
    let previous = await prisma.storyboard.findFirst({
        where: { episodeId: storyboard.episodeId, order: { lt: storyboard.order }, deletedAt: null },
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
        characterIds: storyboard.characters.map(item => item.character.id),
        actionDesc: storyboard.actionDesc
    }
    const assessment = pixelContinuous ? assessSequentialContinuityDependency(previousInput, currentInput) : assessPreviousEndingFrameAnchor(previousInput, currentInput)
    const eligible = 'sequential' in assessment ? assessment.sequential : assessment.eligible
    if (!eligible) {
        console.info(`[continuity] shot ${storyboard.order} rejected previous ending-frame anchor: ${assessment.issues.join(', ')}`)
        return null
    }
    // 强连续只允许使用上一镜视频真实抽取的尾帧。规划末图和手工末图
    // 只能为 stateful 镜头提供状态参考，绝不能冒充像素连续锚点。
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

// 一键生成本集：每镜生成主插图后立即生成视频；额外关键帧由手动精修入口负责。
// body: { mode: "missing" | "all", videoProvider?: "seedance" | "seedance25" | "wan3" | "wan3prime" | "seedance-2.0-global" | "seedance-2.5-global" | "MiniMax-H3" }
async function postGenerateAll(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id: rawEpisodeId } = await params
    const episodeId = parseApiId(rawEpisodeId)
    if (episodeId === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(episodeId, userId)
    if (guard) return guard
    const body = await req.json().catch(() => ({}))
    const mode = (body.mode as 'missing' | 'all') ?? 'missing'
    if (body.videoProvider !== undefined && !isAvailableProductionVideoProvider(body.videoProvider)) {
        return apiError('不支持的视频模型', 422)
    }
    const videoProviderOverride: VideoProvider | null = isAvailableProductionVideoProvider(body.videoProvider) ? body.videoProvider : null
    const imageProviderOverride = isImageProvider(body.imageProvider) ? body.imageProvider : null

    // Return a genuinely active batch before doing continuity, routing and
    // billing queries. The store expires a batch whose request-bound executor
    // stopped heartbeating (for example after a pod restart), so an abandoned
    // `running` row can no longer make every later click a no-op.
    const activeBatchJob = await getActiveEpJobForEpisode(episodeId.toString())
    if (activeBatchJob) {
        return apiResponse({
            jobId: activeBatchJob.id,
            totalShots: activeBatchJob.total,
            shots: activeBatchJob.shots,
            duplicate: true
        })
    }

    if (imageProviderOverride === 'banana') {
        try {
            assertNanoBananaCredentialsConfigured()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return apiError(`Nano Banana 部署凭据不可用：${message}`, 503)
        }
    }
    const imageProviderPromise: Promise<ImageProvider> = imageProviderOverride ? Promise.resolve(imageProviderOverride) : resolveGlobalImageProvider()
    const imageQualityPromise: Promise<ImageQuality> = body.imageQuality ? Promise.resolve(normalizeImageQuality(body.imageQuality)) : resolveGlobalImageQuality()

    // 与配置查询并行，并且只读取批量生成真正需要的项目字段；project: true
    // 会把小说正文等大字段一并取出，测试环境很容易在网关超时前还没返回响应。
    await refreshEpisodeStoryboardContinuity(episodeId)
    const [episode, imageProvider, imageQuality] = await Promise.all([
        prisma.episode.findFirst({
            where: { id: episodeId, deletedAt: null },
            include: {
                project: { select: { id: true } },
                storyboards: {
                    where: { deletedAt: null },
                    orderBy: { order: 'asc' },
                    include: {
                        characters: {
                            select: {
                                character: {
                                    select: { id: true, name: true, appearancePrompt: true, referenceImageUrl: true, seedanceAssetId: true, gender: true }
                                }
                            }
                        },
                        scene: { select: { id: true, name: true, locationPrompt: true, timeOfDay: true } }
                    }
                }
            }
        }),
        imageProviderPromise,
        imageQualityPromise
    ])
    if (!episode) return apiError('Episode not found', 404)
    if (!episode.project) return apiError('Project not found', 404)
    if (imageProvider === 'banana' && imageProviderOverride === null) {
        try {
            assertNanoBananaCredentialsConfigured()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return apiError(`Nano Banana 部署凭据不可用：${message}`, 503)
        }
    }

    const primaryVideoProvider = videoProviderOverride ?? (await resolveGlobalVideoProvider())

    // 只跑需要的 storyboards
    let predecessorRegenerates = false
    const candidates = episode.storyboards.filter(sb => {
        if (mode === 'all') return true
        const needFrame = !sb.firstFrameUrl
        const incompatibleDialogueFallback = !!sb.dialogue?.trim() && sb.expectedAudioMode === 'external_dialogue' && !sb.composedVideoUrl
        const needVideo = !sb.videoUrl || sb.videoStatus !== 'completed' || incompatibleDialogueFallback
        const followsRegeneratedShot = predecessorRegenerates && (sb.continuityMode === 'continuous' || sb.continuityMode === 'seamless')
        predecessorRegenerates = needFrame || needVideo || followsRegeneratedShot
        return predecessorRegenerates
    })
    if (candidates.length === 0) {
        return apiError('所有分镜都已生成完成（插图 + 视频）')
    }

    const selectedVideoCapability = getVideoProviderCapability(primaryVideoProvider)
    const dialogueShots = candidates.filter(storyboard => storyboard.dialogue?.trim())
    if (dialogueShots.length > 0 && !selectedVideoCapability?.nativeDialogue) {
        return apiErrorWithDetails(`${selectedVideoCapability?.label ?? primaryVideoProvider} 不支持原生对白，请改用支持原生对白的视频模型`, 422, {
            code: 'VIDEO_PROVIDER_AUDIO_UNSUPPORTED',
            videoProvider: primaryVideoProvider,
            affectedStoryboards: dialogueShots.map(storyboard => ({ storyboardId: storyboard.id.toString(), order: storyboard.order }))
        })
    }

    const dialogueCapacityViolations = candidates
        .map(storyboard => ({ storyboard, constraints: analyzeVideoShotConstraints({ ...storyboard, provider: primaryVideoProvider }) }))
        .filter(item => item.constraints.dialogueHandling === 'split')
    if (dialogueCapacityViolations.length > 0) {
        const dialogueCapacitySeconds = dialogueCapacityViolations[0].constraints.dialogueCapacitySeconds
        return apiErrorWithDetails(`${dialogueCapacityViolations.length} 个镜头的台词超过当前模型单镜 ${dialogueCapacitySeconds} 秒自然承载上限。请先拆镜，避免台词截断或异常加速。`, 422, {
            code: 'DIALOGUE_SPLIT_REQUIRED',
            maxNaturalDialogueSeconds: dialogueCapacitySeconds,
            affectedStoryboards: dialogueCapacityViolations.map(item => ({
                storyboardId: item.storyboard.id.toString(),
                order: item.storyboard.order,
                actualDurationSeconds: item.constraints.estimatedDialogueSeconds,
                durationSource: 'estimated',
                recommendedSegments: Math.max(2, Math.ceil(item.constraints.estimatedDialogueSeconds / (dialogueCapacitySeconds * 0.9))),
                maxNaturalDialogueSeconds: dialogueCapacitySeconds
            })),
            suggestedAction: 'split_storyboard'
        })
    }

    const complexActionViolations = candidates
        .map(storyboard => ({ storyboard, constraints: analyzeVideoShotConstraints({ ...storyboard, provider: primaryVideoProvider }) }))
        .filter(item => item.constraints.complexActionDetected)
    if (complexActionViolations.length > 0) {
        return apiErrorWithDetails(`${complexActionViolations.length} 个镜头包含多个高动态动作阶段。请先拆成连续动作分镜，再执行全部生成。`, 422, {
            code: 'ACTION_SPLIT_REQUIRED',
            affectedStoryboards: complexActionViolations.map(item => ({
                storyboardId: item.storyboard.id.toString(),
                order: item.storyboard.order,
                recommendedSegments: item.constraints.recommendedActionSegments,
                actionStageCount: item.constraints.actionStageCount
            })),
            videoProvider: primaryVideoProvider,
            suggestedAction: 'split_action_storyboard'
        })
    }

    // 顶部或请求里选中的视频模型是本次整集任务的硬锁。
    // 推荐逻辑只写审计信息，绝不替用户切换任何一个分镜的模型。
    const [videoProvider, videoLanguage] = await Promise.all([Promise.resolve(primaryVideoProvider), getConfiguredVideoLanguage()])
    const videoRoutingRecommendationByStoryboard = new Map(
        candidates.map(storyboard => {
            const speakerCount = getDialogueSpeakerNames(storyboard.dialogue).length
            return [
                storyboard.id.toString(),
                recommendVideoProvider({
                    shotType: storyboard.shotType,
                    duration: storyboard.duration,
                    dialogue: storyboard.dialogue,
                    actionDesc: storyboard.actionDesc,
                    imagePrompt: storyboard.imagePrompt,
                    continuityMode: storyboard.continuityMode,
                    characterCount: storyboard.characters.length,
                    speakerCount
                })
            ] as const
        })
    )
    const providerForStoryboard = () => videoProvider
    const estimatedBatchPoints = candidates.reduce((total, storyboard) => {
        const shouldGenerateIllustrations = mode === 'all' || !storyboard.firstFrameUrl || storyboard.continuityMode === 'continuous' || storyboard.continuityMode === 'seamless'
        // 一键生成的目标是尽快打通“主插图 -> 视频”。额外中间帧和
        // 规划末图不被单参考图视频消费，继续保留在手动“生成插图”流程。
        const illustrationCount = shouldGenerateIllustrations ? 1 : 0
        const framePoints = (quoteGenerationPoints('first_frame', imageProvider, storyboard.duration ?? 0) ?? 0) * illustrationCount
        const shotVideoProvider = providerForStoryboard()
        const videoPoints = quoteGenerationPoints('video', shotVideoProvider, storyboard.duration ?? 0) ?? 0
        return total + framePoints + videoPoints
    }, 0)
    try {
        await assertSufficientPoints(userId, Number(estimatedBatchPoints.toFixed(4)))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    let job: Awaited<ReturnType<typeof createEpJob>>
    try {
        job = await createEpJob(
            episode.projectId.toString(),
            episodeId.toString(),
            candidates.map(c => ({ storyboardId: c.id.toString(), order: c.order }))
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/ep_jobs|does not exist|P2021/i.test(message)) {
            return apiError('服务端任务表未初始化，请先执行 prisma migrate deploy（20260709_add_ep_jobs）', 503)
        }
        throw error
    }
    if (job.reused) {
        return apiResponse({ jobId: job.id, totalShots: job.total, shots: job.shots, duplicate: true })
    }
    if (mode === 'all') {
        try {
            await resetEpisodeGeneratedMedia(episodeId, episode.operationVersion)
            // The reset increments every storyboard resource version and clears
            // every output. Keep this request snapshot aligned before creating
            // the replacement generations below.
            for (const storyboard of candidates) {
                storyboard.firstFrameUrl = null
                storyboard.lastFrameUrl = null
                storyboard.plannedLastFrameUrl = null
                storyboard.actualVideoEndFrameUrl = null
                storyboard.audioUrl = null
                storyboard.frameStatus = 'pending'
                storyboard.videoStatus = 'pending'
                storyboard.operationVersion += 1
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await finalizeEpJob(job.id, 'error', `整集重置失败：${message}`)
            throw error
        }
    } else {
        try {
            const prepared = await prisma.$transaction(
                async tx => {

                    const current = await tx.episode.findUnique({ where: { id: episodeId }, select: { operationVersion: true, deletedAt: true } })
                    if (!current || current.deletedAt || current.operationVersion !== episode.operationVersion) throw new StaleStoryboardMutationError()
                    const rows = []
                    for (const shot of candidates) {
                        const regenerateFrame = !shot.firstFrameUrl || shot.continuityMode === 'continuous' || shot.continuityMode === 'seamless'
                        rows.push(await resetStoryboardMediaInTransaction(tx, shot, regenerateFrame ? ['frame'] : ['video'], '批量生成已重置旧媒体和下游结果', { patch: { staleReason: null } }))
                    }
                    return rows
                },
                { timeout: 60_000 }
            )
            prepared.forEach((row, index) => Object.assign(candidates[index], row))
        } catch (error) {
            await finalizeEpJob(job.id, 'error', '内容已变化，本次批量任务停止，请刷新后重试')
            if (error instanceof StaleStoryboardMutationError) return apiError(error.message, 409)
            throw error
        }
    }
    // 响应返回后由 Next 托管执行；数据库 job 状态用于刷新恢复和跨实例取消。
    after(() =>
        withHiModelsUsageScope({ userId, jobId: job.id }, async () => {
            await heartbeatEpJob(job.id)
            const heartbeat = setInterval(() => {
                void heartbeatEpJob(job.id)
            }, 30_000)
            const todo = candidates as ShotLite[]
            const blockingShotByStoryboardId = new Map<string, { id: string; order: number }>()
            const signal = getEpJobSignal(job.id)
            const repeatedVideoFailures = new Map<string, number>()
            let videoCircuitOpenReason: string | null = null

            const checkCancelled = () => isEpJobCancelled(job.id)
            const createAndClaimGeneration = async (params: {
                storyboardId: bigint
                type: string
                provider: string
                prompt: string
                resourceVersion: number
                category?: GenerationCategory
                metrics?: Prisma.InputJsonValue
            }) => {
                if (await checkCancelled()) throw new CancelledError()
                const category = params.category ?? getGenerationCategory(params.type)
                const categoryLabel = category === 'image' ? '图片' : category === 'video' ? '视频' : '音频'
                const generation = await waitForGenerationQueueAdmission(
                    {
                        userId,
                        category,
                        data: {
                            id: genId(),
                            storyboardId: params.storyboardId,
                            type: params.type,
                            provider: params.provider,
                            prompt: params.prompt,
                            resourceVersion: params.resourceVersion,
                            metrics: params.metrics
                        }
                    },
                    checkCancelled,
                    async queue => {
                        const usage = queue.queued === undefined ? '' : `（${queue.queued}/${queue.limit}）`
                        await updateShot(job.id, params.storyboardId.toString(), {
                            errorMsg:
                                queue.reason === 'queue_full'
                                    ? `${categoryLabel}生成队列已满${usage}，正在等待空位；有名额后会自动继续。`
                                    : `${categoryLabel}生成队列正在检查可用名额，有空位后会自动继续。`
                        })
                    }
                )
                if (!generation) throw new CancelledError()
                const slotParams = {
                    userId,
                    projectId: episode.projectId,
                    category,
                    generationId: generation.id
                }
                let claimed = (await tryClaimGenerationSlot(slotParams)) === 'claimed'
                if (!claimed) {
                    await updateShot(job.id, params.storyboardId.toString(), {
                        errorMsg: `${categoryLabel}任务已进入队列，正在等待执行名额；有名额后会自动继续。`
                    })
                    claimed = await waitForGenerationSlot(slotParams, checkCancelled)
                }
                if (!claimed || (await checkCancelled())) {
                    await prisma.generation.updateMany({
                        where: { id: generation.id, status: { in: ['queued', 'processing'] } },
                        data: { status: 'cancelled', activeKey: null, errorMsg: '批量任务已取消，未开始生成' }
                    })
                    throw new CancelledError()
                }
                return generation
            }

            const generationFailureMessage = async (generationId: bigint, fallback: string) => {
                const generation = await prisma.generation.findUnique({
                    where: { id: generationId },
                    select: { errorMsg: true }
                })
                return generation?.errorMsg?.trim() || fallback
            }

            const markStoryboardFailed = async (sb: (typeof todo)[number], error: unknown, failedStage: 'frame' | 'video') => {
                blockingShotByStoryboardId.set(sb.id.toString(), { id: sb.id.toString(), order: sb.order })
                const presentation = presentEpisodeBatchFailure(error)
                if (failedStage === 'video' && presentation.circuitKey && !videoCircuitOpenReason) {
                    const nextCount = (repeatedVideoFailures.get(presentation.circuitKey) ?? 0) + 1
                    repeatedVideoFailures.set(presentation.circuitKey, nextCount)
                    if (nextCount >= EPISODE_BATCH_REPEATED_FAILURE_LIMIT) {
                        videoCircuitOpenReason = repeatedEpisodeBatchFailureMessage(presentation)
                    }
                }
                await updateShot(job.id, sb.id.toString(), {
                    status: 'failed',
                    failedStage,
                    errorMsg: presentation.message,
                    errorDetail: error instanceof Error ? error.message : String(error)
                })
            }

            const generateStoryboardFrame = async (sb: (typeof todo)[number]) => {
                try {
                    if (await checkCancelled()) return false
                    const shotVideoProvider = providerForStoryboard()
                    const shouldGenerateIllustrations = mode === 'all' || !sb.firstFrameUrl || sb.continuityMode === 'continuous' || sb.continuityMode === 'seamless'
                    if (!shouldGenerateIllustrations) {
                        await updateShot(job.id, sb.id.toString(), { status: 'frame_done' })
                        return true
                    }

                    // 步骤 1：一键生成只等待视频真正消费的主插图。
                    // 中间帧和规划末图属于可选精修，不得阻塞整集生产链。
                    if (await checkCancelled()) throw new CancelledError()
                    const previousShotAnchor = await getPreviousShotEndingFrameAnchor(sb)
                    if ((sb.continuityMode === 'continuous' || sb.continuityMode === 'seamless') && !previousShotAnchor) {
                        throw new Error(`连续镜头 ${sb.order} 缺少上一镜成功视频的真实尾帧，已阻断生成`)
                    }
                    const gen1 = await createAndClaimGeneration({
                        storyboardId: sb.id,
                        type: 'first_frame',
                        provider: imageProvider,
                        prompt: sb.imagePrompt ?? '',
                        resourceVersion: sb.operationVersion
                    })
                    // `pending` 表示仍在数据库队列；只有真正拿到共享图片槽后
                    // 才显示“插图中”，避免把批次协程误报成正在调用图片模型。
                    await updateShot(job.id, sb.id.toString(), { status: 'frame_running' })
                    const markedGenerating = await prisma.storyboard.updateMany({
                        where: { id: sb.id, deletedAt: null, operationVersion: gen1.resourceVersion },
                        data: { frameStatus: 'generating' }
                    })
                    if (markedGenerating.count !== 1) {
                        await prisma.generation.updateMany({
                            where: { id: gen1.id, status: { in: ['queued', 'processing'] } },
                            data: { status: 'cancelled', activeKey: null, errorMsg: '分镜内容已修改，旧任务作废' }
                        })
                        throw new CancelledError()
                    }
                    const firstFrameOk = await generateFrame(gen1.id, sb, 'first_frame', {
                        provider: imageProvider,
                        imageQuality,
                        videoProvider: shotVideoProvider,
                        ...(previousShotAnchor
                            ? {
                                  previousShotFrameUrl: previousShotAnchor.url,
                                  previousShotFrameLabel: previousShotAnchor.label,
                                  previousContinuityMode: previousShotAnchor.mode,
                                  previousShotStoryboardId: previousShotAnchor.storyboardId,
                                  previousShotOrder: previousShotAnchor.order
                              }
                            : {}),
                        signal
                    })
                    if (await checkCancelled()) throw new CancelledError()
                    const refreshed = await prisma.storyboard.findFirst({ where: { id: sb.id } })
                    if (!firstFrameOk || !refreshed?.firstFrameUrl) {
                        throw new Error(await generationFailureMessage(gen1.id, '主插图生成失败'))
                    }
                    sb.firstFrameUrl = refreshed.firstFrameUrl
                    // generateFrame clears the old planned ending frame when
                    // replacing the opening frame. Keep the in-memory snapshot
                    // aligned so video generation uses a valid single image.
                    sb.plannedLastFrameUrl = null
                    await updateShot(job.id, sb.id.toString(), { status: 'frame_done' })
                    return true
                } catch (err) {
                    if (isCancelledError(err) || (await checkCancelled())) {
                        await updateShot(job.id, sb.id.toString(), { status: sb.firstFrameUrl ? 'frame_done' : 'pending', errorMsg: '已取消' })
                        return false
                    }
                    await markStoryboardFailed(sb, err, 'frame')
                    return false
                }
            }

            const generateStoryboardVideo = async (sb: (typeof todo)[number]) => {
                try {
                    if (await checkCancelled()) return false
                    if (videoCircuitOpenReason) {
                        await updateShot(job.id, sb.id.toString(), { status: 'skipped', errorMsg: videoCircuitOpenReason })
                        return false
                    }
                    // 步骤 2：等待本镜视频及实际尾帧保存，再开始下一镜的插图。
                    if (!sb.firstFrameUrl) {
                        throw new Error('没有可用插图，跳过视频')
                    }
                    const shotVideoProvider = providerForStoryboard()
                    const routingRecommendation = videoRoutingRecommendationByStoryboard.get(sb.id.toString())
                    const shot = await prisma.storyboard.findFirst({
                        where: { id: sb.id },
                        include: { characters: { include: { character: true } }, scene: true }
                    })
                    if (!shot || shot.deletedAt || shot.operationVersion !== sb.operationVersion) throw new CancelledError()
                    const gen2 = await createAndClaimGeneration({
                        storyboardId: sb.id,
                        type: 'video',
                        provider: shotVideoProvider,
                        prompt: sb.fullPromptOverride ?? sb.motionOverride ?? sb.videoPrompt ?? sb.imagePrompt ?? '',
                        resourceVersion: shot.operationVersion,
                        metrics: routingRecommendation
                            ? {
                                  routingDecision: {
                                      ruleVersion: routingRecommendation.ruleVersion,
                                      policyApplied: 'explicit_provider_lock',
                                      recommendedProvider: routingRecommendation.provider,
                                      appliedProvider: shotVideoProvider,
                                      reason: routingRecommendation.reason,
                                      feedbackSummary: routingRecommendation.feedbackSummary
                                  }
                              }
                            : undefined
                    })
                    await updateShot(job.id, sb.id.toString(), { status: 'video_running' })
                    const markedVideoGenerating = await prisma.storyboard.updateMany({
                        where: { id: sb.id, deletedAt: null, operationVersion: gen2.resourceVersion },
                        data: {
                            videoStatus: 'generating',
                            actualVideoEndFrameUrl: null,
                            expectedAudioMode: sb.dialogue?.trim() ? 'native_dialogue' : getVideoProviderCapability(shotVideoProvider)?.embeddedAudio ? 'native_ambience' : 'silent_allowed'
                        }
                    })
                    if (markedVideoGenerating.count !== 1) {
                        await prisma.generation.updateMany({
                            where: { id: gen2.id, status: { in: ['queued', 'processing'] } },
                            data: { status: 'cancelled', activeKey: null, errorMsg: '分镜内容已修改，旧任务作废' }
                        })
                        throw new CancelledError()
                    }
                    await generateVideo(gen2.id, shot, {
                        provider: shotVideoProvider,
                        referenceMode: shot.plannedLastFrameUrl ? 'first_last' : 'single',
                        signal,
                        videoLanguage
                    })
                    const refreshed2 = await prisma.storyboard.findFirst({ where: { id: sb.id } })
                    if (refreshed2?.videoStatus !== 'completed') {
                        throw new Error(await generationFailureMessage(gen2.id, '视频生成失败'))
                    }
                    await updateShot(job.id, sb.id.toString(), { status: 'video_done' })
                    return true
                } catch (err) {
                    if (isCancelledError(err) || (await checkCancelled())) {
                        await updateShot(job.id, sb.id.toString(), { status: sb.firstFrameUrl ? 'frame_done' : 'pending', errorMsg: '已取消' })
                        return false
                    }
                    await markStoryboardFailed(sb, err, 'video')
                    return false
                }
            }

            try {
                // 按镜头顺序串行执行完整的“插图 -> 视频 -> 尾帧”链路。
                // stateful 镜头同样需要上一镜最新结果；串行不改变转场/强连续的参考图规则。
                const orderedEpisodeShots = (episode.storyboards as ShotLite[]).slice().sort((left, right) => left.order - right.order)
                const previousByStoryboardId = new Map<string, ShotLite | null>()
                orderedEpisodeShots.forEach((shot, index) => previousByStoryboardId.set(shot.id.toString(), index > 0 ? orderedEpisodeShots[index - 1] : null))
                const resultByStoryboardId = new Map<string, boolean>()

                for (const sb of todo.slice().sort((left, right) => left.order - right.order)) {
                    if (await checkCancelled()) break
                    const previous = previousByStoryboardId.get(sb.id.toString()) ?? null
                    const dependencyAssessment = assessSequentialContinuityDependency(
                        previous
                            ? {
                                  order: previous.order,
                                  sceneId: previous.sceneId,
                                  sceneTimeOfDay: previous.scene?.timeOfDay,
                                  continuityMode: previous.continuityMode,
                                  continuityGroup: previous.continuityGroup,
                                  characterIds: previous.characters.map(item => item.character.id),
                                  actionDesc: previous.actionDesc
                              }
                            : null,
                        {
                            order: sb.order,
                            sceneId: sb.sceneId,
                            sceneTimeOfDay: sb.scene?.timeOfDay,
                            continuityMode: sb.continuityMode,
                            continuityGroup: sb.continuityGroup,
                            characterIds: sb.characters.map(item => item.character.id),
                            actionDesc: sb.actionDesc
                        }
                    )
                    const strictContinuityRejected = (sb.continuityMode === 'continuous' || sb.continuityMode === 'seamless') && !dependencyAssessment.sequential
                    const previousSucceeded = previous ? resultByStoryboardId.get(previous.id.toString()) : undefined
                    resultByStoryboardId.set(sb.id.toString(), false)
                    try {
                        if (strictContinuityRejected) {
                            blockingShotByStoryboardId.set(sb.id.toString(), { id: sb.id.toString(), order: sb.order })
                            await updateShot(job.id, sb.id.toString(), { status: 'skipped', errorMsg: `第 ${sb.order} 镜的连续性条件未满足，尚未执行：${dependencyAssessment.issues.join('；')}` })
                            continue
                        }
                        if (previous && previousSucceeded === false && (dependencyAssessment.sequential || sb.continuityMode === 'stateful')) {
                            const blocker = blockingShotByStoryboardId.get(previous.id.toString()) ?? { id: previous.id.toString(), order: previous.order }
                            blockingShotByStoryboardId.set(sb.id.toString(), blocker)
                            await updateShot(job.id, sb.id.toString(), {
                                status: 'skipped',
                                errorMsg: `依赖第 ${blocker.order} 镜的完整视频，本镜尚未执行；请先完成第 ${blocker.order} 镜，再继续一键生成。`
                            })
                            continue
                        }
                        if (videoCircuitOpenReason) {
                            await updateShot(job.id, sb.id.toString(), { status: 'skipped', errorMsg: videoCircuitOpenReason })
                            continue
                        }
                        const frameReady = await generateStoryboardFrame(sb)
                        if (await checkCancelled()) break
                        if (!frameReady) continue
                        const videoReady = await generateStoryboardVideo(sb)
                        resultByStoryboardId.set(sb.id.toString(), videoReady)
                    } catch (error) {
                        await markStoryboardFailed(sb, error, 'frame')
                    }
                }
                if (await checkCancelled()) {
                    await finalizeEpJob(job.id, 'cancelled')
                } else {
                    await finalizeEpJob(job.id, [...resultByStoryboardId.values()].some(Boolean) ? 'done' : 'error')
                    // Measurement and rule-based QC are best-effort and must never
                    // turn an otherwise successful production job into a failure.
                    try {
                        await reconcileGenerationTelemetry(episode.projectId)
                        await runProjectQualityReview(episode.projectId)
                    } catch (observabilityError) {
                        console.error('[generate-all] production observability failed:', observabilityError)
                    }
                }
            } catch (err) {
                if (isCancelledError(err) || (await checkCancelled())) {
                    await finalizeEpJob(job.id, 'cancelled')
                } else {
                    const message = err instanceof Error ? err.message : String(err)
                    await finalizeEpJob(job.id, 'error', message)
                }
            } finally {
                clearInterval(heartbeat)
            }
        })
    )

    return apiResponse({ jobId: job.id, totalShots: candidates.length, shots: job.shots, resetApplied: mode === 'all' })
}

// 统一处理同步阶段异常，避免 Next/网关返回没有响应体的默认 500。
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        return await postGenerateAll(req, context)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[generate-all] request failed:', message)
        return apiError(`一键生成启动失败：${message}`, 500)
    }
}
