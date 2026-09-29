import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiErrorWithDetails, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { genId } from '@/lib/id'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { analyzeVideoShotConstraints } from '@/lib/video-production-plan'
import { DEFAULT_VIDEO_PROVIDER, getVideoProviderCapability, isAvailableProductionVideoProvider } from '@/lib/provider-capabilities'
import { splitComplexActionStoryboard } from '@/services/llm'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { clearEpisodeMergedVideoInTransaction, resetFollowingContinuousMediaInTransaction } from '@/services/artifacts'
import { syncEpisodeCharacterStateEvents } from '@/services/character-state'
import { normalizeStoryboardActionPlan } from '@/lib/storyboard-action-plan'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const storyboardId = parseApiId(id)
    if (storyboardId === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(storyboardId, userId)
    if (guard) return guard
    const body = await req.json().catch(() => ({}))

    const storyboard = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        include: {
            scene: { select: { name: true, locationPrompt: true } },
            characters: {
                include: { character: { select: { id: true, name: true, appearancePrompt: true } } }
            }
        }
    })
    if (!storyboard) return apiError('分镜不存在', 404)
    if (!storyboard.actionDesc?.trim() && !storyboard.imagePrompt?.trim()) return apiError('当前分镜没有可拆分的动作描述')

    if (body.provider !== undefined && !isAvailableProductionVideoProvider(body.provider)) {
        return apiError('不支持的视频模型', 422)
    }
    const provider = isAvailableProductionVideoProvider(body.provider) ? body.provider : DEFAULT_VIDEO_PROVIDER
    const constraints = analyzeVideoShotConstraints({
        provider,
        shotType: storyboard.shotType,
        duration: storyboard.duration,
        dialogue: storyboard.dialogue,
        actionDesc: storyboard.actionDesc,
        imagePrompt: storyboard.imagePrompt,
        characterCount: storyboard.characters.length
    })
    if (constraints.dialogueHandling === 'split') {
        return apiErrorWithDetails('当前分镜的台词也超过单镜承载范围，请先拆分台词，再拆复杂动作。', 409, {
            code: 'DIALOGUE_SPLIT_REQUIRED',
            storyboardId: storyboardId.toString(),
            actualDurationSeconds: constraints.estimatedDialogueSeconds,
            durationSource: 'estimated',
            recommendedSegments: Math.max(2, Math.ceil(constraints.estimatedDialogueSeconds / (constraints.dialogueCapacitySeconds * 0.9))),
            maxNaturalDialogueSeconds: constraints.dialogueCapacitySeconds,
            videoProvider: provider
        })
    }
    if (!constraints.complexActionDetected && body.force !== true) return apiError('当前动作未检测到多个高动态阶段，不需要自动拆镜')

    const requestedSegments = Math.min(4, Math.max(2, Math.round(Number(body.requestedSegments) || constraints.recommendedActionSegments)))
    const maximumSeconds = getVideoProviderCapability(provider)?.duration.max ?? 15
    const llmInput = {
        actionDesc: storyboard.actionDesc ?? '',
        imagePrompt: storyboard.imagePrompt ?? '',
        dialogue: storyboard.dialogue,
        shotType: storyboard.shotType,
        duration: storyboard.duration,
        sceneName: storyboard.scene?.name,
        scenePrompt: storyboard.scene?.locationPrompt,
        characters: storyboard.characters.map(item => item.character),
        segmentCount: requestedSegments,
        maxShotDuration: maximumSeconds
    }
    const usageJobId = genId().toString()
    let segments
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(llmInput, 2_000))
        segments = await withHiModelsUsageScope({ userId, jobId: usageJobId }, () => splitComplexActionStoryboard(llmInput))
        await chargeLlmUsage({
            userId,
            jobId: `split-action:${storyboardId}:${storyboard.operationVersion}`,
            task: '复杂动作自动拆镜',
            input: llmInput,
            output: segments
        })
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        return apiErrorWithDetails(`动作拆镜模型调用失败：${error instanceof Error ? error.message : String(error)}`, 502, { usageJobId, ...(await readHiModelsUsage(userId, { jobId: usageJobId })) })
    }

    const insertedIds: bigint[] = []
    const segmentActionPlans = segments.map(segment => normalizeStoryboardActionPlan(undefined, segment.actionDesc))
    const firstAudioPlan = buildStoryboardAudioPlan({ duration: segments[0].duration, dialogue: storyboard.dialogue, narration: storyboard.narration })
    const applied = await prisma.$transaction(async tx => {
        await tx.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM episodes WHERE id = ${storyboard.episodeId} FOR UPDATE
        `
        const maxGroup = await tx.storyboard.aggregate({
            where: { episodeId: storyboard.episodeId, deletedAt: null },
            _max: { continuityGroup: true }
        })
        const continuityGroup = storyboard.continuityGroup ?? (maxGroup._max.continuityGroup ?? 0) + 1
        const first = segments[0]
        const claimed = await tx.storyboard.updateMany({
            where: { id: storyboardId, operationVersion: storyboard.operationVersion, deletedAt: null },
            data: {
                shotType: first.shotType,
                duration: first.duration,
                actionDesc: first.actionDesc,
                ...(segmentActionPlans[0] ? { actionPlan: segmentActionPlans[0] as unknown as object } : {}),
                audioPlan: firstAudioPlan ? (firstAudioPlan as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
                imagePrompt: first.imagePrompt,
                videoPrompt: null,
                motionOverride: null,
                fullPromptOverride: null,
                continuityMode: storyboard.continuityMode,
                continuityGroup,
                continuityReason: `复杂动作自动拆镜，第 1/${segments.length} 段`,
                firstFrameUrl: null,
                lastFrameUrl: null,
                plannedLastFrameUrl: null,
                actualVideoEndFrameUrl: null,
                videoUrl: null,
                audioUrl: null,
                composedVideoUrl: null,
                subtitles: null,
                frameStatus: 'pending',
                videoStatus: 'pending',
                audioStatus: 'pending',
                composeStatus: 'pending',
                expectedAudioMode: null,
                compositionMode: null,
                generationStage: null,
                operationVersion: { increment: 1 }
            }
        })
        if (claimed.count !== 1) return null

        await tx.storyboard.updateMany({
            where: { episodeId: storyboard.episodeId, order: { gt: storyboard.order }, deletedAt: null },
            data: { order: { increment: segments.length - 1 } }
        })
        await tx.qualityReview.deleteMany({ where: { storyboardId } })
        await tx.productionEvent.deleteMany({ where: { storyboardId } })
        await tx.generation.deleteMany({ where: { storyboardId } })

        for (let index = 1; index < segments.length; index += 1) {
            const segment = segments[index]
            const newId = genId()
            insertedIds.push(newId)
            await tx.storyboard.create({
                data: {
                    id: newId,
                    episodeId: storyboard.episodeId,
                    sceneId: storyboard.sceneId,
                    order: storyboard.order + index,
                    shotType: segment.shotType,
                    duration: segment.duration,
                    dialogue: null,
                    narration: null,
                    actionDesc: segment.actionDesc,
                    ...(segmentActionPlans[index] ? { actionPlan: segmentActionPlans[index] as unknown as object } : {}),
                    imagePrompt: segment.imagePrompt,
                    negativePrompt: storyboard.negativePrompt,
                    continuityMode: 'continuous',
                    continuityGroup,
                    continuityReason: `复杂动作自动拆镜，第 ${index + 1}/${segments.length} 段，Opening state 承接上一镜 Ending state`
                }
            })
            if (storyboard.characters.length > 0) {
                await tx.storyboardCharacter.createMany({
                    data: storyboard.characters.map(item => ({ id: genId(), storyboardId: newId, characterId: item.character.id }))
                })
            }
        }
        await clearEpisodeMergedVideoInTransaction(tx, storyboard.episodeId)
        await resetFollowingContinuousMediaInTransaction(tx, storyboard.episodeId, storyboard.order)
        return { continuityGroup }
    })

    if (!applied) {
        return apiErrorWithDetails('分镜在拆分期间已被更新，请刷新后重试', 409, { code: 'ACTION_SPLIT_STALE', usageJobId, ...(await readHiModelsUsage(userId, { jobId: usageJobId })) })
    }
    await syncEpisodeCharacterStateEvents(storyboard.episodeId)
    return apiResponse({
        usageJobId,
        ...(await readHiModelsUsage(userId, { jobId: usageJobId })),
        originalStoryboardId: storyboardId,
        insertedStoryboardIds: insertedIds,
        segmentCount: segments.length,
        continuityGroup: applied.continuityGroup
    })
}
