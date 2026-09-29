import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { projectAiJob: mocks } }))
vi.mock('@/lib/id', () => ({ genId: vi.fn() }))

import { getLatestJob } from './projectAiJobStore'

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: 900n,
        projectId: 456n,
        kind: 'character_references',
        phase: 'generating',
        createdAt: new Date(),
        updatedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        ...overrides
    }
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.findUnique.mockResolvedValue(row())
})

describe('latest project job recovery', () => {
    it('prioritizes unfinished work over recent completed batches', async () => {
        mocks.findFirst.mockResolvedValue({ id: 900n })
        expect(await getLatestJob('456', 'character_references')).toMatchObject({ id: '900', phase: 'generating' })
        expect(mocks.findFirst).toHaveBeenCalledTimes(1)
        expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ projectId: 456n, kind: 'character_references', phase: { in: ['queued', 'generating', 'writing_db'] } })
    })

    it('bounds completed recovery to the last day and selects by batch creation order', async () => {
        mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 900n })
        mocks.findUnique.mockResolvedValue(row({ phase: 'done', leaseExpiresAt: null }))
        const before = Date.now()
        expect(await getLatestJob('456', 'character_references')).toMatchObject({ phase: 'done' })
        const query = mocks.findFirst.mock.calls[1][0]
        expect(query.where.projectId).toBe(456n)
        expect(query.where.kind).toBe('character_references')
        expect(query.where.updatedAt.gte.getTime()).toBeGreaterThanOrEqual(before - 24 * 60 * 60_000)
        expect(query.orderBy).toEqual({ createdAt: 'desc' })
    })

    it('reconciles expired leases before restoring progress', async () => {
        mocks.findFirst.mockResolvedValue({ id: 900n })
        mocks.findUnique.mockResolvedValueOnce(row({ leaseExpiresAt: new Date(0) })).mockResolvedValueOnce(row({ phase: 'error', error: '任务租约过期' }))
        expect(await getLatestJob('456', 'character_references')).toMatchObject({ phase: 'error', error: '任务租约过期' })
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'error', activeKey: null }) }))
    })

    it('returns no job for an empty history or invalid project ID', async () => {
        expect(await getLatestJob('invalid', 'character_references')).toBeUndefined()
        expect(mocks.findFirst).not.toHaveBeenCalled()
        mocks.findFirst.mockResolvedValue(null)
        expect(await getLatestJob('456', 'character_references')).toBeUndefined()
        expect(mocks.findUnique).not.toHaveBeenCalled()
    })
})
