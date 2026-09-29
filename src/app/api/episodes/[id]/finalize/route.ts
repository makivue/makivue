import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard
    const episode = await prisma.episode.findFirst({
        where: { id: idNum, deletedAt: null },
        include: { project: true }
    })
    if (!episode) return apiError('Episode not found', 404)
    if (!episode.chapterContent || !episode.chapterContent.trim()) {
        return apiError('章节正文为空，无法定稿')
    }

    const finalized = await prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'finalized', finalizedAt: new Date() }
    })

    const siblings = await prisma.episode.findMany({
        where: { projectId: episode.projectId, deletedAt: null },
        orderBy: { episodeNumber: 'asc' }
    })
    // scripted/storyboarded 章节已经完成定稿阶段，也应计入“全部定稿”，
    // 否则前端允许继续下一步，但项目阶段不会同步更新。
    const finalizedStatuses = new Set(['finalized', 'scripted', 'storyboarded'])
    const allFinalized = siblings.every(e => finalizedStatuses.has(e.status ?? ''))

    if (allFinalized && episode.project) {
        const merged = siblings
            .map(e => (e.id === episode.id ? episode.chapterContent : (e.chapterContent ?? '')))
            .filter(Boolean)
            .join('\n\n')
        await prisma.project.update({
            where: { id: episode.projectId },
            data: { novelStage: 'finalized', novel: merged }
        })
    }

    return apiResponse({
        ok: true,
        allFinalized,
        episode: { id: finalized.id.toString(), status: finalized.status, finalizedAt: finalized.finalizedAt }
    })
}
