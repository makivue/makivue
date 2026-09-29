import type { ImageProviderSwitch } from '@/lib/image-generation-recovery'

export type ReferenceGenerationStage = 'generating' | 'inspecting' | 'uploading' | 'writing_db'

export interface ReferenceGenerationTimings {
    generationMs: number
    inspectionMs: number
    uploadMs: number
    totalMs: number
    retryCount: number
}

export interface ReferenceGenerationProgress {
    stage: ReferenceGenerationStage
    attempt: number
    maxAttempts: number
    timings: ReferenceGenerationTimings
    providerSwitch?: ImageProviderSwitch
}

// This is a per-batch worker cap, not a service-wide cap. Provider-specific
// pools in services/ai.ts and the shared provider quota also constrain requests.
export const REFERENCE_BATCH_CONCURRENCY = 8
export const REF_IMAGE_HEARTBEAT_INTERVAL_MS = 30_000
export const REF_IMAGE_STALE_WINDOW_MS = 2 * 60_000
// Workers renew this lease every 30 seconds. Keep the server-side lease at the
// same two-minute recovery window used by the client, instead of comparing the
// DateTime heartbeat column directly (which is vulnerable to DB timezone
// interpretation differences).
// Leave enough of the 30-minute route lifetime for account-slot queueing. A
// provider request can still retry and run quality inspection, but one item
// must not keep an entire batch worker blocked forever.
export const REF_IMAGE_JOB_MAX_RUNTIME_MS = 8 * 60_000

export function referenceProgressAt(progress: ReferenceGenerationProgress | undefined, startedAt: number, now = Date.now()): ReferenceGenerationProgress | undefined {
    if (!progress) return undefined
    return {
        ...progress,
        timings: {
            ...progress.timings,
            totalMs: Math.max(progress.timings.totalMs, now - startedAt)
        }
    }
}

export function isRefImageJobRuntimeExceeded(startedAt: number, now = Date.now()) {
    return now - startedAt >= REF_IMAGE_JOB_MAX_RUNTIME_MS
}

export function isRefImageJobLeaseExpired(job: { leaseExpiresAt: Date | null; updatedAt: Date }, now = Date.now()): boolean {
    if (job.leaseExpiresAt) return job.leaseExpiresAt.getTime() < now
    return job.updatedAt.getTime() < now - REF_IMAGE_STALE_WINDOW_MS
}

export function isTransientReferenceJobError(message: string): boolean {
    return /timeout|超时|暂时|没有心跳|心跳中断|任务租约过期|自动回收|temporarily|temporary|429|502|503|504|network|upstream|fetch failed|failed to fetch|load failed|connection/i.test(message)
}
