import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiErrorWithDetails, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { genId } from '@/lib/id'
import { buildSplitDialogueActionDesc, splitDialogueForWan } from '@/lib/storyboard-dialogue-split'
import { clearEpisodeMergedVideoInTransaction, resetFollowingContinuousMediaInTransaction } from '@/services/artifacts'
import { syncEpisodeCharacterStateEvents } from '@/services/character-state'
import { DEFAULT_VIDEO_PROVIDER, getVideoProviderCapability, isAvailableProductionVideoProvider } from '@/lib/provider-capabilities'
import { normalizeStoryboardActionPlan } from '@/lib/storyboard-action-plan'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'

type Params = { params: Promise<{ id: string }> }

function numericMetric(value: unknown, key: string) {
    if (!value || typeof value !== 'object') return null
    const numeric = Number((value as Record<string, unknown>)[key])
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

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
            characters: { select: { characterId: true } },
            generations: {
                where: { type: 'audio', status: 'completed' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { metrics: true }
            }
        }
    })
    if (!storyboard?.dialogue?.trim()) return apiError('当前分镜没有可拆分的台词')

    const requestedDuration = Number(body.actualDurationSeconds)
    const requestedSegments = Math.min(8, Math.max(1, Math.round(Number(body.requestedSegments) || 1)))
    if (body.provider !== undefined && !isAvailableProductionVideoProvider(body.provider)) {
        return apiError('不支持的视频模型', 422)
    }
    const videoProvider = isAvailableProductionVideoProvider(body.provider) ? body.provider : DEFAULT_VIDEO_PROVIDER
    const maximumSeconds = getVideoProviderCapability(videoProvider)?.duration.max ?? 15
    const measuredDuration =
        (Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : null) ?? (storyboard.audioUrl ? numericMetric(storyboard.generations[0]?.metrics, 'durationSeconds') : null)
    const parts = splitDialogueForWan(storyboard.dialogue, {
        actualDurationSeconds: measuredDuration,
        minimumSegments: requestedSegments,
        maximumSeconds,
        safeTargetSeconds: maximumSeconds * 0.9
    })
    if (parts.length < 2) return apiError('当前台词在自然语速范围内，不需要拆镜')

    const speaker = storyboard.dialogue.match(/^([^：:\n]{1,24})[：:]/)?.[1]?.trim() ?? ''
    const insertedIds: bigint[] = []
    const partActions = parts.map((part, index) => {
        const actionDesc = buildSplitDialogueActionDesc({ original: storyboard.actionDesc, speaker, index, count: parts.length, speech: part.speech })
        return {
            actionDesc,
            actionPlan: normalizeStoryboardActionPlan(undefined, actionDesc),
            audioPlan: buildStoryboardAudioPlan({ duration: part.duration, dialogue: part.dialogue, narration: index === 0 ? storyboard.narration : null })
        }
    })

    const applied = await prisma.$transaction(async tx => {
        // 锁定本集的顺序表。不同长台词镜头同时拆分时也会串行计算最新 order，
        // 防止一个请求移动了另一个请求的原镜头后，新段落插到错误位置。
        await tx.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM episodes WHERE id = ${storyboard.episodeId} FOR UPDATE
        `
        const maxGroup = await tx.storyboard.aggregate({
            where: { episodeId: storyboard.episodeId, deletedAt: null },
            _max: { continuityGroup: true }
        })
        const continuityGroup = storyboard.continuityGroup ?? (maxGroup._max.continuityGroup ?? 0) + 1
        // 先用原台词做 compare-and-set。两个拆镜请求并发时，只有第一个能认领，
        // 第二个不会再次移动顺序或重复插入相同镜头。
        const claimed = await tx.storyboard.updateMany({
            where: { id: storyboardId, dialogue: storyboard.dialogue, operationVersion: storyboard.operationVersion, deletedAt: null },
            data: {
                dialogue: parts[0].dialogue,
                duration: parts[0].duration,
                actionDesc: partActions[0].actionDesc,
                ...(partActions[0].actionPlan ? { actionPlan: partActions[0].actionPlan as unknown as object } : {}),
                ...(partActions[0].audioPlan ? { audioPlan: partActions[0].audioPlan as unknown as object } : {}),
                videoPrompt: null,
                motionOverride: null,
                fullPromptOverride: null,
                continuityGroup,
                audioUrl: null,
                audioStatus: 'pending',
                frameStatus: storyboard.firstFrameUrl ? 'completed' : 'pending',
                videoUrl: null,
                videoStatus: 'pending',
                lastFrameUrl: null,
                plannedLastFrameUrl: null,
                actualVideoEndFrameUrl: null,
                composedVideoUrl: null,
                composeStatus: 'pending',
                subtitles: null,
                expectedAudioMode: null,
                compositionMode: null,
                operationVersion: { increment: 1 }
            }
        })
        if (claimed.count !== 1) return null
        const claimedStoryboard = await tx.storyboard.findUnique({
            where: { id: storyboardId },
            select: { order: true }
        })
        if (!claimedStoryboard) return null
        const splitOrder = claimedStoryboard.order

        await tx.storyboard.updateMany({
            where: { episodeId: storyboard.episodeId, order: { gt: splitOrder }, deletedAt: null },
            data: { order: { increment: parts.length - 1 } }
        })
        await tx.generation.updateMany({
            where: { storyboardId, status: { in: ['queued', 'processing'] } },
            data: { status: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null, errorMsg: '对白已拆分，旧任务作废' }
        })
        await tx.generation.updateMany({
            where: { storyboardId, type: { in: ['audio', 'video', 'compose', 'middle_frame', 'last_frame', 'video_comparison'] }, status: { not: 'archived' } },
            data: { status: 'archived', activeKey: null, leaseOwner: null, leaseExpiresAt: null, errorMsg: null }
        })

        for (let index = 1; index < parts.length; index += 1) {
            const part = parts[index]
            const newId = genId()
            insertedIds.push(newId)
            await tx.storyboard.create({
                data: {
                    id: newId,
                    episodeId: storyboard.episodeId,
                    sceneId: storyboard.sceneId,
                    order: splitOrder + index,
                    shotType: index % 2 === 1 && storyboard.shotType === 'wide' ? 'medium' : storyboard.shotType,
                    duration: part.duration,
                    dialogue: part.dialogue,
                    narration: null,
                    actionDesc: partActions[index].actionDesc,
                    ...(partActions[index].actionPlan ? { actionPlan: partActions[index].actionPlan as unknown as object } : {}),
                    ...(partActions[index].audioPlan ? { audioPlan: partActions[index].audioPlan as unknown as object } : {}),
                    imagePrompt: [
                        storyboard.imagePrompt,
                        `这是同一场景连续对白拆分后的第 ${index + 1}/${parts.length} 镜；人物身份、服装颜色材质、道具、天气、背景布局和光线必须承接上一镜，只改变口型、表情和轻微手势。`
                    ]
                        .filter(Boolean)
                        .join(' '),
                    negativePrompt: storyboard.negativePrompt,
                    videoPrompt: null,
                    motionOverride: null,
                    fullPromptOverride: null,
                    continuityMode: 'continuous',
                    continuityGroup,
                    continuityReason: `超长对白自动拆镜，第 ${index + 1}/${parts.length} 段，承接上一段末状态`
                }
            })
            if (storyboard.characters.length > 0) {
                await tx.storyboardCharacter.createMany({
                    data: storyboard.characters.map(item => ({
                        id: genId(),
                        storyboardId: newId,
                        characterId: item.characterId
                    }))
                })
            }
        }
        await clearEpisodeMergedVideoInTransaction(tx, storyboard.episodeId)
        await resetFollowingContinuousMediaInTransaction(tx, storyboard.episodeId, splitOrder)
        return { splitOrder, continuityGroup }
    })
    if (applied === null) {
        return apiErrorWithDetails('台词已被拆分或刚刚更新，请刷新后查看最新分镜', 409, {
            code: 'DIALOGUE_ALREADY_SPLIT'
        })
    }

    await syncEpisodeCharacterStateEvents(storyboard.episodeId)
    return apiResponse({
        originalStoryboardId: storyboardId,
        insertedStoryboardIds: insertedIds,
        segmentCount: parts.length,
        measuredDurationSeconds: measuredDuration,
        segments: parts.map((part, index) => ({
            order: applied.splitOrder + index,
            dialogue: part.dialogue,
            duration: part.duration,
            estimatedSeconds: part.estimatedSeconds
        }))
    })
}
