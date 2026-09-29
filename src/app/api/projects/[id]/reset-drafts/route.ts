import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { finishEpisodeDownstreamReset, resetEpisodeDownstreamInTransaction } from '@/services/episode-downstream-reset'
import { cancelProjectOperationsInTransaction } from '@/lib/operation-cancellation'
import { clearProjectExtractedEntitiesInTransaction } from '@/services/extracted-entities'
import { Prisma } from '@/generated/prisma/client'
import { compiledNovelResetPatch } from '@/lib/compiled-novel-reset'

type Params = { params: Promise<{ id: string }> }

// 确认大纲后重新写正文：已定稿、已拆本的章节同样依赖旧大纲，必须一起重置。
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(idNum, userId)
    if (guard) return guard
    // Older clients only confirmed clearing unfinished drafts. Do not widen
    // that request to finalized work without the new explicit confirmation.
    const body = await req.json().catch(() => null)
    if (body?.clearAllDownstream !== true) return apiError('请确认清空全部正文和后续内容后重试', 409)
    const project = await prisma.project.findFirst({
        where: { id: idNum, deletedAt: null },
        include: { episodes: { where: { deletedAt: null } } }
    })
    if (!project) return apiError('Project not found', 404)

    const result = await prisma.$transaction(
        async tx => {

            const cancelled = await cancelProjectOperationsInTransaction(tx, idNum, '重新确认大纲，旧下游任务作废')
            const resettable = await tx.episode.findMany({
                where: { projectId: idNum, deletedAt: null },
                orderBy: { episodeNumber: 'asc' }
            })
            const completed = []
            for (const episode of resettable) {

                const current = await tx.episode.findUnique({ where: { id: episode.id } })
                if (!current || current.deletedAt) continue
                const reset = await resetEpisodeDownstreamInTransaction(tx, current, 'outline')
                await tx.episode.update({ where: { id: current.id }, data: { ...reset.patch, sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } } })
                completed.push(reset)
            }
            await tx.extractJob.deleteMany({ where: { projectId: idNum } })
            await clearProjectExtractedEntitiesInTransaction(tx, idNum)
            if (completed.length) {
                await tx.project.update({
                    where: { id: project.id },
                    data: { ...compiledNovelResetPatch(project), novelStage: 'outlined', staleScopes: Prisma.DbNull, sourceVersion: { increment: 1 } }
                })
            }
            return { cleared: completed.length, epJobIds: [...cancelled.epJobIds, ...completed.flatMap(reset => reset.epJobIds)], artifacts: completed.flatMap(reset => reset.artifacts) }
        },
        { timeout: 60_000 }
    )
    await finishEpisodeDownstreamReset(result)

    return apiResponse({ cleared: result.cleared })
}
