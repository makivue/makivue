import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { resetFollowingContinuousMediaInTransaction, resetStoryboardMediaInTransaction, StaleStoryboardMutationError } from '@/services/artifacts'
import { syncEpisodeCharacterStateEvents } from '@/services/character-state'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId, parseApiIds } from '@/lib/api-id'
import { Prisma } from '@/generated/prisma/client'
import { cancelStoryboardOperations } from '@/lib/operation-cancellation'
import { normalizeStoryboardActionPlan } from '@/lib/storyboard-action-plan'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const storyboard = await prisma.storyboard.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            characters: { include: { character: true } },
            scene: true,
            generations: { orderBy: { createdAt: 'desc' } }
        }
    })
    if (!storyboard) return apiError('Storyboard not found', 404)
    return apiResponse(storyboard)
}

/**
 * 删除首帧或末帧后，从中间帧里 promote 一张填补空缺，并 archive 该中间帧记录。
 * 规则：
 *   - 删首帧 → 把最早的中间帧 promote 成 firstFrameUrl
 *   - 删规划末图 → 把最晚的中间帧 promote 成 plannedLastFrameUrl
 *   - 若无中间帧可 promote，且另一端帧存在 → 把另一端帧挪过来填空（剩一张时它就是首帧）
 */
async function resolvePromotePatch(
    tx: Prisma.TransactionClient,
    id: bigint,
    deletingFirst: boolean,
    deletingLast: boolean,
    current: { firstFrameUrl: string | null; plannedLastFrameUrl: string | null }
) {
    if (!deletingFirst && !deletingLast) return {}

    const middleFrames = await tx.generation.findMany({
        where: { storyboardId: id, type: 'middle_frame', status: 'completed', resultUrl: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, resultUrl: true }
    })

    const patch: Record<string, string | null> = {}
    const toArchive: bigint[] = []

    if (deletingFirst) {
        if (middleFrames.length > 0) {
            // 最早的中间帧 promote 成首帧
            const promoted = middleFrames[0]
            patch.firstFrameUrl = promoted.resultUrl
            toArchive.push(promoted.id)
        } else if (current.plannedLastFrameUrl) {
            // 无中间帧，末帧变首帧
            patch.firstFrameUrl = current.plannedLastFrameUrl
            patch.plannedLastFrameUrl = null
        } else {
            patch.firstFrameUrl = null
        }
    }

    if (deletingLast) {
        if (middleFrames.length > 0) {
            // 最晚的中间帧 promote 成末帧（排除已被 promote 成首帧的那张）
            const available = middleFrames.filter(f => !toArchive.includes(f.id))
            const promoted = available[available.length - 1]
            if (promoted) {
                patch.plannedLastFrameUrl = promoted.resultUrl
                toArchive.push(promoted.id)
            } else {
                patch.plannedLastFrameUrl = null
            }
        } else {
            // 无中间帧，末帧直接删除（首帧保留）
            patch.plannedLastFrameUrl = null
        }
    }

    if (toArchive.length > 0) {
        await tx.generation.updateMany({
            where: { id: { in: toArchive } },
            data: { status: 'archived' }
        })
    }

    return patch
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('请求内容不是有效 JSON')
    const allowed = new Set([
        'order',
        'shotType',
        'duration',
        'dialogue',
        'narration',
        'actionDesc',
        'imagePrompt',
        'negativePrompt',
        'videoPrompt',
        'motionOverride',
        'fullPromptOverride',
        'sceneId',
        'characterIds',
        'firstFrameUrl',
        'lastFrameUrl',
        'plannedLastFrameUrl'
    ])
    const unknown = Object.keys(body).filter(key => !allowed.has(key))
    if (unknown.length) return apiError(`不允许修改字段：${unknown.join('、')}`)
    const { characterIds, ...rawData } = body
    const sbData: Record<string, unknown> = {}
    for (const key of ['shotType', 'dialogue', 'narration', 'actionDesc', 'imagePrompt', 'negativePrompt', 'videoPrompt', 'motionOverride', 'fullPromptOverride'] as const) {
        if (!(key in rawData)) continue
        const value = rawData[key]
        if (value !== null && typeof value !== 'string') return apiError(`${key} 格式无效`)
        const max = key === 'shotType' ? 50 : 20_000
        if (typeof value === 'string' && value.length > max) return apiError(`${key} 内容过长`)
        sbData[key] = typeof value === 'string' ? value.trim() || null : null
    }
    if ('order' in rawData) {
        if (typeof rawData.order !== 'number' || !Number.isInteger(rawData.order) || rawData.order < 1 || rawData.order > 1000) return apiError('分镜顺序无效')
        sbData.order = rawData.order
    }
    if ('duration' in rawData) {
        if (typeof rawData.duration !== 'number' || !Number.isInteger(rawData.duration) || rawData.duration < 1 || rawData.duration > 60) return apiError('分镜时长必须是 1-60 秒')
        sbData.duration = rawData.duration
    }
    if ('actionDesc' in sbData) {
        const actionPlan = normalizeStoryboardActionPlan(undefined, sbData.actionDesc as string | null)
        sbData.actionPlan = actionPlan ? (actionPlan as unknown as Prisma.InputJsonValue) : Prisma.DbNull
    }
    if ('sceneId' in rawData) {
        if (rawData.sceneId === null || rawData.sceneId === '') sbData.sceneId = null
        else {
            const sceneId = parseApiId(rawData.sceneId)
            if (sceneId === null) return apiError('场景 ID 格式无效')
            sbData.sceneId = sceneId
        }
    }
    for (const key of ['firstFrameUrl', 'lastFrameUrl', 'plannedLastFrameUrl'] as const) {
        if (key in rawData) {
            if (rawData[key] !== null) return apiError(`${key} 只能通过专用生成流程写入，当前接口仅支持删除`)
            sbData[key] = null
        }
    }
    const parsedCharacterIds = characterIds === undefined ? undefined : parseApiIds(characterIds)
    if (characterIds !== undefined && parsedCharacterIds === null) return apiError('角色 ID 列表格式无效')
    const validatedCharacterIds = parsedCharacterIds ?? undefined
    const current = await prisma.storyboard.findFirst({
        where: { id: idNum },
        select: {
            id: true,
            episodeId: true,
            operationVersion: true,
            order: true,
            narration: true,
            episode: { select: { projectId: true } },
            shotType: true,
            actionDesc: true,
            actionPlan: true,
            audioPlan: true,
            imagePrompt: true,
            negativePrompt: true,
            sceneId: true,
            duration: true,
            videoPrompt: true,
            motionOverride: true,
            fullPromptOverride: true,
            dialogue: true,
            firstFrameUrl: true,
            lastFrameUrl: true,
            plannedLastFrameUrl: true,
            characters: { select: { characterId: true } }
        }
    })
    if (!current) return apiError('Storyboard not found', 404)
    if (typeof sbData.sceneId === 'bigint') {
        const scene = await prisma.scene.findFirst({ where: { id: sbData.sceneId, projectId: current.episode.projectId, deletedAt: null }, select: { id: true } })
        if (!scene) return apiError('所选场景不属于当前项目', 400)
    }
    if (validatedCharacterIds?.length) {
        const count = await prisma.character.count({ where: { id: { in: validatedCharacterIds }, projectId: current.episode.projectId, deletedAt: null } })
        if (count !== validatedCharacterIds.length) return apiError('角色列表包含不属于当前项目的角色', 400)
    }

    const visualKeys = ['shotType', 'actionDesc', 'imagePrompt', 'negativePrompt', 'sceneId', 'order']
    const videoKeys = ['duration', 'videoPrompt', 'motionOverride', 'fullPromptOverride']
    const dialogueKeys = ['dialogue', 'narration']
    const normalize = (v: unknown) => (v === null || v === undefined || v === '' ? null : v)
    const valueChanged = (key: string) => {
        if (!(key in sbData)) return false
        const next = normalize(sbData[key])
        const previous = normalize((current as Record<string, unknown> | null)?.[key])
        if (next && previous && typeof next === 'object' && typeof previous === 'object') return JSON.stringify(next) !== JSON.stringify(previous)
        return next !== previous
    }
    if ('actionDesc' in sbData && normalize(sbData.actionDesc) === normalize(current.actionDesc)) delete sbData.actionPlan
    const audioInputsChanged = ['dialogue', 'narration', 'duration'].some(valueChanged)
    if (audioInputsChanged) {
        const audioPlan = buildStoryboardAudioPlan({
            duration: (sbData.duration as number | undefined) ?? current.duration,
            dialogue: 'dialogue' in sbData ? (sbData.dialogue as string | null) : current.dialogue,
            narration: 'narration' in sbData ? (sbData.narration as string | null) : current.narration
        })
        sbData.audioPlan = audioPlan ? (audioPlan as unknown as Prisma.InputJsonValue) : Prisma.DbNull
    }
    const hasCharacterChange =
        validatedCharacterIds !== undefined && JSON.stringify(validatedCharacterIds.map(String).sort()) !== JSON.stringify((current?.characters ?? []).map(c => c.characterId.toString()).sort())
    const visualDirty = visualKeys.some(valueChanged) || hasCharacterChange
    const videoDirty = videoKeys.some(valueChanged)
    const dialogueDirty = dialogueKeys.some(valueChanged) || hasCharacterChange
    if (!Object.keys(sbData).some(valueChanged) && !hasCharacterChange) {
        return apiResponse({ ...current, characterIds: current.characters.map(character => character.characterId) })
    }

    const deletingFirstFrame = 'firstFrameUrl' in sbData && sbData.firstFrameUrl === null && !!current?.firstFrameUrl
    const deletingLastFrame =
        (('plannedLastFrameUrl' in sbData && sbData.plannedLastFrameUrl === null) || ('lastFrameUrl' in sbData && sbData.lastFrameUrl === null)) &&
        !!(current?.plannedLastFrameUrl ?? current?.lastFrameUrl)
    const deletingFrame = deletingFirstFrame || deletingLastFrame

    // 把 promote 结果合并进 sbData，覆盖前端传来的 null
    // 当前视频模型把对白和口型写进原视频。修改台词后，原视频及可能存在的
    // 历史外部音轨都已与新台词不一致，必须在下一次付费生成前回到待生成状态。
    const resetScopes = [...(visualDirty ? (['frame'] as const) : []), ...(videoDirty || deletingFrame || dialogueDirty ? (['video'] as const) : []), ...(dialogueDirty ? (['audio'] as const) : [])]

    const storyboard = await prisma
        .$transaction(
            async tx => {
                await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${current.episodeId} FOR UPDATE`
                await tx.$queryRaw`SELECT id FROM storyboards WHERE id = ${idNum} FOR UPDATE`
                const locked = await tx.storyboard.findUnique({ where: { id: idNum } })
                if (!locked || locked.deletedAt || locked.operationVersion !== current.operationVersion) throw new StaleStoryboardMutationError()
                const promotePatch = visualDirty
                    ? {}
                    : await resolvePromotePatch(tx, idNum, deletingFirstFrame, deletingLastFrame, {
                          firstFrameUrl: current.firstFrameUrl,
                          plannedLastFrameUrl: current.plannedLastFrameUrl ?? current.lastFrameUrl
                      })
                if (deletingFirstFrame) sbData.firstFrameUrl = promotePatch.firstFrameUrl ?? null
                if (deletingLastFrame) {
                    sbData.plannedLastFrameUrl = promotePatch.plannedLastFrameUrl ?? null
                    sbData.lastFrameUrl = null
                }
                const finalFirst = deletingFirstFrame ? (sbData.firstFrameUrl as string | null) : current.firstFrameUrl
                const finalLast = deletingLastFrame ? (sbData.plannedLastFrameUrl as string | null) : (current.plannedLastFrameUrl ?? current.lastFrameUrl)
                const frameStatusPatch = deletingFrame && !visualDirty ? { frameStatus: finalFirst || finalLast ? 'completed' : 'pending' } : {}
                const updated = await resetStoryboardMediaInTransaction(tx, current, resetScopes, '分镜内容已修改，旧任务作废', {
                    patch: { ...sbData, ...frameStatusPatch, sourceVersion: { increment: 1 }, staleReason: null }
                })
                if (validatedCharacterIds !== undefined) {
                    await tx.storyboardCharacter.deleteMany({ where: { storyboardId: idNum } })
                    if (validatedCharacterIds.length) {
                        await tx.storyboardCharacter.createMany({
                            data: validatedCharacterIds.map(characterId => ({ id: genId(), storyboardId: idNum, characterId }))
                        })
                    }
                }
                if (visualDirty || videoDirty || deletingFrame || dialogueDirty) {
                    await resetFollowingContinuousMediaInTransaction(tx, current.episodeId, current.order, [idNum])
                    if (valueChanged('order')) await resetFollowingContinuousMediaInTransaction(tx, current.episodeId, sbData.order as number, [idNum])
                }
                return updated
            },
            { timeout: 60_000 }
        )
        .catch(error => {
            if (error instanceof StaleStoryboardMutationError) return null
            throw error
        })
    if (!storyboard) return apiError('分镜刚刚发生变化，请刷新后再保存', 409)
    if (hasCharacterChange || valueChanged('actionDesc') || valueChanged('order')) await syncEpisodeCharacterStateEvents(current.episodeId)

    return apiResponse({
        ...storyboard,
        // Return the persisted relation as well so editors can verify that a
        // successful response actually contains every requested field.
        characterIds: validatedCharacterIds ?? current.characters.map(character => character.characterId)
    })
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    await cancelStoryboardOperations(idNum, '分镜已删除，旧任务作废', true)
    return apiResponse({ id })
}
