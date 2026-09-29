import { NextRequest } from 'next/server'
import { parseApiId } from '@/lib/api-id'
import { readStringList, normalizeSubtitleLanguages } from '@/lib/project-publication'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { getProjectProductionProgress } from '@/lib/project-progress'

type WorkCursor = { publishedAt: string; id: string }

function decodeCursor(value: string | null): { publishedAt: Date; id: bigint } | null {
    if (!value) return null
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as WorkCursor
        const publishedAt = new Date(parsed.publishedAt)
        const id = parseApiId(parsed.id)
        if (!Number.isFinite(publishedAt.getTime()) || id === null) return null
        return { publishedAt, id }
    } catch {
        return null
    }
}

function encodeCursor(publishedAt: Date, id: bigint) {
    return Buffer.from(JSON.stringify({ publishedAt: publishedAt.toISOString(), id: id.toString() } satisfies WorkCursor)).toString('base64url')
}

function subtitleLanguagesFromMerges(episodes: Array<{ merges: Array<{ subtitleUrls: string | null }> }>) {
    const languages = new Set<string>()
    for (const episode of episodes) {
        const raw = episode.merges[0]?.subtitleUrls
        if (!raw) continue
        try {
            const urls = JSON.parse(raw) as Record<string, unknown>
            for (const [language, url] of Object.entries(urls)) {
                if (typeof url === 'string' && url) languages.add(language)
            }
        } catch {}
    }
    return normalizeSubtitleLanguages([...languages])
}

export async function GET(req: NextRequest) {
    const query = req.nextUrl.searchParams.get('q')?.trim().slice(0, 100)
    const genre = req.nextUrl.searchParams.get('genre')?.trim().slice(0, 50)
    const requestedLimit = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 20
    const cursorValue = req.nextUrl.searchParams.get('cursor')
    const cursor = decodeCursor(cursorValue)
    if (cursorValue && !cursor) return apiError('Invalid cursor', 400)

    const rows = await prisma.project.findMany({
        where: {
            deletedAt: null,
            visibility: 'public',
            publishedAt: { not: null },
            ...(genre ? { genreCode: genre } : {}),
            ...(query ? { AND: [{ OR: [{ title: { contains: query } }, { seoTitle: { contains: query } }, { description: { contains: query } }] }] } : {}),
            ...(cursor
                ? {
                      OR: [{ publishedAt: { lt: cursor.publishedAt } }, { publishedAt: cursor.publishedAt, id: { lt: cursor.id } }]
                  }
                : {})
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
            id: true,
            userId: true,
            title: true,
            description: true,
            seoTitle: true,
            seoDescription: true,
            seoKeywords: true,
            coverUrl: true,
            coverAlt: true,
            trailerUrl: true,
            trailerDuration: true,
            genreCode: true,
            genreLabel: true,
            totalEpisodes: true,
            videoAspectRatio: true,
            visualStyle: true,
            contentLanguage: true,
            subtitleLanguages: true,
            episodeFormat: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            publishedAt: true,
            episodes: {
                where: { deletedAt: null },
                select: {
                    status: true,
                    videoUrl: true,
                    merges: {
                        where: { status: 'completed' },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: { subtitleUrls: true }
                    }
                }
            }
        }
    })

    const page = rows.slice(0, limit)
    const userIds = [...new Set(page.map(project => project.userId))]
    const [profiles, identities] = await Promise.all([
        userIds.length ? prisma.userProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, displayName: true, avatarUrl: true } }) : Promise.resolve([]),
        userIds.length ? prisma.userIdentity.findMany({ where: { userId: { in: userIds }, provider: 'google' }, select: { userId: true, displayName: true, avatarUrl: true } }) : Promise.resolve([])
    ])
    const profileByUser = new Map(profiles.map(profile => [profile.userId.toString(), profile]))
    const identityByUser = new Map(identities.map(identity => [identity.userId.toString(), identity]))

    const works = page.map(project => {
        const profile = profileByUser.get(project.userId.toString())
        const identity = identityByUser.get(project.userId.toString())
        const availableSubtitleLanguages = subtitleLanguagesFromMerges(project.episodes)
        return {
            id: project.id,
            title: project.title,
            description: project.description,
            seoTitle: project.seoTitle,
            seoDescription: project.seoDescription,
            seoKeywords: readStringList(project.seoKeywords),
            coverUrl: project.coverUrl,
            coverAlt: project.coverAlt,
            trailerUrl: project.trailerUrl,
            trailerDuration: project.trailerDuration,
            genre: { code: project.genreCode, label: project.genreLabel },
            totalEpisodes: project.totalEpisodes,
            ...getProjectProductionProgress(project),
            videoAspectRatio: project.videoAspectRatio,
            visualStyle: project.visualStyle,
            contentLanguage: project.contentLanguage,
            subtitleLanguages: normalizeSubtitleLanguages(project.subtitleLanguages),
            availableSubtitleLanguages,
            episodeFormat: project.episodeFormat,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            publishedAt: project.publishedAt,
            author: {
                userId: project.userId,
                displayName: profile?.displayName ?? identity?.displayName ?? null,
                avatarUrl: profile?.avatarUrl ?? identity?.avatarUrl ?? null
            }
        }
    })

    const last = page.at(-1)
    const nextCursor = rows.length > limit && last?.publishedAt ? encodeCursor(last.publishedAt, last.id) : null
    const response = apiResponse({ works, nextCursor })
    response.headers.set('Cache-Control', 'no-store')
    return response
}
