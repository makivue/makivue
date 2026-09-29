import { NextRequest } from 'next/server'
import { episodeStatusSnapshot, episodeStatusGenerationWhere } from '@/services/episode-status'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { factRecord } from '@/services/narrative-facts'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { markEpisodeDownstreamStaleInTransaction, markFollowingEpisodesStaleInTransaction } from '@/services/content-lineage'
import { refreshEpisodeStoryboardContinuity } from '@/services/storyboard-continuity'
import { isHiModelsImageModel, isHiModelsVideoModel } from '@/lib/himodels-models'
import { readHiModelsGenerationUsage } from '@/lib/himodels-usage-ledger.server'

type Params = { params: Promise<{ id: string }> }

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

function parseImageRecovery(requestBody: string | null | undefined) {
    if (!requestBody) return null
    try {
        const parsed = JSON.parse(requestBody)
        const imageGeneration = parsed?.imageGeneration
        if (imageGeneration?.recovery !== 'fallback_provider' && imageGeneration?.recovery !== 'safety_rewrite') return null
        return {
            recovery: imageGeneration.recovery as 'fallback_provider' | 'safety_rewrite',
            requestedProvider: String(imageGeneration.requestedProvider ?? ''),
            actualProvider: String(imageGeneration.actualProvider ?? ''),
            safetyRewriteCount: Number(imageGeneration.safetyRewriteCount ?? 0),
            providerSwitch:
                imageGeneration.providerSwitch && typeof imageGeneration.providerSwitch === 'object'
                    ? {
                          from: String(imageGeneration.providerSwitch.from ?? ''),
                          to: String(imageGeneration.providerSwitch.to ?? ''),
                          reason: String(imageGeneration.providerSwitch.reason ?? ''),
                          status: Number(imageGeneration.providerSwitch.status ?? 0),
                          attempts: Number(imageGeneration.providerSwitch.attempts ?? 0),
                          contentLabel: typeof imageGeneration.providerSwitch.contentLabel === 'string' ? imageGeneration.providerSwitch.contentLabel : undefined
                      }
                    : undefined
        }
    } catch {
        return null
    }
}

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard
    await refreshEpisodeStoryboardContinuity(idNum)
    const episode = await prisma.episode.findFirst({
        where: { id: idNum, deletedAt: null },
        select: {
            id: true,
            episodeNumber: true,
            updatedAt: true,
            title: true,
            script: true,
            videoUrl: true,
            status: true,
            sourceVersion: true,
            staleReason: true,
            storyboards: {
                where: { deletedAt: null },
                orderBy: { order: 'asc' },
                take: 1000,
                select: {
                    id: true,
                    order: true,
                    shotType: true,
                    duration: true,
                    dialogue: true,
                    narration: true,
                    actionDesc: true,
                    actionPlan: true,
                    audioPlan: true,
                    imagePrompt: true,
                    videoPrompt: true,
                    motionOverride: true,
                    fullPromptOverride: true,
                    continuityMode: true,
                    continuityGroup: true,
                    continuityReason: true,
                    firstFrameUrl: true,
                    lastFrameUrl: true,
                    plannedLastFrameUrl: true,
                    actualVideoEndFrameUrl: true,
                    referenceVideoAssets: true,
                    videoUrl: true,
                    audioUrl: true,
                    composedVideoUrl: true,
                    frameStatus: true,
                    videoStatus: true,
                    audioStatus: true,
                    composeStatus: true,
                    expectedAudioMode: true,
                    compositionMode: true,
                    polishStatus: true,
                    promptVersion: true,
                    generationModel: true,
                    normalizationMetadata: true,
                    sourceVersion: true,
                    staleReason: true,
                    updatedAt: true,
                    operationVersion: true,
                    characters: {
                        select: {
                            character: {
                                select: {
                                    id: true,
                                    name: true,
                                    appearancePrompt: true,
                                    referenceImageUrl: true
                                }
                            }
                        }
                    },
                    scene: {
                        select: {
                            id: true,
                            name: true,
                            referenceImageUrl: true
                        }
                    },
                    generations: {
                        where: episodeStatusGenerationWhere,
                        orderBy: { createdAt: 'desc' },
                        // 首屏只需要最近的失败/处理中记录、视频请求和少量中间帧；
                        // 每个分镜保留 20 条会让 60+ 镜头的章节响应膨胀到数千条记录。
                        take: 12,
                        select: {
                            id: true,
                            type: true,
                            provider: true,
                            taskId: true,
                            status: true,
                            resultUrl: true,
                            errorMsg: true,
                            requestBody: true,
                            metrics: true,
                            resourceVersion: true,
                            createdAt: true
                        }
                    }
                }
            },
            merges: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                // subtitleUrls 由字幕迁移提供；接口先不把它作为主查询字段，避免旧数据库迁移未完成时整页 500。
                select: { id: true, status: true, videoUrl: true, updatedAt: true }
            }
        }
    })
    if (!episode) return apiError('Episode not found', 404)
    const [failedGenerationRows, generationUsage] = await Promise.all([
        // 分镜主查询为了控制响应体，每镜只带最近 12 条 generation；单独读取失败摘要，
        // 避免较早的视频错误被中间帧、对比任务等记录挤掉，造成“外面红、展开无原因”。
        prisma.generation.findMany({
            where: {
                storyboard: { episodeId: idNum, deletedAt: null },
                status: 'failed',
                errorMsg: { not: null }
            },
            orderBy: { createdAt: 'desc' },
            select: { storyboardId: true, type: true, provider: true, errorMsg: true, createdAt: true }
        }),
        readHiModelsGenerationUsage(
            userId,
            episode.storyboards.flatMap(storyboard => storyboard.generations.map(generation => generation.id))
        ).catch(() => null)
    ])
    const latestFailedGeneration = new Map<string, { errorMsg: string; provider: string; createdAt: Date | null }>()
    for (const row of failedGenerationRows) {
        if (!row.errorMsg) continue
        const key = `${row.storyboardId}:${row.type}`
        if (!latestFailedGeneration.has(key)) {
            latestFailedGeneration.set(key, { errorMsg: row.errorMsg, provider: row.provider, createdAt: row.createdAt })
        }
    }

    // 恢复 stuck 分镜：videoStatus/frameStatus 停留在 'generating' 但没有排队中或执行中的 generation 记录
    const frameTypes = ['first_frame', 'last_frame', 'illustrations', 'middle_frame']
    const isActiveGenerationStatus = (status: string | null) => status === 'queued' || status === 'processing'
    const isActiveGeneration = (sb: (typeof episode.storyboards)[number], generation: (typeof sb.generations)[number]) =>
        isActiveGenerationStatus(generation.status) && generation.resourceVersion === sb.operationVersion
    const staleVideoWithArtifactIds = episode.storyboards
        .filter(sb => !sb.staleReason && sb.videoStatus !== 'stale' && sb.videoStatus !== 'completed' && typeof sb.videoUrl === 'string' && (sb.videoUrl.startsWith('/api/local-media/') || /^https?:\/\//i.test(sb.videoUrl)))
        .filter(sb => !sb.generations.some(g => g.type === 'video' && isActiveGeneration(sb, g)))
        .map(sb => sb.id)
    const staleFrameWithArtifactIds = episode.storyboards
        .filter(sb => !sb.staleReason && sb.frameStatus !== 'stale' && sb.frameStatus !== 'completed' && typeof sb.firstFrameUrl === 'string' && sb.firstFrameUrl.length > 0)
        .filter(sb => !sb.generations.some(g => frameTypes.includes(g.type) && isActiveGeneration(sb, g)))
        .map(sb => sb.id)
    const stuckVideoIds = episode.storyboards
        .filter(sb => sb.videoStatus === 'generating')
        .filter(sb => !sb.videoUrl)
        .filter(sb => !sb.generations.some(g => g.type === 'video' && isActiveGeneration(sb, g)))
        .map(sb => sb.id)
    const stuckFrameIds = episode.storyboards
        .filter(sb => sb.frameStatus === 'generating')
        .filter(sb => !sb.generations.some(g => frameTypes.includes(g.type) && isActiveGeneration(sb, g)))
        .map(sb => sb.id)
    const allStuck = [...new Set([...stuckVideoIds, ...stuckFrameIds])]
    if (staleVideoWithArtifactIds.length > 0 || staleFrameWithArtifactIds.length > 0 || allStuck.length > 0) {
        if (staleVideoWithArtifactIds.length > 0) {
            await prisma.storyboard.updateMany({
                where: { deletedAt: null, OR: episode.storyboards.filter(sb => staleVideoWithArtifactIds.includes(sb.id)).map(sb => ({ id: sb.id, operationVersion: sb.operationVersion })) },
                data: { videoStatus: 'completed' }
            })
        }
        if (staleFrameWithArtifactIds.length > 0) {
            await prisma.storyboard.updateMany({
                where: { deletedAt: null, OR: episode.storyboards.filter(sb => staleFrameWithArtifactIds.includes(sb.id)).map(sb => ({ id: sb.id, operationVersion: sb.operationVersion })) },
                data: { frameStatus: 'completed' }
            })
        }
        if (stuckVideoIds.length > 0)
            await prisma.storyboard.updateMany({
                where: { deletedAt: null, OR: episode.storyboards.filter(sb => stuckVideoIds.includes(sb.id)).map(sb => ({ id: sb.id, operationVersion: sb.operationVersion })) },
                data: { videoStatus: 'pending' }
            })
        if (stuckFrameIds.length > 0)
            await prisma.storyboard.updateMany({
                where: { deletedAt: null, OR: episode.storyboards.filter(sb => stuckFrameIds.includes(sb.id)).map(sb => ({ id: sb.id, operationVersion: sb.operationVersion })) },
                data: { frameStatus: 'pending' }
            })
        for (const sb of episode.storyboards) {
            if (staleVideoWithArtifactIds.includes(sb.id)) sb.videoStatus = 'completed'
            if (staleFrameWithArtifactIds.includes(sb.id)) sb.frameStatus = 'completed'
            if (stuckVideoIds.includes(sb.id)) sb.videoStatus = 'pending'
            if (stuckFrameIds.includes(sb.id)) sb.frameStatus = 'pending'
        }
        console.log(
            `[Episode ${episode.id}] recovered stuck storyboards: videoCompletedWithArtifact=${staleVideoWithArtifactIds.length} frameCompletedWithArtifact=${staleFrameWithArtifactIds.length} video=${stuckVideoIds.length} frame=${stuckFrameIds.length}`
        )
    }

    // 兼容字幕字段尚未完成迁移的旧容器：字段存在时补回字幕链接，不存在时不影响 episode 主数据返回。
    type MergeDeliveryRow = {
        id: bigint
        subtitle_urls: string | null
        video_status: string | null
        subtitle_status: string | null
        subtitle_progress: unknown
        target_width: number | null
        target_height: number | null
    }
    let mergeDeliveryById = new Map<string, MergeDeliveryRow>()
    try {
        const storedMerges = await prisma.videoMerge.findMany({ where: { episodeId: idNum }, orderBy: { createdAt: 'desc' } })
        const subtitleRows: MergeDeliveryRow[] = storedMerges.map(row => ({ id: row.id, subtitle_urls: row.subtitleUrls, video_status: row.videoStatus, subtitle_status: row.subtitleStatus, subtitle_progress: row.subtitleProgress, target_width: row.targetWidth, target_height: row.targetHeight }))
        mergeDeliveryById = new Map(subtitleRows.map(row => [row.id.toString(), row]))
    } catch {
        // 旧数据库没有交付状态字段时保持空 map，待 migration deploy 后自动恢复。
    }

    // 把每个 storyboard 的最近失败信息按类型归并（first_frame/video/audio/compose → latestErrors[type]）
    const enriched = {
        ...episode,
        statusVersion: episodeStatusSnapshot(episode).version,
        videoUrl: typeof episode.videoUrl === 'string' && episode.videoUrl.startsWith('/storage/') ? null : episode.videoUrl,
        merges: episode.merges.map(merge => {
            const delivery = mergeDeliveryById.get(merge.id.toString())
            return {
                ...merge,
                videoUrl: typeof merge.videoUrl === 'string' && merge.videoUrl.startsWith('/storage/') ? null : merge.videoUrl,
                subtitleUrls: delivery?.subtitle_urls ?? null,
                videoStatus: delivery?.video_status ?? null,
                subtitleStatus: delivery?.subtitle_status ?? null,
                subtitleProgress: delivery?.subtitle_progress ?? null,
                targetWidth: delivery?.target_width ?? null,
                targetHeight: delivery?.target_height ?? null
            }
        }),
        storyboards: episode.storyboards.map(sb => {
            const { generations, ...storyboard } = sb
            const latestErrors: Record<string, { errorMsg: string; provider: string; createdAt: Date | null }> = {}
            for (const type of ['illustrations', 'first_frame', 'middle_frame', 'last_frame', 'video', 'audio', 'compose']) {
                const failure = latestFailedGeneration.get(`${sb.id}:${type}`)
                if (failure) latestErrors[type] = failure
            }
            const middleFrames = generations
                .filter(g => g.type === 'middle_frame' && g.status === 'completed' && g.resultUrl)
                .map((g, fallbackIndex) => ({
                    generation: g,
                    index: parseMiddleFrameIndex(g.requestBody, fallbackIndex + 1)
                }))
                .sort((a, b) => a.index - b.index || (a.generation.createdAt?.getTime() ?? 0) - (b.generation.createdAt?.getTime() ?? 0))
                .map(({ generation, index }) => ({
                    id: generation.id,
                    type: 'middle_frame',
                    label: `插图 ${index + 1}`,
                    url: generation.resultUrl!,
                    createdAt: generation.createdAt
                }))
            for (const g of generations) {
                if (g.errorMsg && (!latestErrors[g.type] || (g.createdAt?.getTime() ?? 0) > (latestErrors[g.type].createdAt?.getTime() ?? 0))) {
                    latestErrors[g.type] = {
                        errorMsg: g.errorMsg,
                        provider: g.provider,
                        createdAt: g.createdAt
                    }
                }
            }
            const latestVideoRequest = generations.find(g => g.type === 'video')
            const latestHimodelsGeneration = generations.find(
                generation =>
                    generation.status === 'completed' &&
                    (generation.provider === 'doubao' || generation.provider === 'veo3' || isHiModelsImageModel(generation.provider) || isHiModelsVideoModel(generation.provider))
            )
            const latestHimodelsMetrics =
                latestHimodelsGeneration?.metrics && typeof latestHimodelsGeneration.metrics === 'object' && !Array.isArray(latestHimodelsGeneration.metrics)
                    ? (latestHimodelsGeneration.metrics as Record<string, unknown>)
                    : null
            const latestKlingComparison = generations.find(g => g.type === 'video_comparison' && g.provider === 'kling')
            const latestSpeechComparisons = ['seedance', 'wanx']
                .map(provider => generations.find(g => g.type === 'video_speech_comparison' && g.provider === provider))
                .filter((generation): generation is NonNullable<typeof generation> => !!generation)
            const latestFrameRecovery =
                generations
                    .filter(g => ['first_frame', 'middle_frame', 'last_frame'].includes(g.type))
                    .map(g => {
                        const recovery = parseImageRecovery(g.requestBody)
                        return recovery ? { ...recovery, generationId: g.id.toString(), generationType: g.type } : null
                    })
                    .find((recovery): recovery is NonNullable<typeof recovery> => recovery !== null) ?? null
            const illustrations = [
                ...(sb.firstFrameUrl ? [{ id: `${sb.id}-first`, type: 'first_frame', label: '插图 1', url: sb.firstFrameUrl, createdAt: sb.updatedAt }] : []),
                ...middleFrames,
                ...(sb.plannedLastFrameUrl
                    ? [{ id: `${sb.id}-planned-last`, type: 'last_frame', label: '规划末图', url: sb.plannedLastFrameUrl, createdAt: sb.updatedAt }]
                    : sb.lastFrameUrl
                      ? [{ id: `${sb.id}-last`, type: 'last_frame', label: '旧版规划末图', url: sb.lastFrameUrl, createdAt: sb.updatedAt }]
                      : [])
            ]
            return {
                ...storyboard,
                // 旧版本把单镜头成片写成容器本地 /storage 路径，线上容器间无法共享。
                // 无历史外部对白音轨时直接回退原始视频；存在外部音轨时清空旧地址，提示重新合成，避免前端继续请求 404。
                composedVideoUrl:
                    typeof storyboard.composedVideoUrl === 'string' && storyboard.composedVideoUrl.startsWith('/storage/')
                        ? storyboard.audioUrl
                            ? null
                            : storyboard.videoUrl
                        : storyboard.composedVideoUrl,
                composeStatus: typeof storyboard.composedVideoUrl === 'string' && storyboard.composedVideoUrl.startsWith('/storage/') && storyboard.audioUrl ? 'pending' : storyboard.composeStatus,
                latestErrors,
                illustrations,
                latestFrameRecovery,
                // Individual calls are needed when several illustrations finish
                // between browser polls. Exclude the aggregate illustrations job.
                himodelsGenerations: generations
                    .filter(
                        generation =>
                            generationUsage?.has(generation.id.toString()) ||
                            (['first_frame', 'middle_frame', 'last_frame', 'video'].includes(generation.type) &&
                                (generation.provider === 'doubao' || generation.provider === 'veo3' || isHiModelsImageModel(generation.provider) || isHiModelsVideoModel(generation.provider)))
                    )
                    .map(generation => {
                        const metrics = generation.metrics && typeof generation.metrics === 'object' && !Array.isArray(generation.metrics) ? (generation.metrics as Record<string, unknown>) : null
                        return {
                            generationId: generation.id.toString(),
                            generationType: generation.type,
                            provider: generation.provider,
                            status: generation.status,
                            ...generationUsage?.get(generation.id.toString()),
                            usageTrackingAvailable: generationUsage !== null,
                            usage: generation.status === 'completed' && metrics?.himodelsUsage && typeof metrics.himodelsUsage === 'object' ? metrics.himodelsUsage : null
                        }
                    }),
                latestHimodelsUsage: latestHimodelsGeneration
                    ? {
                          generationId: latestHimodelsGeneration.id.toString(),
                          provider: latestHimodelsGeneration.provider,
                          usage: latestHimodelsMetrics?.himodelsUsage && typeof latestHimodelsMetrics.himodelsUsage === 'object' ? latestHimodelsMetrics.himodelsUsage : null
                      }
                    : null,
                latestKlingComparison: latestKlingComparison
                    ? {
                          id: latestKlingComparison.id,
                          status: latestKlingComparison.status,
                          resultUrl: latestKlingComparison.resultUrl,
                          errorMsg: latestKlingComparison.errorMsg,
                          createdAt: latestKlingComparison.createdAt
                      }
                    : null,
                latestSpeechComparisons: latestSpeechComparisons.map(generation => ({
                    id: generation.id,
                    provider: generation.provider,
                    status: generation.status,
                    resultUrl: generation.resultUrl,
                    errorMsg: generation.errorMsg,
                    createdAt: generation.createdAt
                })),
                latestVideoRequest: latestVideoRequest
                    ? {
                          id: latestVideoRequest.id,
                          provider: latestVideoRequest.provider,
                          status: latestVideoRequest.status,
                          taskId: latestVideoRequest.taskId,
                          requestBody: latestVideoRequest.requestBody ? JSON.parse(JSON.stringify(latestVideoRequest.requestBody)) : null,
                          createdAt: latestVideoRequest.createdAt
                      }
                    : null
            }
        })
    }

    const response = apiResponse(enriched)
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return response
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('请求内容不是有效 JSON')
    const allowed = new Set(['title', 'synopsis', 'chapterContent', 'script', 'intensity', 'expectedSourceVersion'])
    const unknown = Object.keys(body).filter(key => !allowed.has(key))
    if (unknown.length) return apiError(`不允许修改字段：${unknown.join('、')}`)
    if ('expectedSourceVersion' in body && (typeof body.expectedSourceVersion !== 'number' || !Number.isSafeInteger(body.expectedSourceVersion) || body.expectedSourceVersion < 1)) {
        return apiError('内容版本格式无效')
    }
    const updateData: Record<string, unknown> = {}
    for (const key of ['title', 'synopsis', 'chapterContent', 'script'] as const) {
        if (!(key in body)) continue
        const value = body[key]
        if (value !== null && typeof value !== 'string') return apiError(`${key} 格式无效`)
        if (key === 'title' && typeof value === 'string' && value.length > 255) return apiError('剧集标题不能超过 255 字')
        updateData[key] = typeof value === 'string' ? value.trim() || null : null
    }
    if ('intensity' in body) {
        if (body.intensity !== null && (typeof body.intensity !== 'number' || !Number.isInteger(body.intensity) || body.intensity < 1 || body.intensity > 10))
            return apiError('剧情强度必须是 1-10 的整数')
        updateData.intensity = body.intensity
    }

    const current = await prisma.episode.findFirst({ where: { id: idNum, deletedAt: null } })
    if (!current) return apiError('Episode not found', 404)
    if (body.expectedSourceVersion !== undefined && body.expectedSourceVersion !== current.sourceVersion) {
        return apiError('内容已重新生成或修改，旧页面的保存未覆盖新版本，请刷新后重试', 409)
    }

    const changedSourceKeys = (['title', 'synopsis', 'chapterContent', 'script'] as const).filter(key => key in updateData && updateData[key] !== current[key])
    if (!changedSourceKeys.length) {
        if ('intensity' in updateData && updateData.intensity !== current.intensity) {
            return apiResponse(await prisma.episode.update({ where: { id: idNum }, data: { intensity: updateData.intensity as number | null } }))
        }
        return apiResponse(current)
    }
    const touchesNovelContent = changedSourceKeys.some(key => key !== 'script')
    if (['finalized', 'scripted', 'storyboarded'].includes(current.status ?? '') && touchesNovelContent) {
        return apiError('章节已定稿，请先解除定稿再编辑', 409)
    }

    if (typeof body.chapterContent === 'string' && body.chapterContent.trim() && (current.status === 'draft' || current.status === 'drafting')) {
        updateData.status = 'drafted'
    }
    const episode = await prisma.$transaction(async tx => {


        const locked = await tx.episode.findUnique({ where: { id: idNum } })
        if (!locked || locked.deletedAt || locked.sourceVersion !== current.sourceVersion || locked.operationVersion !== current.operationVersion) return null
        await tx.chapterJob.updateMany({
            where: { episodeId: idNum, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } },
            data: { phase: 'error', activeKey: null, error: '剧集内容已修改，旧任务作废' }
        })
        await tx.scriptJob.updateMany({
            where: { episodeId: idNum, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } },
            data: { phase: 'error', activeKey: null, error: '剧集内容已修改，旧任务作废' }
        })
        await tx.storyboardJob.updateMany({
            where: { episodeId: idNum, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } },
            data: { phase: 'cancelled', activeKey: null, error: '剧集内容已修改，旧任务作废' }
        })
        const changesSource = changedSourceKeys.length > 0
        if (changesSource) {
            await markEpisodeDownstreamStaleInTransaction(tx, idNum, current.projectId, '章节正文或剧本已修改，请重新生成分镜及媒体资产')
            await markFollowingEpisodesStaleInTransaction(tx, current.projectId, current.episodeNumber, touchesNovelContent ? 'chapter' : 'script')
            updateData.contentFacts = {
                ...factRecord(current.contentFacts),
                ...(touchesNovelContent ? { chapter: null, script: null, scriptInvalidated: true } : { script: null, scriptInvalidated: false })
            }
        }
        if (current.status === 'storyboarding') updateData.status = touchesNovelContent ? 'drafted' : 'scripted'
        return tx.episode.update({
            where: { id: idNum },
            data: { ...updateData, operationVersion: { increment: 1 }, sourceVersion: changesSource ? { increment: 1 } : undefined }
        })
    })
    if (!episode) return apiError('内容刚刚发生变化，请刷新后再保存', 409)
    return apiResponse(episode)
}
