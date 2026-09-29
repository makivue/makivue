import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
import { storyboardEndingStateKey, syncEpisodeCharacterStateEvents } from './character-state'

describe('character state timeline', () => {
    beforeEach(() => vi.resetAllMocks())
    it('builds a stable state key that fits the database contract', () => {
        const key = storyboardEndingStateKey(9223372036854775807n)
        expect(key).toBe('storyboard:9223372036854775807:ending')
        expect(key.length).toBeLessThanOrEqual(100)
    })

    it('reads and writes planned states under the reset lock', async () => {
        let locked = false
        const tx = {
            $queryRaw: vi.fn().mockImplementation(async () => {
                locked = true
            }),
            storyboard: {
                findMany: vi.fn().mockImplementation(async () => {
                    expect(locked).toBe(true)
                    return [{ id: 3n, order: 1, sourceVersion: 2, actionDesc: '人物坐在窗边', episode: { projectId: 1n, episodeNumber: 1 }, characters: [{ character: { id: 5n, name: '小明' } }] }]
                })
            },
            characterStateEvent: { upsert: vi.fn(), updateMany: vi.fn() }
        }
        mocks.transaction.mockImplementation(callback => callback(tx))
        await syncEpisodeCharacterStateEvents(2n)
        expect(tx.characterStateEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ storyboardId: 3n, status: 'active' }) }))
    })

    it('does not reactivate states when a reset removed the graph before sync obtained its lock', async () => {
        const tx = { $queryRaw: vi.fn(), storyboard: { findMany: vi.fn().mockResolvedValue([]) }, characterStateEvent: { upsert: vi.fn(), updateMany: vi.fn() } }
        mocks.transaction.mockImplementation(callback => callback(tx))
        await syncEpisodeCharacterStateEvents(2n)
        expect(tx.storyboard.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { episodeId: 2n, deletedAt: null } }))
        expect(tx.characterStateEvent.upsert).not.toHaveBeenCalled()
    })
})
