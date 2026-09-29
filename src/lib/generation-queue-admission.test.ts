import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
    const transactionClient = {
        $queryRaw: vi.fn(),
        generation: {
            count: vi.fn(),
            create: vi.fn()
        }
    }
    return {
        transactionClient,
        prisma: {
            $transaction: vi.fn()
        }
    }
})

vi.mock('@/lib/prisma', () => ({ prisma: database.prisma }))

import { tryCreateQueuedGeneration, waitForGenerationQueueAdmission } from './generation-concurrency'

const generationData = {
    id: 101n,
    storyboardId: 202n,
    type: 'video',
    provider: 'wan3prime',
    prompt: 'test prompt'
}

describe('generation queue admission', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        database.prisma.$transaction.mockImplementation(async callback => callback(database.transactionClient))
        database.transactionClient.$queryRaw.mockResolvedValue([{ acquired: 1 }])
        database.transactionClient.generation.create.mockResolvedValue({ ...generationData, status: 'queued' })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('checks and creates under one account/category lock', async () => {
        database.transactionClient.generation.count.mockResolvedValue(9)

        const result = await tryCreateQueuedGeneration({ userId: 9n, category: 'video', data: generationData })

        expect(result).toMatchObject({ admitted: true, queued: 9, limit: 10 })
        expect(database.transactionClient.generation.create).toHaveBeenCalledWith({
            data: { ...generationData, status: 'queued' }
        })
        expect(database.transactionClient.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('does not create beyond the configured queue limit', async () => {
        database.transactionClient.generation.count.mockResolvedValue(10)

        const result = await tryCreateQueuedGeneration({ userId: 9n, category: 'video', data: generationData })

        expect(result).toEqual({ admitted: false, reason: 'queue_full', queued: 10, limit: 10 })
        expect(database.transactionClient.generation.create).not.toHaveBeenCalled()
    })

    it('polls a full queue and creates automatically when a position opens', async () => {
        vi.useFakeTimers()
        database.transactionClient.generation.count.mockResolvedValueOnce(10).mockResolvedValueOnce(9)
        const onWaiting = vi.fn()

        const pending = waitForGenerationQueueAdmission({ userId: 9n, category: 'video', data: generationData }, undefined, onWaiting)
        await vi.advanceTimersByTimeAsync(2_000)
        const generation = await pending

        expect(onWaiting).toHaveBeenCalledWith({ category: 'video', reason: 'queue_full', queued: 10, limit: 10 })
        expect(database.transactionClient.generation.count).toHaveBeenCalledTimes(2)
        expect(generation).toMatchObject({ id: 101n, status: 'queued' })
    })
})
