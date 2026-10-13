import { localTransactionLock } from '@/lib/local-store'
import { after, NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId, parseApiIds } from '@/lib/api-id'
import { cancelProjectOperationsInTransaction } from '@/lib/operation-cancellation'
import { clearProjectExtractedEntitiesInTransaction } from '@/services/extracted-entities'
import { finishEpisodeDownstreamReset, resetEpisodeDownstreamInTransaction } from '@/services/episode-downstream-reset'

type Params = { params: Promise<{ id: string }> }
export const maxDuration = 120

/** Clear all existing scripts and their media descendants before a full re-adaptation. */
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(idNum, userId)
    if (guard) return guard
    const body = await req.json().catch(() => null)
    if (body?.clearAllScripts !== true) return apiError('请确认清空全部剧本和下游内容后重试', 409)
    const requestedEpisodeIds = parseApiIds(body?.episodeIds)
    if (!requestedEpisodeIds || requestedEpisodeIds.length === 0) return apiError('待重拆剧集列表无效', 400)
    const project = await prisma.project.findFirst({ where: { id: idNum, deletedAt: null } })
    if (!project) return apiError('Project not found', 404)

    const result = await prisma
        .$transaction(
            async tx => {
                await localTransactionLock('reset-scripts-project')
                const episodes = await tx.episode.findMany({
                    where: { projectId: idNum, id: { in: requestedEpisodeIds }, deletedAt: null },
                    orderBy: { episodeNumber: 'asc' }
                })
                if (episodes.length !== requestedEpisodeIds.length || episodes.some(episode => !['finalized', 'scripted', 'storyboarded'].includes(episode.status ?? ''))) {
                    throw new Error('SCRIPT_RESET_SOURCE_CHANGED')
                }
                const cancelled = await cancelProjectOperationsInTransaction(tx, idNum, '全部重拆剧本，旧下游任务作废')
                const completed = []
                const clearedEpisodes = []
                for (const episode of episodes) {
                    await localTransactionLock('reset-scripts-episode')
                    const current = await tx.episode.findUnique({ where: { id: episode.id } })
                    if (!current || current.deletedAt) throw new Error('SCRIPT_RESET_SOURCE_CHANGED')
                    const reset = await resetEpisodeDownstreamInTransaction(tx, current, 'script')
                    const updated = await tx.episode.update({
                        where: { id: current.id },
                        data: { ...reset.patch, script: null, status: 'finalized', sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } }
                    })
                    await tx.qualityReview.deleteMany({ where: { episodeId: current.id, scope: 'script' } })
                    clearedEpisodes.push({ id: updated.id.toString(), sourceVersion: updated.sourceVersion })
                    completed.push(reset)
                }
                await tx.extractJob.deleteMany({ where: { projectId: idNum } })
                await clearProjectExtractedEntitiesInTransaction(tx, idNum)
                if (completed.length) {
                    await tx.project.update({
                        where: { id: idNum },
                        data: { status: 'in_production', novelStage: 'finalized', staleScopes: Prisma.DbNull, sourceVersion: { increment: 1 } }
                    })
                }
                return {
                    cleared: completed.length,
                    episodes: clearedEpisodes,
                    epJobIds: [...cancelled.epJobIds, ...completed.flatMap(reset => reset.epJobIds)],
                    artifacts: completed.flatMap(reset => reset.artifacts)
                }
            },
            { timeout: 60_000 }
        )
        .catch(error => {
            if (error instanceof Error && error.message === 'SCRIPT_RESET_SOURCE_CHANGED') return null
            throw error
        })
    if (!result) return apiError('内容刚刚发生变化，请刷新后再保存', 409)
    await finishEpisodeDownstreamReset({ epJobIds: result.epJobIds, artifacts: [] })
    if (result.artifacts.length) after(() => finishEpisodeDownstreamReset({ epJobIds: [], artifacts: result.artifacts }))
    return apiResponse({ cleared: result.cleared, episodes: result.episodes })
}
