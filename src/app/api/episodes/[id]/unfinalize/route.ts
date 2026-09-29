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
        where: { id: idNum, deletedAt: null }
    })
    if (!episode) return apiError('Episode not found', 404)
    if (episode.status === 'scripted' || episode.status === 'storyboarded') {
        return apiError('本集已经生成剧本或分镜，不能直接解除定稿；请先通过受保护的重置流程处理下游资产', 409)
    }

    await prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'drafted', finalizedAt: null }
    })

    const project = await prisma.project.findFirst({
        where: { id: episode.projectId, deletedAt: null }
    })
    if (project && (project.novelStage === 'finalized' || project.novelStage === 'scripted')) {
        await prisma.project.update({
            where: { id: project.id },
            data: { novelStage: 'drafting' }
        })
    }

    return apiResponse({ ok: true })
}
