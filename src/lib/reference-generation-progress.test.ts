import { describe, expect, it } from 'vitest'
import {
    isRefImageJobLeaseExpired,
    isRefImageJobRuntimeExceeded,
    isTransientReferenceJobError,
    referenceProgressAt,
    REFERENCE_BATCH_CONCURRENCY,
    REF_IMAGE_STALE_WINDOW_MS,
    REF_IMAGE_JOB_MAX_RUNTIME_MS
} from './reference-generation-progress'

describe('reference image job recovery', () => {
    it('allows eight workers per batch without becoming a service-wide cap', () => {
        expect(REFERENCE_BATCH_CONCURRENCY).toBe(8)
    })

    it('honors an active lease even when updatedAt is older than the former five-minute cutoff', () => {
        const now = Date.now()
        expect(
            isRefImageJobLeaseExpired(
                {
                    updatedAt: new Date(now - 10 * 60_000),
                    leaseExpiresAt: new Date(now + 60_000)
                },
                now
            )
        ).toBe(false)
    })

    it('expires an ended lease and falls back safely for legacy rows without a lease', () => {
        const now = Date.now()
        expect(isRefImageJobLeaseExpired({ updatedAt: new Date(now), leaseExpiresAt: new Date(now - 1) }, now)).toBe(true)
        expect(isRefImageJobLeaseExpired({ updatedAt: new Date(now - REF_IMAGE_STALE_WINDOW_MS - 1), leaseExpiresAt: null }, now)).toBe(true)
    })

    it('does not compare the raw heartbeat timestamp when an active lease is present', () => {
        const now = Date.now()
        expect(
            isRefImageJobLeaseExpired(
                {
                    updatedAt: new Date(now - 10 * 60_000),
                    leaseExpiresAt: new Date(now + 60_000)
                },
                now
            )
        ).toBe(false)
    })

    it('retries heartbeat and lease recovery errors but not quality-gate rejections', () => {
        expect(isTransientReferenceJobError('图片任务超过 5 分钟没有心跳，已自动回收，请重试')).toBe(true)
        expect(isTransientReferenceJobError('任务租约过期，已自动回收，请重试')).toBe(true)
        expect(isTransientReferenceJobError('服务暂时不可用，请稍后重试')).toBe(true)
        expect(isTransientReferenceJobError('character quality gate rejected all candidates')).toBe(false)
    })

    it('keeps elapsed progress moving and caps a single job at the runtime deadline', () => {
        const startedAt = 10_000
        const progress = referenceProgressAt(
            {
                stage: 'generating',
                attempt: 1,
                maxAttempts: 3,
                timings: { generationMs: 0, inspectionMs: 0, uploadMs: 0, totalMs: 25, retryCount: 0 }
            },
            startedAt,
            startedAt + 30_000
        )
        expect(progress?.timings.totalMs).toBe(30_000)
        expect(isRefImageJobRuntimeExceeded(startedAt, startedAt + REF_IMAGE_JOB_MAX_RUNTIME_MS - 1)).toBe(false)
        expect(isRefImageJobRuntimeExceeded(startedAt, startedAt + REF_IMAGE_JOB_MAX_RUNTIME_MS)).toBe(true)
    })
})
