import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
    const transactionClient = {
        $queryRaw: vi.fn(),
        projectAiJob: {
            updateMany: vi.fn(),
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
vi.mock('@/lib/id', () => ({ genId: () => 9001n }))

import {
    CREATOR_GENERATION_LIMITS,
    createCreatorGenerationJob
} from './creator-generation-concurrency'

describe('AI Creator generation concurrency', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        database.prisma.$transaction.mockImplementation(async callback => callback(database.transactionClient))
        database.transactionClient.$queryRaw.mockResolvedValue([{ acquired: 1 }])
        database.transactionClient.projectAiJob.updateMany.mockResolvedValue({ count: 0 })
        database.transactionClient.projectAiJob.create.mockResolvedValue({ id: 9001n })
    })

    it('has creator-only image and video limits', () => {
        expect(CREATOR_GENERATION_LIMITS).toEqual({ image: 30, video: 20 })
    })

    it('reserves a video slot using creator jobs rather than film generations', async () => {
        database.transactionClient.projectAiJob.count.mockResolvedValue(19)

        const result = await createCreatorGenerationJob(42n, 'video')

        expect(result).toEqual({ id: '9001', active: 20, limit: 20 })
        expect(database.transactionClient.projectAiJob.count).toHaveBeenCalledWith({
            where: {
                projectId: 42n,
                kind: 'creator_video',
                phase: { in: ['generating', 'writing_db'] }
            }
        })
        expect(database.transactionClient.projectAiJob.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                id: 9001n,
                projectId: 42n,
                kind: 'creator_video',
                phase: 'generating',
                activeKey: 'creator-generation:42:video:9001'
            })
        })
    })

    it('rejects only when the matching creator pool is full', async () => {
        database.transactionClient.projectAiJob.count.mockResolvedValue(20)

        await expect(createCreatorGenerationJob(42n, 'video')).rejects.toMatchObject({
            category: 'video',
            limit: 20,
            reason: 'full'
        })
        expect(database.transactionClient.projectAiJob.create).not.toHaveBeenCalled()
    })
})
