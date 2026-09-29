import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ currentUserId: vi.fn(), projectFindMany: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findMany: mocks.projectFindMany } } }))
vi.mock('@/services/billing', () => ({ assertWalletHasCoins: vi.fn(), BillingError: class extends Error {} }))
import { GET } from './route'

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
})
describe('GET /api/projects', () => {
    it('derives historical completion without exposing private video URLs or publishing the work', async () => {
        mocks.projectFindMany.mockResolvedValue([
            {
                id: 456n,
                status: 'in_production',
                totalEpisodes: 12,
                visibility: 'private',
                publishedAt: null,
                episodes: Array.from({ length: 12 }, () => ({ status: 'completed', videoUrl: 'https://media.example.com/private.mp4' })),
                _count: { episodes: 12, characters: 6 }
            }
        ])
        const response = await GET(new NextRequest('http://localhost/api/projects'))
        const { data } = await response.json()
        expect(data[0]).toMatchObject({ status: 'completed', completedEpisodes: 12, visibility: 'private', publishedAt: null })
        expect(data[0]).not.toHaveProperty('episodes')
        expect(JSON.stringify(data)).not.toContain('private.mp4')
        expect(response.headers.get('Cache-Control')).toContain('no-store')
        expect(mocks.projectFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { deletedAt: null, userId: 123n },
                select: expect.objectContaining({
                    episodes: { where: { deletedAt: null }, select: { status: true, videoUrl: true } },
                    _count: { select: { episodes: { where: { deletedAt: null } }, characters: { where: { deletedAt: null } } } }
                })
            })
        )
    })
    it('requires authentication', async () => {
        mocks.currentUserId.mockReturnValue(null)
        expect((await GET(new NextRequest('http://localhost/api/projects'))).status).toBe(401)
        expect(mocks.projectFindMany).not.toHaveBeenCalled()
    })
})
