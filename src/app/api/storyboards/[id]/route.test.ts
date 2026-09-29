import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), transaction: vi.fn(), findUnique: vi.fn(), reset: vi.fn(), following: vi.fn(), sync: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { storyboard: { findFirst: mocks.findFirst }, $transaction: mocks.transaction } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 1n }))
vi.mock('@/lib/ownership', () => ({ assertStoryboardOwner: async () => null }))
vi.mock('@/lib/operation-cancellation', () => ({ cancelStoryboardOperations: vi.fn() }))
vi.mock('@/services/character-state', () => ({ syncEpisodeCharacterStateEvents: mocks.sync }))
vi.mock('@/services/artifacts', () => ({
    resetStoryboardMediaInTransaction: mocks.reset,
    resetFollowingContinuousMediaInTransaction: mocks.following,
    StaleStoryboardMutationError: class extends Error {}
}))
import { PATCH } from './route'

describe('storyboard edits invalidate dependent media', () => {
    const current = {
        id: 1n,
        episodeId: 2n,
        episode: { projectId: 3n },
        operationVersion: 4,
        order: 1,
        duration: 5,
        actionDesc: '走进房间',
        narration: '夜色深了',
        dialogue: '甲：你好',
        characters: [],
        firstFrameUrl: 'frame.png',
        lastFrameUrl: null,
        plannedLastFrameUrl: null
    }
    const request = (body: object) => PATCH(new NextRequest('http://localhost/api/storyboards/1', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: '1' }) })
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.findFirst.mockResolvedValue(current)
        mocks.findUnique.mockResolvedValue(current)
        mocks.transaction.mockImplementation(callback => callback({ $queryRaw: vi.fn(), storyboard: { findUnique: mocks.findUnique } }))
        mocks.reset.mockImplementation(async (_tx, _source, _scopes, _reason, options) => ({ ...current, ...options.patch }))
    })

    it.each([
        [{ actionDesc: '停在门口' }, ['frame']],
        [{ narration: '天亮了' }, ['video', 'audio']],
        [{ dialogue: '甲：再见' }, ['video', 'audio']],
        [{ order: 2 }, ['frame']],
        [{ duration: 8 }, ['video']]
    ])('uses the correct dependency scope for %j', async (body, scopes) => {
        expect((await request(body)).status).toBe(200)
        expect(mocks.reset).toHaveBeenCalledWith(
            expect.anything(),
            current,
            scopes,
            expect.any(String),
            expect.objectContaining({ patch: expect.objectContaining({ sourceVersion: { increment: 1 } }) })
        )
        expect(mocks.following).toHaveBeenCalledWith(expect.anything(), 2n, 1, [1n])
    })

    it('does not discard completed work when saving unchanged content', async () => {
        expect((await request({ actionDesc: current.actionDesc, narration: current.narration, duration: current.duration })).status).toBe(200)
        expect(mocks.transaction).not.toHaveBeenCalled()
        expect(mocks.reset).not.toHaveBeenCalled()
    })

    it('returns persisted character ids so the editor can verify a save', async () => {
        const response = await request({ characterIds: [] })

        await expect(response.json()).resolves.toMatchObject({ success: true, data: { characterIds: [] } })
    })

    it('stores a structured action plan when labeled action text changes', async () => {
        const actionDesc = 'Opening state: 甲站在门边; Middle state 1: 门铃响起后甲看向门把，屏住呼吸并抬起右手; Ending state: 甲握住门把'
        expect((await request({ actionDesc })).status).toBe(200)
        expect(mocks.reset).toHaveBeenCalledWith(
            expect.anything(),
            current,
            ['frame'],
            expect.any(String),
            expect.objectContaining({
                patch: expect.objectContaining({
                    actionPlan: expect.objectContaining({ opening: '甲站在门边', middles: [expect.objectContaining({ index: 1 })], ending: '甲握住门把' })
                })
            })
        )
    })

    it('rebuilds the independent audio timeline when dialogue changes', async () => {
        expect((await request({ dialogue: '甲：先别开门' })).status).toBe(200)
        expect(mocks.reset).toHaveBeenCalledWith(
            expect.anything(),
            current,
            ['video', 'audio'],
            expect.any(String),
            expect.objectContaining({
                patch: expect.objectContaining({
                    audioPlan: expect.objectContaining({
                        duration: 5,
                        cues: expect.arrayContaining([expect.objectContaining({ mode: 'dialogue', text: '先别开门', lipSync: true })])
                    })
                })
            })
        )
    })

    it('invalidates successors at both ends of a reorder across an intervening cut', async () => {
        expect((await request({ order: 6 })).status).toBe(200)
        expect(mocks.following).toHaveBeenCalledWith(expect.anything(), 2n, 1, [1n])
        expect(mocks.following).toHaveBeenCalledWith(expect.anything(), 2n, 6, [1n])
    })

    it('refuses a stale editor snapshot before invalidating a newer result', async () => {
        mocks.findUnique.mockResolvedValue({ ...current, operationVersion: 5 })
        expect((await request({ actionDesc: '新动作' })).status).toBe(409)
        expect(mocks.reset).not.toHaveBeenCalled()
        expect(mocks.following).not.toHaveBeenCalled()
    })
})
