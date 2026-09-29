import { prisma } from '@/lib/prisma'
import { FFMPEG_CLUSTER_SCOPE_KEY } from '@/lib/ffmpeg-workload-limit'
import { durableMediaWorkerEnabled, ffmpegRuntimeConfig } from '@/lib/media-worker-config'

export type FfmpegOperation = 'compose' | 'episode_merge' | 'concat'

type OperationMetrics = {
    active: number
    completed: number
    failed: number
    durationSeconds: number
}

type MetricsState = Record<FfmpegOperation, OperationMetrics>

const globalMetrics = globalThis as typeof globalThis & { __ffmpegMetrics?: MetricsState }
const state =
    globalMetrics.__ffmpegMetrics ??
    (globalMetrics.__ffmpegMetrics = {
        compose: { active: 0, completed: 0, failed: 0, durationSeconds: 0 },
        episode_merge: { active: 0, completed: 0, failed: 0, durationSeconds: 0 },
        concat: { active: 0, completed: 0, failed: 0, durationSeconds: 0 }
    })

export async function observeFfmpegOperation<T>(operation: FfmpegOperation, work: () => Promise<T>, succeeded: (result: T) => boolean = () => true): Promise<T> {
    const metric = state[operation]
    const startedAt = performance.now()
    metric.active += 1
    try {
        const result = await work()
        if (succeeded(result)) metric.completed += 1
        else metric.failed += 1
        return result
    } catch (error) {
        metric.failed += 1
        throw error
    } finally {
        metric.active = Math.max(0, metric.active - 1)
        metric.durationSeconds += Math.max(0, performance.now() - startedAt) / 1000
    }
}

type QueueMetric = {
    kind: 'compose' | 'merge'
    ready: number
    active: number
    delayed: number
    oldestReadyAgeSeconds: number
}

function ageSeconds(value: Date | null | undefined, now: Date): number {
    return value ? Math.max(0, (now.getTime() - value.getTime()) / 1000) : 0
}

async function collectQueueMetrics(): Promise<{ queues: QueueMetric[]; clusterActive: number }> {
    const now = new Date()
    const readyLease = { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }
    const readyAttempt = { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }
    const delayedAttempt = { nextAttemptAt: { gt: now } }
    const [composeReady, composeActive, composeDelayed, composeOldest, mergeReady, mergeActive, mergeDelayed, mergeOldest, clusterActive] = await Promise.all([
        prisma.generation.count({ where: { type: 'compose', status: 'processing', AND: [readyLease, readyAttempt] } }),
        prisma.generation.count({ where: { type: 'compose', status: 'processing', leaseExpiresAt: { gt: now } } }),
        prisma.generation.count({ where: { type: 'compose', status: 'processing', AND: [readyLease, delayedAttempt] } }),
        prisma.generation.findFirst({ where: { type: 'compose', status: 'processing', AND: [readyLease, readyAttempt] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        prisma.videoMerge.count({ where: { status: 'processing', AND: [readyLease, readyAttempt] } }),
        prisma.videoMerge.count({ where: { status: 'processing', leaseExpiresAt: { gt: now } } }),
        prisma.videoMerge.count({ where: { status: 'processing', AND: [readyLease, delayedAttempt] } }),
        prisma.videoMerge.findFirst({ where: { status: 'processing', AND: [readyLease, readyAttempt] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        prisma.providerQuotaLease.count({ where: { scopeKey: FFMPEG_CLUSTER_SCOPE_KEY, expiresAtMs: { gt: BigInt(now.getTime()) } } })
    ])

    return {
        queues: [
            { kind: 'compose', ready: composeReady, active: composeActive, delayed: composeDelayed, oldestReadyAgeSeconds: ageSeconds(composeOldest?.createdAt, now) },
            { kind: 'merge', ready: mergeReady, active: mergeActive, delayed: mergeDelayed, oldestReadyAgeSeconds: ageSeconds(mergeOldest?.createdAt, now) }
        ],
        clusterActive
    }
}

export async function renderMediaWorkerPrometheusMetrics(): Promise<string> {
    const { queues, clusterActive } = await collectQueueMetrics()
    const config = ffmpegRuntimeConfig()
    const lines = [
        '# HELP media_worker_enabled Whether this process is allowed to run the durable media worker.',
        '# TYPE media_worker_enabled gauge',
        `media_worker_enabled ${durableMediaWorkerEnabled() ? 1 : 0}`,
        '# HELP media_worker_queue_jobs Durable media jobs by kind and queue state.',
        '# TYPE media_worker_queue_jobs gauge'
    ]
    for (const queue of queues) {
        lines.push(`media_worker_queue_jobs{kind="${queue.kind}",state="ready"} ${queue.ready}`)
        lines.push(`media_worker_queue_jobs{kind="${queue.kind}",state="active"} ${queue.active}`)
        lines.push(`media_worker_queue_jobs{kind="${queue.kind}",state="delayed"} ${queue.delayed}`)
    }
    lines.push('# HELP media_worker_oldest_ready_job_age_seconds Age of the oldest runnable media job.')
    lines.push('# TYPE media_worker_oldest_ready_job_age_seconds gauge')
    for (const queue of queues) lines.push(`media_worker_oldest_ready_job_age_seconds{kind="${queue.kind}"} ${queue.oldestReadyAgeSeconds.toFixed(3)}`)
    lines.push('# HELP ffmpeg_cluster_slots_active Active database-backed FFmpeg leases.')
    lines.push('# TYPE ffmpeg_cluster_slots_active gauge')
    lines.push(`ffmpeg_cluster_slots_active ${clusterActive}`)
    lines.push('# HELP ffmpeg_cluster_slots_limit Configured cluster-wide FFmpeg concurrency.')
    lines.push('# TYPE ffmpeg_cluster_slots_limit gauge')
    lines.push(`ffmpeg_cluster_slots_limit ${config.clusterConcurrency}`)
    lines.push('# HELP ffmpeg_jobs_active FFmpeg jobs currently running in this process.')
    lines.push('# TYPE ffmpeg_jobs_active gauge')
    for (const [operation, metric] of Object.entries(state)) lines.push(`ffmpeg_jobs_active{operation="${operation}"} ${metric.active}`)
    lines.push('# HELP ffmpeg_jobs_total Completed FFmpeg jobs in this process.')
    lines.push('# TYPE ffmpeg_jobs_total counter')
    for (const [operation, metric] of Object.entries(state)) {
        lines.push(`ffmpeg_jobs_total{operation="${operation}",status="success"} ${metric.completed}`)
        lines.push(`ffmpeg_jobs_total{operation="${operation}",status="failed"} ${metric.failed}`)
    }
    lines.push('# HELP ffmpeg_job_duration_seconds Total duration and count of finished FFmpeg jobs.')
    lines.push('# TYPE ffmpeg_job_duration_seconds summary')
    for (const [operation, metric] of Object.entries(state)) {
        lines.push(`ffmpeg_job_duration_seconds_sum{operation="${operation}"} ${metric.durationSeconds.toFixed(6)}`)
        lines.push(`ffmpeg_job_duration_seconds_count{operation="${operation}"} ${metric.completed + metric.failed}`)
    }
    return `${lines.join('\n')}\n`
}
