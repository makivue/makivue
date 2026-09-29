import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getJob: vi.fn(), updateJob: vi.fn(), getJobs: vi.fn(), heartbeat: vi.fn(), updateRef: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/projectAiJobStore', () => ({ getJob: mocks.getJob, updateJob: mocks.updateJob }))
vi.mock('@/lib/refImageJobStore', () => ({ getJobs: mocks.getJobs, heartbeatQueuedJobs: mocks.heartbeat, updateJob: mocks.updateRef }))
vi.mock('@/services/scene-reference-job', () => ({ runQueuedSceneReferenceJob: mocks.run }))
import { runSceneReferenceBatchJob } from './scene-reference-batch'
const tasks = Array.from({ length: 20 }, (_, i) => ({
    jobId: String(i + 1),
    sceneId: BigInt(i + 1),
    projectId: 100n,
    userId: 200n,
    imageProvider: 'banana' as const,
    imageQuality: 'standard' as const,
    requestId: `request-${i}`,
    sourceOperationVersion: 1
}))
const payload = { items: tasks.map(t => ({ jobId: t.jobId, sceneId: String(t.sceneId) })), concurrency: 8, quality: 'standard' as const, mode: 'all' as const }

beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    mocks.getJob.mockResolvedValue({ phase: 'generating' })
    mocks.getJobs.mockResolvedValue(tasks.map(t => ({ id: t.jobId, phase: 'done' })))
})
afterEach(() => vi.useRealTimers())

describe('scene batch server workers', () => {
    it('runs at most eight children concurrently while maintaining queued heartbeats', async () => {
        let active = 0
        let peak = 0
        mocks.run.mockImplementation(async () => {
            peak = Math.max(peak, ++active)
            await new Promise(resolve => setTimeout(resolve, 40_000))
            active -= 1
        })
        const running = runSceneReferenceBatchJob('900', payload, tasks)
        await vi.advanceTimersByTimeAsync(125_000)
        await running
        expect(peak).toBe(8)
        expect(mocks.run).toHaveBeenCalledTimes(20)
        expect(mocks.heartbeat.mock.calls.length).toBeGreaterThan(1)
        expect(mocks.updateJob).toHaveBeenLastCalledWith('900', { phase: 'done', progress: 20, result: payload })
        expect(vi.getTimerCount()).toBe(0)
    })

    it('does not start queued children after the parent has stopped', async () => {
        mocks.getJob.mockResolvedValue({ phase: 'cancelled' })
        await runSceneReferenceBatchJob('900', payload, tasks)
        expect(mocks.run).not.toHaveBeenCalled()
        expect(mocks.updateRef).toHaveBeenCalledTimes(20)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('finishes missing children as failures instead of keeping the parent active', async () => {
        mocks.getJobs.mockResolvedValue([])
        await runSceneReferenceBatchJob('900', payload, [])
        expect(mocks.updateJob).toHaveBeenLastCalledWith('900', { phase: 'done', progress: 20, result: payload })
        expect(vi.getTimerCount()).toBe(0)
    })
})
