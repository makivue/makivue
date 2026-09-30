import { parseApiId, parseApiIds } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { genId } from '@/lib/id'
import { assertEpisodeOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { normalizeStoryboardActionPlan, serializeStoryboardActionPlan } from '@/lib/storyboard-action-plan'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'
import { resolveStoryboardEntityLinks } from '@/lib/storyboard-entity-resolution'
import { apiError, apiResponse } from '@/lib/utils'
import { clearEpisodeMergedVideoInTransaction, resetFollowingContinuousMediaInTransaction } from '@/services/artifacts'
import { finishEpisodeDownstreamReset } from '@/services/episode-downstream-reset'
import { supersedeEpisodeStoryboardDataInTransaction } from '@/services/episode-storyboard-replacement'
import { NextRequest } from 'next/server'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard
    const storyboards = await prisma.storyboard.findMany({
        where: { episodeId: idNum, deletedAt: null },
        orderBy: { order: 'asc' },
        include: {
            characters: { include: { character: true } },
            scene: true,
            generations: { orderBy: { createdAt: 'desc' }, take: 5 }
        }
    })
    return apiResponse(storyboards)
}

// 批量创建分镜（AI分镜结果写入）
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('请求内容不是有效 JSON')
    const { storyboards, overwriteExisting = false } = body as {
        storyboards: Array<{
            order: number
            shotType?: string
            duration?: number
            dialogue?: string
            narration?: string
            actionDesc?: string
            imagePrompt?: string
            sceneId?: string
            characterIds?: string[]
            sceneName?: string | null
            characterNames?: string[]
            continuityMode?: 'independent' | 'stateful' | 'continuous' | 'seamless'
            continuityReason?: string | null
        }>
        overwriteExisting?: boolean
    }

    if (!Array.isArray(storyboards)) return apiError('storyboards array required')
    if (storyboards.length < 1 || storyboards.length > 200) return apiError('一次只能提交 1-200 个分镜')

    const episode = await prisma.episode.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            project: {
                include: {
                    characters: { where: { deletedAt: null } },
                    scenes: { where: { deletedAt: null } }
                }
            }
        }
    })
    if (!episode) return apiError('Episode not found', 404)

    const resolvedInputs: Array<{
        sb: (typeof storyboards)[number]
        sceneId: bigint | null
        characterIds: bigint[]
        sceneName: string | null
        characterNames: string[]
    }> = []
    for (const sb of storyboards) {
        if (!Number.isInteger(sb.order) || sb.order < 1 || sb.order > 1000) return apiError('分镜顺序无效')
        const requestedSceneId = sb.sceneId == null || sb.sceneId === '' ? null : parseApiId(sb.sceneId)
        if (sb.sceneId != null && sb.sceneId !== '' && requestedSceneId === null) return apiError('场景 ID 格式无效')
        const requestedCharacterIds = sb.characterIds === undefined ? [] : parseApiIds(sb.characterIds)
        if (requestedCharacterIds === null) return apiError('角色 ID 列表格式无效')
        const links = resolveStoryboardEntityLinks(sb, {
            characters: episode.project.characters,
            scenes: episode.project.scenes
        })
        const sceneId = requestedSceneId ?? links.scene?.id ?? null
        const characterIds = requestedCharacterIds.length > 0 ? requestedCharacterIds : links.characters.map(character => character.id)
        resolvedInputs.push({
            sb,
            sceneId,
            characterIds,
            sceneName: episode.project.scenes.find(scene => scene.id === sceneId)?.name ?? links.scene?.name ?? null,
            characterNames: characterIds.map(characterId => episode.project.characters.find(character => character.id === characterId)?.name).filter((name): name is string => !!name)
        })
    }
    const classified = resolvedInputs.map(item => ({ ...item.sb, sceneId: item.sceneId, sceneName: item.sceneName, characterNames: item.characterNames, continuityMode: 'independent' }))
    const prepared = classified.map((sb, index) => ({ sb, sceneId: resolvedInputs[index].sceneId, characterIds: resolvedInputs[index].characterIds }))
    const sceneIds = [...new Set(prepared.map(item => item.sceneId).filter((id): id is bigint => id !== null))]
    const characterIds = [...new Set(prepared.flatMap(item => item.characterIds))]
    if (sceneIds.length) {
        const count = await prisma.scene.count({ where: { id: { in: sceneIds }, projectId: episode.projectId, deletedAt: null } })
        if (count !== sceneIds.length) return apiError('场景列表包含不属于当前项目的场景')
    }
    if (characterIds.length) {
        const count = await prisma.character.count({ where: { id: { in: characterIds }, projectId: episode.projectId, deletedAt: null } })
        if (count !== characterIds.length) return apiError('角色列表包含不属于当前项目的角色')
    }

    const created = await prisma
        .$transaction(
            async tx => {
                const locked = await tx.episode.findUnique({ where: { id: idNum } })
                if (!locked || locked.deletedAt || locked.operationVersion !== episode.operationVersion) throw new Error('STORYBOARD_SOURCE_CHANGED')
                const existing = await tx.storyboard.findMany({ where: { episodeId: idNum, deletedAt: null }, select: { id: true, order: true } })
                let replacement = null
                if (!overwriteExisting) {
                    const existingOrders = new Set(existing.map(item => item.order))
                    if (prepared.some(item => existingOrders.has(item.sb.order))) throw new Error('STORYBOARD_ORDER_CONFLICT')
                } else {
                    replacement = await supersedeEpisodeStoryboardDataInTransaction(tx, idNum)
                }
                const rows = []
                for (const item of prepared) {
                    const { sb, sceneId, characterIds: storyboardCharacterIds } = item
                    const sbData = sb
                    const actionPlan = normalizeStoryboardActionPlan(undefined, sbData.actionDesc)
                    const actionDesc = actionPlan ? serializeStoryboardActionPlan(actionPlan) : sbData.actionDesc
                    const audioPlan = buildStoryboardAudioPlan(sbData)
                    const shotType = sbData.shotType || 'medium'
                    const storyboard = await tx.storyboard.create({
                        data: {
                            id: genId(),
                            shotType,
                            duration: typeof sbData.duration === 'number' && Number.isFinite(sbData.duration) ? Math.min(60, Math.max(1, Math.round(sbData.duration))) : 5,
                            episodeId: idNum,
                            sceneId: sceneId ?? undefined,
                            order: sbData.order,
                            dialogue: sbData.dialogue?.slice(0, 20_000),
                            narration: sbData.narration?.slice(0, 20_000),
                            actionDesc: actionDesc?.slice(0, 20_000),
                            ...(actionPlan ? { actionPlan: actionPlan as unknown as object } : {}),
                            ...(audioPlan ? { audioPlan: audioPlan as unknown as object } : {}),
                            imagePrompt: sbData.imagePrompt?.slice(0, 20_000),
                            continuityMode: sb.continuityMode,
                            originalShotType: sbData.shotType ?? null,
                            polishStatus: 'not_requested',
                            promptVersion: 'storyboard-contract-v2',
                            generationModel: 'rules-fallback',
                            sourceVersion: episode.sourceVersion
                        }
                    })
                    if (storyboardCharacterIds.length) {
                        await tx.storyboardCharacter.createMany({
                            data: storyboardCharacterIds.map(characterId => ({
                                id: genId(),
                                storyboardId: storyboard.id,
                                characterId
                            }))
                        })
                    }
                    rows.push(storyboard)
                }
                if (episode.status !== 'storyboarding') {
                    await tx.episode.update({ where: { id: idNum }, data: { status: 'storyboarded' } })
                }
                await clearEpisodeMergedVideoInTransaction(tx, idNum)
                if (!overwriteExisting) await resetFollowingContinuousMediaInTransaction(tx, idNum, Math.min(...prepared.map(item => item.sb.order)))
                return { rows, replacement }
            },
            { timeout: 60_000 }
        )
        .catch(error => {
            if (error instanceof Error && ['STORYBOARD_ORDER_CONFLICT', 'STORYBOARD_SOURCE_CHANGED'].includes(error.message)) return null
            throw error
        })
    if (!created) return apiError('分镜内容已变化或序号冲突，请刷新；如需全部替换，请明确选择“覆盖现有分镜”', 409)

    if (created.replacement) await finishEpisodeDownstreamReset(created.replacement)

    return apiResponse(created.rows, 201)
}
