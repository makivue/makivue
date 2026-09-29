import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseProviderQuota, renewProviderQuota, tryAcquireProviderQuota } from './provider-quota-store'

vi.mock('./provider-quota-store', () => ({
    tryAcquireProviderQuota: vi.fn(),
    renewProviderQuota: vi.fn(),
    releaseProviderQuota: vi.fn()
}))

const acquire = vi.mocked(tryAcquireProviderQuota)
const renew = vi.mocked(renewProviderQuota)
const release = vi.mocked(releaseProviderQuota)

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('DATABASE_URL', 'mysql://database')
    vi.stubEnv('FFMPEG_CLUSTER_LIMIT_ENABLED', '1')
    vi.stubEnv('FFMPEG_CLUSTER_CONCURRENCY', '3')
    acquire.mockResolvedValue({ ids: [7n], retryAfterMs: 0 })
    renew.mockResolvedValue(true)
    release.mockResolvedValue(undefined)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('cluster-wide FFmpeg admission', () => {
    it('holds a database lease around the workload', async () => {
        const { withFfmpegClusterSlot } = await import('./ffmpeg-workload-limit')
        const work = vi.fn().mockResolvedValue('done')

        await expect(withFfmpegClusterSlot(work)).resolves.toBe('done')
        expect(acquire).toHaveBeenCalledWith([expect.objectContaining({ concurrency: 3, requestsPerMinute: 60_000, tokens: 0 })])
        expect(work).toHaveBeenCalledOnce()
        expect(release).toHaveBeenCalledWith([7n])
    })

    it('renews long-running work and releases after failure', async () => {
        const { withFfmpegClusterSlot } = await import('./ffmpeg-workload-limit')
        let rejectWork!: (error: Error) => void
        const pending = withFfmpegClusterSlot(
            () =>
                new Promise((_resolve, reject) => {
                    rejectWork = reject
                })
        )
        await vi.advanceTimersByTimeAsync(15_000)
        expect(renew).toHaveBeenCalledWith([7n])
        rejectWork(new Error('encode failed'))
        await expect(pending).rejects.toThrow('encode failed')
        expect(release).toHaveBeenCalledWith([7n])
    })

    it('keeps work queued until a cluster slot becomes available', async () => {
        const { withFfmpegClusterSlot } = await import('./ffmpeg-workload-limit')
        acquire.mockResolvedValueOnce({ ids: [], retryAfterMs: 2_000 })
        const work = vi.fn().mockResolvedValue('done')

        const pending = withFfmpegClusterSlot(work)
        await vi.advanceTimersByTimeAsync(1_999)
        expect(work).not.toHaveBeenCalled()
        expect(release).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(251)
        await expect(pending).resolves.toBe('done')
        expect(work).toHaveBeenCalledOnce()
        expect(release).toHaveBeenCalledWith([7n])
    })

    it('does not start work or release another lease after admission times out', async () => {
        const { withFfmpegClusterSlot } = await import('./ffmpeg-workload-limit')
        vi.stubEnv('FFMPEG_CLUSTER_WAIT_MS', '1000')
        acquire.mockResolvedValue({ ids: [], retryAfterMs: 2_000 })
        const work = vi.fn()

        const pending = expect(withFfmpegClusterSlot(work)).rejects.toThrow('等待集群 FFmpeg 槽位超时')
        await vi.advanceTimersByTimeAsync(2_250)
        await pending
        expect(work).not.toHaveBeenCalled()
        expect(release).not.toHaveBeenCalled()
    })
})
