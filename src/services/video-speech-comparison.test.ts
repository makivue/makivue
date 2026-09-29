import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userId: 7n as bigint | null, owner: vi.fn(), findMany: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => mocks.userId }))
vi.mock('@/lib/ownership', () => ({ assertStoryboardOwner: mocks.owner }))
vi.mock('@/lib/prisma', () => ({ prisma: { generation: { findMany: mocks.findMany, create: mocks.create } } }))

import { GET, POST } from '@/app/api/storyboards/[id]/compare-speech/route'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.userId = 7n
    mocks.owner.mockResolvedValue(null)
})

describe('retired video speech comparison', () => {
    it('rejects creation without submitting or billing a generation', async () => {
        const response = await POST(new Request('http://localhost/api/storyboards/1/compare-speech') as never, { params: Promise.resolve({ id: '1' }) })
        expect(response.status).toBe(410)
        expect(mocks.owner).toHaveBeenCalledWith(1n, 7n)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('still lets the owner retrieve paid historical samples', async () => {
        mocks.findMany.mockResolvedValue([{ id: 2n, provider: 'wanx', status: 'completed', resultUrl: 'https://cdn.example/history.mp4' }])
        const response = await GET(new Request('http://localhost/api/storyboards/1/compare-speech') as never, { params: Promise.resolve({ id: '1' }) })
        expect(response.status).toBe(200)
        expect((await response.json()).data[0]).toMatchObject({ provider: 'wanx', resultUrl: 'https://cdn.example/history.mp4' })
        expect(mocks.owner).toHaveBeenCalledWith(1n, 7n)
    })

    it('requires authentication even on the retired endpoint', async () => {
        mocks.userId = null
        expect((await POST(new Request('http://localhost') as never, { params: Promise.resolve({ id: '1' }) })).status).toBe(401)
        expect(mocks.owner).not.toHaveBeenCalled()
    })

    it('removes the old generation implementation and active UI entry point', () => {
        const ai = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        expect(ai).not.toMatch(/HappyHorse|happyhorse-1\.1|Happy Horse/)
        expect(page).not.toContain('generateSpeechComparison')
        expect(page).not.toContain('Happy Horse')
    })
})
