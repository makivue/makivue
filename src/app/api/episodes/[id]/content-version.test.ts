import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { episode: { findFirst: mocks.find }, $transaction: mocks.transaction } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 1n }))
vi.mock('@/lib/ownership', () => ({ assertEpisodeOwner: async () => null }))
import { PATCH } from './route'

describe('episode autosave version protection', () => {
    beforeEach(() => vi.resetAllMocks())
    const request = (body: unknown) => new NextRequest('http://localhost:3000/api/episodes/2', { method: 'PATCH', body: JSON.stringify(body) })

    it('rejects an old page saving its script after regeneration has committed', async () => {
        mocks.find.mockResolvedValue({ id: 2n, sourceVersion: 7, script: '新剧本' })
        const res = await PATCH(request({ script: '旧剧本', expectedSourceVersion: 6 }), { params: Promise.resolve({ id: '2' }) })
        expect(res.status).toBe(409)
        expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('accepts a no-op save of the current version', async () => {
        mocks.find.mockResolvedValue({ id: 2n, sourceVersion: 7, script: '新剧本' })
        const res = await PATCH(request({ script: '新剧本', expectedSourceVersion: 7 }), { params: Promise.resolve({ id: '2' }) })
        expect(res.status).toBe(200)
    })

    it('rejects malformed version tokens', async () => {
        const res = await PATCH(request({ script: '正文', expectedSourceVersion: '7' }), { params: Promise.resolve({ id: '2' }) })
        expect(res.status).toBe(400)
        expect(mocks.find).not.toHaveBeenCalled()
    })
})
