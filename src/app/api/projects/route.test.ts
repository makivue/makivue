import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ currentUserId: vi.fn(), projectFindMany: vi.fn(), styleFindFirst: vi.fn(), transaction: vi.fn(), projectCreate: vi.fn(), episodeCreateMany: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findMany: mocks.projectFindMany }, styleLibraryEntry: { findFirst: mocks.styleFindFirst }, $transaction: mocks.transaction } }))
vi.mock('@/services/billing', () => ({ assertWalletHasCoins: vi.fn(), BillingError: class extends Error {} }))
import { GET, POST } from './route'
import { parseNovelSetup } from '@/lib/novel'

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.transaction.mockImplementation(callback => callback({ project: { create: mocks.projectCreate }, episode: { createMany: mocks.episodeCreateMany } }))
    mocks.projectCreate.mockImplementation(({ data }) => data)
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


describe('project creation with a local style library entry', () => {
    function request(styleLibraryId: unknown) {
        return new NextRequest('http://localhost/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Local drama', visualStyle: 'cinematic', styleLibraryId })
        })
    }

    it('freezes the selected style and image anchors into the project setup', async () => {
        mocks.styleFindFirst.mockResolvedValue({
            id: 7n, kind: 'theme', name: '港口故事', description: '清晨暖光', baseStyle: 'pixel-art',
            region: '滨海小城', genre: null, referenceImages: ['/api/local-media/style-library/123/reference.webp']
        })
        expect((await POST(request('7'))).status).toBe(201)
        expect(mocks.styleFindFirst).toHaveBeenCalledWith({ where: { id: 7n, userId: 123n } })
        const data = mocks.projectCreate.mock.calls[0][0].data
        expect(data.visualStyle).toBe('pixel-art')
        const setup = parseNovelSetup(data.novelSetup)
        expect(setup.styleReferencePrompt).toContain('港口故事')
        expect(setup.styleReferenceImages).toEqual(['/api/local-media/style-library/123/reference.webp'])
        expect(setup.worldBible).toContain('滨海小城')
        expect(setup.visualStyleProfile?.imagePromptPrefix).toContain('User art direction:')
    })

    it('rejects absent or malformed selections before creating records', async () => {
        mocks.styleFindFirst.mockResolvedValue(null)
        expect((await POST(request('7'))).status).toBe(404)
        expect((await POST(request('../7'))).status).toBe(404)
        expect((await POST(request(7))).status).toBe(404)
        expect(mocks.projectCreate).not.toHaveBeenCalled()
    })
})
