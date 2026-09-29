import { NextRequest } from 'next/server'
import { parseApiId } from '@/lib/api-id'
import { prisma } from '@/lib/prisma'
import { getProjectProductionProgress, hasMergedEpisodeVideo } from '@/lib/project-progress'
import { apiError, apiResponse } from '@/lib/utils'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const id = parseApiId((await params).id)
    if (id === null) return apiError('Project not found', 404)
    const project = await prisma.project.findFirst({
        // Never reuse the owner's project endpoint for public playback.
        where: { id, deletedAt: null, visibility: 'public', publishedAt: { not: null } },
        select: {
            id: true,
            userId: true,
            title: true,
            description: true,
            seoTitle: true,
            seoDescription: true,
            coverUrl: true,
            coverAlt: true,
            trailerUrl: true,
            genreCode: true,
            genreLabel: true,
            totalEpisodes: true,
            status: true,
            contentLanguage: true,
            publishedAt: true,
            episodes: {
                where: { deletedAt: null },
                orderBy: { episodeNumber: 'asc' },
                select: { id: true, episodeNumber: true, title: true, status: true, videoUrl: true }
            }
        }
    })
    if (!project) return apiError('Project not found', 404)
    const [profile, identity] = await Promise.all([
        prisma.userProfile.findUnique({ where: { userId: project.userId }, select: { displayName: true, avatarUrl: true } }),
        prisma.userIdentity.findUnique({ where: { userId_provider: { userId: project.userId, provider: 'google' } }, select: { displayName: true, avatarUrl: true } })
    ])
    const response = apiResponse({
        id: project.id,
        title: project.title,
        description: project.description,
        seoTitle: project.seoTitle,
        seoDescription: project.seoDescription,
        coverUrl: project.coverUrl,
        coverAlt: project.coverAlt,
        trailerUrl: project.trailerUrl,
        genre: { code: project.genreCode, label: project.genreLabel },
        totalEpisodes: project.totalEpisodes,
        ...getProjectProductionProgress(project),
        contentLanguage: project.contentLanguage,
        publishedAt: project.publishedAt,
        author: { displayName: profile?.displayName ?? identity?.displayName ?? null, avatarUrl: profile?.avatarUrl ?? identity?.avatarUrl ?? null },
        episodes: project.episodes
            .filter(episode => hasMergedEpisodeVideo(episode.videoUrl))
            .map(episode => ({ id: episode.id, episodeNumber: episode.episodeNumber, title: episode.title, videoUrl: episode.videoUrl!.trim() }))
    })
    // Recheck visibility on every visit, including after a work is taken down.
    response.headers.set('Cache-Control', 'no-store')
    return response
}
