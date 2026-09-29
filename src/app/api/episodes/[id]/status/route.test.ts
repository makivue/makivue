import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ currentUserId: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/prisma', () => ({ prisma: { episode: { findFirst: mocks.findFirst } } }))
import { GET } from './route'
const request = (id = '123') => GET(new NextRequest(`http://localhost/api/episodes/${id}/status`), { params: Promise.resolve({ id }) })
beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(9n)
})

describe('episode status authorization', () => {
    it('scopes its read to the owner and returns 404 for inaccessible episodes', async () => {
        mocks.findFirst.mockResolvedValue(null)
        expect((await request()).status).toBe(404)
        expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 123n, deletedAt: null, project: { userId: 9n, deletedAt: null } } }))
    })
    it('rejects unauthenticated or malformed requests before querying', async () => {
        expect((await request('invalid')).status).toBe(400)
        mocks.currentUserId.mockReturnValue(null)
        expect((await request()).status).toBe(401)
        expect(mocks.findFirst).not.toHaveBeenCalled()
    })
    it('returns uncacheable progress with no repair or usage queries', async () => {
        mocks.findFirst.mockResolvedValue({ id: 123n, status: null, sourceVersion: 1, updatedAt: null, videoUrl: null, storyboards: [], merges: [] })
        const response = await request()
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toContain('no-store')
        expect((await response.json()).data).toMatchObject({ id: '123', status: 'draft', storyboards: [] })
    })
})
