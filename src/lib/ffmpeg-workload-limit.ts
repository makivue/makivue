import { createHash } from 'node:crypto'
import { tryAcquireProviderQuota, renewProviderQuota, releaseProviderQuota } from '@/lib/provider-quota-store'
import { ffmpegClusterLimitEnabled, ffmpegRuntimeConfig } from '@/lib/media-worker-config'

export const FFMPEG_CLUSTER_SCOPE_KEY = createHash('sha256').update('local-drama-studio:workload:ffmpeg').digest('hex')

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
    })
}

/**
 * Uses the existing database-backed admission leases to cap CPU-heavy FFmpeg
 * work across every Pod. The one-minute lease is renewed while encoding and
 * naturally expires if a Pod is terminated.
 */
export async function withFfmpegClusterSlot<T>(work: () => Promise<T>): Promise<T> {
    if (!ffmpegClusterLimitEnabled()) return work()

    const config = ffmpegRuntimeConfig()
    const deadline = Date.now() + config.clusterWaitMs
    let ids: bigint[] = []
    while (Date.now() < deadline) {
        const admission = await tryAcquireProviderQuota([
            {
                key: FFMPEG_CLUSTER_SCOPE_KEY,
                concurrency: config.clusterConcurrency,
                requestsPerMinute: 60_000,
                tokens: 0
            }
        ])
        if (admission.ids.length > 0) {
            ids = admission.ids
            break
        }
        await sleep(Math.min(5_000, Math.max(250, admission.retryAfterMs)) + Math.floor(Math.random() * 250))
    }
    if (ids.length === 0) throw new Error(`等待集群 FFmpeg 槽位超时（${config.clusterWaitMs}ms）`)

    let renewing = false
    let leaseHealthy = true
    const heartbeat = setInterval(() => {
        if (renewing) return
        renewing = true
        void renewProviderQuota(ids)
            .then(renewed => {
                if (!renewed && leaseHealthy) {
                    leaseHealthy = false
                    console.error('[ffmpeg] cluster slot lease expired while work was still running')
                }
            })
            .catch(error => {
                if (leaseHealthy) {
                    leaseHealthy = false
                    console.error('[ffmpeg] cluster slot lease renewal failed', error)
                }
            })
            .finally(() => {
                renewing = false
            })
    }, 15_000)
    heartbeat.unref?.()

    try {
        return await work()
    } finally {
        clearInterval(heartbeat)
        await releaseProviderQuota(ids).catch(error => console.warn('[ffmpeg] cluster slot release failed; lease will expire', error))
    }
}
