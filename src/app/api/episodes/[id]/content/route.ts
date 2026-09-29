import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)

    const { id } = await params
    const episodeId = parseApiId(id)
    if (episodeId === null) return apiError('剧集 ID 格式无效', 400)
    const episode = await prisma.episode.findFirst({
        where: {
            id: episodeId,
            deletedAt: null,
            project: { userId, deletedAt: null }
        },
        select: {
            id: true,
            episodeNumber: true,
            title: true,
            synopsis: true,
            chapterContent: true,
            script: true,
            intensity: true,
            status: true,
            staleReason: true,
            sourceVersion: true,
            finalizedAt: true,
            updatedAt: true
        }
    })
    if (!episode) return apiError('Episode not found', 404)
    const response = apiResponse(episode)
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return response
}
