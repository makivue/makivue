import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    detectChunk: vi.fn(),
    mergeChunks: vi.fn(),
    persistImport: vi.fn(),
    genId: vi.fn(() => 9001n)
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        projectAiJob: {
            findFirst: mocks.findFirst,
            updateMany: mocks.updateMany
        }
    }
}))

vi.mock('@/lib/id', () => ({ genId: mocks.genId }))

vi.mock('@/services/script-import', () => ({
    splitImportText: (text: string) => text.split('|'),
    detectAndParseScriptChunk: mocks.detectChunk,
    mergeDetectedScriptChunks: mocks.mergeChunks
}))

vi.mock('@/services/project-import', () => ({
    persistDetectedImport: mocks.persistImport,
    recommendImportVisualStyle: () => 'cinematic'
}))

import {
    PROJECT_IMPORT_HEARTBEAT_MS,
    claimProjectImportJob,
    executeClaimedProjectImportJob,
    kickProjectImportWorker,
    publicProjectImportStatus,
    startProjectImportWorker,
    type ClaimedProjectImportJob
} from './project-import-worker'

const firstChunk = { stage: 'script' as const, episodes: [{ episodeNumber: 1, script: 'chunk one' }] }
const secondChunk = { stage: 'script' as const, episodes: [{ episodeNumber: 2, script: 'chunk two' }] }
const merged = { stage: 'script' as const, totalEpisodes: 2, episodes: [...firstChunk.episodes, ...secondChunk.episodes] }

function claimed(result: unknown, attempts = 1): ClaimedProjectImportJob {
    return {
        id: '101',
        projectId: '7',
        phase: 'generating',
        attempts,
        leaseOwner: 'worker-one',
        result
    }
}

function projectImportPayload(rawText: string) {
    return { version: 1 as const, input: { rawText }, completedChunks: [] }
}

describe('durable project import worker', () => {
    beforeEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
        mocks.updateMany.mockResolvedValue({ count: 1 })
        mocks.detectChunk.mockResolvedValue(secondChunk)
        mocks.mergeChunks.mockReturnValue(merged)
        mocks.persistImport.mockResolvedValue({ projectId: '9001', stage: 'script' })
    })

    it('does not poll or claim imports when startup and API wakeups are disabled', async () => {
        vi.useFakeTimers()
        vi.stubEnv('DATABASE_URL', 'mysql://database')
        vi.stubEnv('ENABLE_PROJECT_IMPORT_WORKER', '0')
        try {
            startProjectImportWorker()
            kickProjectImportWorker()
            await vi.advanceTimersByTimeAsync(60_000)

            expect(mocks.findFirst).not.toHaveBeenCalled()
            expect(mocks.updateMany).not.toHaveBeenCalled()
            expect(mocks.detectChunk).not.toHaveBeenCalled()
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.unstubAllEnvs()
            vi.useRealTimers()
        }
    })

    it('resumes after the last persisted chunk instead of paying to analyze it twice', async () => {
        const payload = {
            ...projectImportPayload('aaaaaaaaaa|bbbbbbbbbb'),
            completedChunks: [{ index: 0, detected: firstChunk }]
        }

        await executeClaimedProjectImportJob(claimed(payload, 2))

        expect(mocks.detectChunk).toHaveBeenCalledTimes(1)
        expect(mocks.detectChunk).toHaveBeenCalledWith('bbbbbbbbbb', 1, 2)
        expect(mocks.mergeChunks).toHaveBeenCalledWith([firstChunk, secondChunk], 'aaaaaaaaaa|bbbbbbbbbb')

        const writes = mocks.updateMany.mock.calls.map(([call]) => call)
        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        progress: 2,
                        result: expect.objectContaining({
                            input: { rawText: 'aaaaaaaaaa|bbbbbbbbbb' },
                            completedChunks: [
                                { index: 0, detected: firstChunk },
                                { index: 1, detected: secondChunk }
                            ]
                        })
                    })
                }),
                expect.objectContaining({
                    data: expect.objectContaining({
                        phase: 'awaiting_confirmation',
                        result: expect.not.objectContaining({ input: expect.anything() })
                    })
                })
            ])
        )
    })

    it('does not execute when another worker wins the atomic claim', async () => {
        mocks.findFirst.mockResolvedValue({
            id: 101n,
            projectId: 7n,
            phase: 'queued',
            attempts: 0,
            result: projectImportPayload('A sufficiently long script import source for the claim test.')
        })
        mocks.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 })

        await expect(claimProjectImportJob('101')).resolves.toBeNull()
        expect(mocks.updateMany).toHaveBeenCalledTimes(2)
        expect(mocks.updateMany.mock.calls[1][0]).toEqual(
            expect.objectContaining({
                where: expect.objectContaining({ id: 101n, phase: 'queued', attempts: 0 }),
                data: expect.objectContaining({ attempts: { increment: 1 } })
            })
        )
    })

    it('renews the lease while a model request is still running', async () => {
        vi.useFakeTimers()
        let resolveDetection!: (value: typeof secondChunk) => void
        mocks.detectChunk.mockReturnValue(
            new Promise(resolve => {
                resolveDetection = resolve
            })
        )

        const running = executeClaimedProjectImportJob(claimed(projectImportPayload('A sufficiently long single-chunk script for heartbeat testing.')))
        await vi.advanceTimersByTimeAsync(PROJECT_IMPORT_HEARTBEAT_MS)

        const heartbeatWrites = mocks.updateMany.mock.calls.filter(([call]) => call.where?.leaseOwner === 'worker-one' && call.data?.leaseExpiresAt instanceof Date)
        expect(heartbeatWrites.length).toBeGreaterThanOrEqual(2)

        resolveDetection(secondChunk)
        await running
        vi.useRealTimers()
    })

    it('never exposes the persisted raw script through the status response', () => {
        const secret = 'This complete raw screenplay must never be returned by the status API.'
        const baseJob = {
            id: '101',
            projectId: '7',
            kind: 'project_import' as const,
            phase: 'generating' as const,
            attempts: 1,
            progress: 0,
            total: 1,
            result: projectImportPayload(secret),
            createdAt: 1,
            updatedAt: 1
        }

        const response = publicProjectImportStatus(baseJob)
        expect(response.result).toBeUndefined()
        expect(JSON.stringify(response)).not.toContain(secret)
    })

    it('reuses the persisted project ID when a commit is resumed', async () => {
        const commitJob: ClaimedProjectImportJob = {
            ...claimed({
                version: 1,
                detected: merged,
                commit: { projectId: '9001', visualStyle: 'cinematic', videoAspectRatio: '9:16' }
            }),
            phase: 'writing_db'
        }

        await executeClaimedProjectImportJob(commitJob)

        expect(mocks.persistImport).toHaveBeenCalledWith(expect.objectContaining({ userId: 7n, projectId: 9001n, detected: merged }))
        expect(mocks.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ phase: 'writing_db', leaseOwner: 'worker-one' }),
                data: expect.objectContaining({ phase: 'done', activeKey: null })
            })
        )
    })

    it('keeps pre-upgrade completed analyses confirmable without exposing source input', () => {
        const legacy = publicProjectImportStatus({
            id: '101',
            projectId: '7',
            kind: 'project_import',
            phase: 'awaiting_confirmation',
            attempts: 0,
            progress: 1,
            total: 1,
            result: { detected: merged, preview: { stage: 'script', totalEpisodes: 2, totalStoryboards: 0, recommendedVisualStyle: 'cinematic' } },
            createdAt: 1,
            updatedAt: 1
        })

        expect(legacy.result).toMatchObject({ stage: 'script', totalEpisodes: 2 })
    })
})
