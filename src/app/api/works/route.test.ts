import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    projectFindMany: vi.fn(),
    profileFindMany: vi.fn(),
    identityFindMany: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        project: { findMany: mocks.projectFindMany },
        userProfile: { findMany: mocks.profileFindMany },
        userIdentity: { findMany: mocks.identityFindMany }
    }
}))

import { GET } from './route'

beforeEach(() => {
    vi.resetAllMocks()
    mocks.projectFindMany.mockResolvedValue([
        {
            id: 456n,
            userId: 123n,
            title: '雨夜追凶',
            description: '一场雨夜谜案。',
            seoTitle: '雨夜追凶',
            seoDescription: '一场雨夜谜案。',
            seoKeywords: ['悬疑', '短剧'],
            coverUrl: 'https://example.com/cover.jpg',
            coverAlt: '雨夜追凶封面',
            trailerUrl: 'https://example.com/trailer.mp4',
            trailerDuration: 30,
            genreCode: 'suspense',
            genreLabel: '悬疑',
            totalEpisodes: 2,
            videoAspectRatio: '9:16',
            visualStyle: 'cinematic',
            contentLanguage: 'zh',
            subtitleLanguages: ['zh', 'en'],
            episodeFormat: 'micro',
            status: 'completed',
            createdAt: new Date('2026-09-16T00:00:00Z'),
            updatedAt: new Date('2026-09-17T00:00:00Z'),
            publishedAt: new Date('2026-09-17T00:00:00Z'),
            episodes: [
                { status: 'completed', videoUrl: 'https://example.com/ep1.mp4', merges: [{ subtitleUrls: JSON.stringify({ zh: 'https://example.com/zh.srt' }) }] },
                { status: 'draft', videoUrl: null, merges: [] }
            ]
        }
    ])
    mocks.profileFindMany.mockResolvedValue([{ userId: 123n, displayName: '小雨', avatarUrl: 'https://example.com/avatar.jpg' }])
    mocks.identityFindMany.mockResolvedValue([{ userId: 123n, displayName: 'Google name', avatarUrl: 'https://example.com/google.jpg', email: 'private@example.com' }])
})

describe('GET /api/works', () => {
    it('returns public display metadata and omits private identity fields', async () => {
        const response = await GET(new NextRequest('https://example.com/api/works'))
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(body.data.works[0]).toMatchObject({
            id: '456',
            totalEpisodes: 2,
            completedEpisodes: 1,
            status: 'in_production',
            subtitleLanguages: ['zh', 'en'],
            availableSubtitleLanguages: ['zh'],
            author: { userId: '123', displayName: '小雨', avatarUrl: 'https://example.com/avatar.jpg' }
        })
        expect(JSON.stringify(body)).not.toContain('private@example.com')
        expect(mocks.projectFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, visibility: 'public', publishedAt: { not: null } } }))
    })

    it('combines search and genre filters with the public visibility gate', async () => {
        await GET(new NextRequest('https://example.com/api/works?q=Space&genre=sci_fi'))
        expect(mocks.projectFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    visibility: 'public',
                    genreCode: 'sci_fi',
                    AND: [{ OR: [{ title: { contains: 'Space' } }, { seoTitle: { contains: 'Space' } }, { description: { contains: 'Space' } }] }]
                })
            })
        )
    })
})
