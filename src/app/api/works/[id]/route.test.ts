import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ project: vi.fn(), profile: vi.fn(), identity: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findFirst: mocks.project }, userProfile: { findUnique: mocks.profile }, userIdentity: { findUnique: mocks.identity } } }))
import { GET } from './route'
const request = new NextRequest('http://localhost/api/works/456')
const params = { params: Promise.resolve({ id: '456' }) }
beforeEach(() => {
    vi.resetAllMocks()
    mocks.profile.mockResolvedValue({ displayName: 'Creator', avatarUrl: null })
    mocks.identity.mockResolvedValue(null)
})

describe('public work playback', () => {
    it('requires a published public work and only exposes live, playable episodes', async () => {
        mocks.project.mockResolvedValue({
            id: 456n,
            userId: 123n,
            title: 'Space',
            totalEpisodes: 3,
            status: 'completed',
            novel: 'private story',
            episodes: [
                { id: 1n, episodeNumber: 1, title: 'One', status: 'completed', videoUrl: 'https://media.example.com/1.mp4', script: 'private script' },
                { id: 2n, episodeNumber: 2, status: 'completed', videoUrl: '/storage/2.mp4' },
                { id: 3n, episodeNumber: 3, status: 'draft', videoUrl: null }
            ]
        })
        const response = await GET(request, params)
        const { data } = await response.json()
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(data).toMatchObject({
            id: '456',
            completedEpisodes: 1,
            status: 'in_production',
            author: { displayName: 'Creator' },
            episodes: [{ id: '1', episodeNumber: 1, title: 'One', videoUrl: 'https://media.example.com/1.mp4' }]
        })
        expect(JSON.stringify(data)).not.toContain('private')
        expect(mocks.project).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 456n, deletedAt: null, visibility: 'public', publishedAt: { not: null } },
                select: expect.objectContaining({ episodes: expect.objectContaining({ where: { deletedAt: null }, orderBy: { episodeNumber: 'asc' } }) })
            })
        )
    })
    it.each(['private', 'unlisted', 'deleted', 'unpublished'])('returns 404 when the visibility query excludes a %s work', async () => {
        mocks.project.mockResolvedValue(null)
        expect((await GET(request, params)).status).toBe(404)
        expect(mocks.profile).not.toHaveBeenCalled()
    })
    it('does not query invalid IDs', async () => {
        expect((await GET(request, { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(404)
        expect(mocks.project).not.toHaveBeenCalled()
    })
})
