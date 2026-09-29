import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
    const transactionClient = {
        $queryRaw: vi.fn(),
        project: { findMany: vi.fn() },
        generation: { findMany: vi.fn() },
        refImageJob: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
            updateMany: vi.fn()
        }
    }
    return {
        transactionClient,
        prisma: { $transaction: vi.fn() }
    }
})

vi.mock('@/lib/prisma', () => ({ prisma: database.prisma }))

import { tryClaimReferenceImageSlot } from './generation-concurrency'

describe('reference image concurrency', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        database.prisma.$transaction.mockImplementation(async callback => callback(database.transactionClient))
        database.transactionClient.$queryRaw.mockResolvedValue([{ acquired: 1 }])
        database.transactionClient.project.findMany.mockResolvedValue([{ id: 7n }])
        database.transactionClient.refImageJob.findUnique.mockResolvedValue({ phase: 'queued' })
        database.transactionClient.generation.findMany.mockResolvedValue([])
        database.transactionClient.refImageJob.findMany.mockResolvedValue([])
        database.transactionClient.refImageJob.updateMany.mockResolvedValue({ count: 1 })
    })

    it('claims the fifteenth reference image under the shared account lock', async () => {
        database.transactionClient.refImageJob.findMany.mockResolvedValue(Array.from({ length: 14 }, () => ({ projectId: 7n })))
        const result = await tryClaimReferenceImageSlot({ userId: 9n, projectId: 7n, jobId: 101n })

        expect(result).toBe('claimed')
        expect(database.transactionClient.refImageJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 101n, phase: 'queued' },
                data: expect.objectContaining({ phase: 'generating' })
            })
        )
        expect(database.transactionClient.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('waits when reference images already use all 15 account slots', async () => {
        database.transactionClient.refImageJob.findMany.mockResolvedValue(Array.from({ length: 15 }, () => ({ projectId: 7n })))

        const result = await tryClaimReferenceImageSlot({ userId: 9n, projectId: 7n, jobId: 101n })

        expect(result).toBe('waiting')
        expect(database.transactionClient.refImageJob.updateMany).not.toHaveBeenCalled()
    })
})
