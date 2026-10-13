import { expiredTextJobLease } from './text-job-lease'

/** A submitted provider task survives the browser/process that submitted it. */
export function expiredProjectAiJob(job: { kind: string; result: unknown }, error?: string) {
    const result = job.result
    if (job.kind === 'creator_video' && result && typeof result === 'object' && 'taskId' in result && typeof result.taskId === 'string' && result.taskId.trim()) {
        // Release the abandoned creator slot while retaining the checkpoint.
        // A later status poll queries the same task; it never submits another.
        return { phase: 'awaiting_confirmation', activeKey: null, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null }
    }
    return { ...expiredTextJobLease(), ...(error ? { error } : {}) }
}
