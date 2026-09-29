export type PollingDelayOptions = {
    /** Normal foreground refresh cadence for a running task. */
    baseMs: number
    /** Consecutive transport failures. Each failure doubles the next delay. */
    failureCount?: number
    /** Cap retries so a transient outage does not make the UI appear stuck. */
    maxMs?: number
    /** Hidden tabs should not compete with active users for status QPS. */
    hidden?: boolean
    hiddenMinMs?: number
    /** Random spread used to prevent many clients polling on the same tick. */
    jitterRatio?: number
    /** Injectable for deterministic tests. Must return a value in [0, 1]. */
    random?: () => number
}

/**
 * Returns the delay before a client-side status refresh.
 *
 * Status endpoints are deliberately not cached: they report live job state.
 * This helper instead reduces demand at the source by backing off transient
 * failures and by slowing inactive browser tabs.
 */
export function getPollingDelay({
    baseMs,
    failureCount = 0,
    maxMs = 30_000,
    hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden',
    hiddenMinMs = 30_000,
    jitterRatio = 0,
    random = Math.random
}: PollingDelayOptions): number {
    const safeBase = Math.max(250, Math.round(baseMs))
    const safeMax = Math.max(safeBase, Math.round(maxMs))
    const failures = Math.max(0, Math.min(6, Math.floor(failureCount)))
    const backoff = Math.min(safeMax, safeBase * 2 ** failures)
    const jitter = Math.max(0, Math.min(0.5, jitterRatio))
    const randomValue = Math.max(0, Math.min(1, random()))
    const jittered = Math.max(250, Math.min(safeMax, Math.round(backoff * (1 + (randomValue * 2 - 1) * jitter))))
    return hidden ? Math.max(jittered, hiddenMinMs) : jittered
}

/** Adaptive server-worker cadence: stay responsive while busy, back off while idle. */
export function nextWorkerPollDelay(previousIdleMs: number, processedWork: boolean, activeMs = 5_000, maxIdleMs = 30_000) {
    if (processedWork) return activeMs
    return Math.min(maxIdleMs, Math.max(activeMs, previousIdleMs * 2))
}
