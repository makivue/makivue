import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { episodeStatusSelect, episodeStatusSnapshot } from '@/services/episode-status'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const id = parseApiId((await params).id)
    if (id === null) return apiError('剧集 ID 格式无效', 400)
    // Scope the query itself to the owner. No repair, billing or provider calls.
    const episode = await prisma.episode.findFirst({
        where: { id, deletedAt: null, project: { userId, deletedAt: null } },
        select: episodeStatusSelect
    })
    if (!episode) return apiError('Episode not found', 404)
    return apiResponse(episodeStatusSnapshot(episode))
}
