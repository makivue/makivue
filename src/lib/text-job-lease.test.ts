import { describe, expect, it, vi } from 'vitest'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, startTextJobHeartbeat, TEXT_JOB_EXPIRED_ERROR } from './text-job-lease'

describe('text job leases', () => {
    it('detects only expired active jobs', () => {
        const expired = { phase: 'generating', leaseExpiresAt: new Date(1000) }
        expect(isTextJobLeaseExpired(expired, ['generating'], 1001)).toBe(true)
        expect(isTextJobLeaseExpired({ ...expired, phase: 'done' }, ['generating'], 1001)).toBe(false)
    })

    it('clears active identity on terminal and expired updates', () => {
        expect(heartbeatTextJobLease(true)).toMatchObject({ activeKey: null, leaseOwner: null, leaseExpiresAt: null })
        expect(expiredTextJobLease()).toEqual({ phase: 'error', error: TEXT_JOB_EXPIRED_ERROR, activeKey: null, leaseOwner: null, leaseExpiresAt: null })
    })

    it('renews long running work without overlapping calls and stops after cleanup', async () => {
        vi.useFakeTimers()
        let resolveHeartbeat: () => void = () => {}
        const heartbeat = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveHeartbeat = resolve
                })
        )
        const stop = startTextJobHeartbeat(heartbeat)
        try {
            await vi.advanceTimersByTimeAsync(180_000)
            expect(heartbeat).toHaveBeenCalledTimes(1)
            resolveHeartbeat()
            await vi.advanceTimersByTimeAsync(60_000)
            expect(heartbeat).toHaveBeenCalledTimes(2)
            stop()
            resolveHeartbeat()
            await vi.advanceTimersByTimeAsync(120_000)
            expect(heartbeat).toHaveBeenCalledTimes(2)
        } finally {
            stop()
            vi.useRealTimers()
        }
    })
})
