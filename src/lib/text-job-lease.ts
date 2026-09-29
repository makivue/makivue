const TEXT_JOB_LEASE_MS = 15 * 60 * 1000
export const TEXT_JOB_EXPIRED_ERROR = '任务租约过期，已自动回收，请重试'

/** Keep long, multi-pass model calls leased without overlapping DB heartbeats. */
export function startTextJobHeartbeat(heartbeat: () => Promise<void>): () => void {
    let pending = false
    const timer = setInterval(async () => {
        if (pending) return
        pending = true
        try {
            await heartbeat()
        } catch (error) {
            console.warn('[text-job] heartbeat failed:', error)
        } finally {
            pending = false
        }
    }, 60_000)
    timer.unref?.()
    return () => clearInterval(timer)
}

export function newTextJobLease(prefix: string) {
    const now = new Date()
    return {
        leaseOwner: `${prefix}:${process.pid}:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + TEXT_JOB_LEASE_MS)
    }
}

export function heartbeatTextJobLease(terminal = false) {
    const now = new Date()
    return terminal ? { activeKey: null, leaseOwner: null, heartbeatAt: now, leaseExpiresAt: null } : { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + TEXT_JOB_LEASE_MS) }
}

export function isUniqueConstraintError(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export function isTextJobLeaseExpired(job: { phase: string | null; leaseExpiresAt: Date | null }, activePhases: readonly string[], now = Date.now()) {
    return activePhases.includes(job.phase ?? '') && !!job.leaseExpiresAt && job.leaseExpiresAt.getTime() < now
}

export function expiredTextJobLease() {
    return { phase: 'error', error: TEXT_JOB_EXPIRED_ERROR, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
}
