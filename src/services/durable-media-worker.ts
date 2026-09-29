import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { composeShot, mergeEpisodeVideos } from '@/services/ffmpeg'
import { usesEmbeddedVideoAudio } from '@/lib/video-audio-policy'
import { chargeWalletUsage, quoteGenerationPoints } from '@/services/billing'
import { reconcileGenerationTelemetry } from '@/services/production-observability'
import { nextWorkerPollDelay } from '@/lib/polling'
import { hasRecoverableVideoCheckpoint } from '@/lib/generation-checkpoint-recovery'
import { resumeVideoGenerationFromCheckpoint } from '@/services/ai'
import { durableMediaWorkerEnabled } from '@/lib/media-worker-config'

const LEASE_MS = 30 * 60 * 1000
const ACTIVE_POLL_MS = 5_000
const MAX_IDLE_POLL_MS = 30_000
const MAX_ATTEMPTS = 3
const workerOwner = `${process.pid}:${randomUUID()}`
const globalWorker = globalThis as typeof globalThis & {
    __durableMediaWorker?: { timer: NodeJS.Timeout | null; running: boolean; idlePollMs: number; wakeRequested: boolean }
    __durableMediaWorkerMissingDbWarned?: boolean
    __durableMediaWorkerDisabledLogged?: boolean
}
let nextRecoveryAt = 0

async function recoverAbandonedJobs() {
    if (Date.now() < nextRecoveryAt) return
    nextRecoveryAt = Date.now() + 10 * 60 * 1000
    const staleBefore = new Date(Date.now() - 60 * 60 * 1000)
    const abandoned = await prisma.generation.findMany({
        where: {
            type: { not: 'compose' },
            status: { in: ['queued', 'processing'] },
            updatedAt: { lt: staleBefore }
        },
        select: {
            id: true,
            storyboardId: true,
            type: true,
            provider: true,
            taskId: true,
            storyboard: { select: { episode: { select: { projectId: true } } } }
        }
    })
    const resumable = abandoned.filter(hasRecoverableVideoCheckpoint)
    const unrecoverable = abandoned.filter(item => !hasRecoverableVideoCheckpoint(item))
    if (unrecoverable.length) {
        await prisma.generation.updateMany({
            where: { id: { in: unrecoverable.map(item => item.id) }, status: { in: ['queued', 'processing'] } },
            data: { status: 'failed', activeKey: null, errorMsg: '生成服务重启，当前任务未能完成结果回写，请重新生成当前步骤' }
        })
        const frameIds = [...new Set(unrecoverable.filter(item => ['illustrations', 'first_frame', 'middle_frame', 'last_frame'].includes(item.type)).map(item => item.storyboardId))]
        const videoIds = [...new Set(unrecoverable.filter(item => item.type === 'video').map(item => item.storyboardId))]
        const audioIds = [...new Set(unrecoverable.filter(item => item.type === 'audio').map(item => item.storyboardId))]
        if (frameIds.length) await prisma.storyboard.updateMany({ where: { id: { in: frameIds }, frameStatus: 'generating' }, data: { frameStatus: 'failed' } })
        if (videoIds.length) await prisma.storyboard.updateMany({ where: { id: { in: videoIds }, videoStatus: 'generating' }, data: { videoStatus: 'failed' } })
        if (audioIds.length) await prisma.storyboard.updateMany({ where: { id: { in: audioIds }, audioStatus: 'generating' }, data: { audioStatus: 'failed' } })
    }

    // A provider task ID is a durable checkpoint. Resume a small bounded set
    // instead of discarding completed upstream work (and paying for a duplicate).
    await Promise.all(
        resumable.slice(0, 3).map(async item => {
            const now = new Date()
            const claimed = await prisma.generation.updateMany({
                where: {
                    id: item.id,
                    status: 'processing',
                    updatedAt: { lt: staleBefore },
                    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }]
                },
                data: {
                    leaseOwner: workerOwner,
                    leaseExpiresAt: new Date(Date.now() + LEASE_MS),
                    heartbeatAt: now,
                    updatedAt: now
                }
            })
            if (claimed.count !== 1) return
            try {
                const resumed = await resumeVideoGenerationFromCheckpoint(item.id)
                if (!resumed) {
                    await prisma.generation.updateMany({
                        where: { id: item.id, status: 'processing', leaseOwner: workerOwner },
                        data: { status: 'failed', activeKey: null, errorMsg: '生成服务重启，当前视频任务无法恢复，请重新生成当前步骤', leaseOwner: null, leaseExpiresAt: null }
                    })
                    await prisma.storyboard.updateMany({ where: { id: item.storyboardId, videoStatus: 'generating' }, data: { videoStatus: 'failed' } })
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                await prisma.generation.updateMany({
                    where: { id: item.id, status: 'processing', leaseOwner: workerOwner },
                    data: { status: 'failed', activeKey: null, errorMsg: message, leaseOwner: null, leaseExpiresAt: null }
                })
                await prisma.storyboard.updateMany({ where: { id: item.storyboardId, videoStatus: 'generating' }, data: { videoStatus: 'failed' } })
            } finally {
                await reconcileGenerationTelemetry(item.storyboard.episode.projectId).catch(error => console.error('[durable-worker] checkpoint telemetry reconciliation failed', error))
            }
        })
    )

    const staleJobs = await Promise.all([
        prisma.chapterJob.findMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            select: { id: true, episodeId: true }
        }),
        prisma.scriptJob.findMany({ where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } }, select: { id: true, episodeId: true } }),
        prisma.storyboardJob.findMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            select: { id: true, episodeId: true }
        })
    ])
    const reason = '服务重启后任务租约已过期，请重试'
    if (staleJobs[0].length) {
        await prisma.chapterJob.updateMany({
            where: { id: { in: staleJobs[0].map(item => item.id) } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        })
        await prisma.episode.updateMany({ where: { id: { in: staleJobs[0].map(item => item.episodeId) }, status: 'drafting' }, data: { status: 'outlined' } })
    }
    if (staleJobs[1].length) {
        await prisma.scriptJob.updateMany({
            where: { id: { in: staleJobs[1].map(item => item.id) } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        })
        await prisma.episode.updateMany({ where: { id: { in: staleJobs[1].map(item => item.episodeId) }, status: 'scripting' }, data: { status: 'finalized' } })
    }
    if (staleJobs[2].length) {
        await prisma.storyboardJob.updateMany({
            where: { id: { in: staleJobs[2].map(item => item.id) } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        })
        await prisma.episode.updateMany({ where: { id: { in: staleJobs[2].map(item => item.episodeId) }, status: 'storyboarding' }, data: { status: 'scripted' } })
    }
    await Promise.all([
        prisma.projectAiJob.updateMany({
            where: { kind: { not: 'project_import' }, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        }),
        prisma.extractJob.updateMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'analyzing', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        }),
        prisma.outlineJob.updateMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        }),
        prisma.refImageJob.updateMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            data: { phase: 'error', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
        }),
        prisma.batchJob.updateMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            data: { phase: 'error', errorMsg: reason }
        }),
        prisma.epJob.updateMany({
            where: { phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] }, updatedAt: { lt: staleBefore } },
            data: { phase: 'error', errorMsg: reason }
        })
    ])
}

async function claimCompose() {
    const now = new Date()
    const candidate = await prisma.generation.findFirst({
        where: {
            type: 'compose',
            status: 'processing',
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
            AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }]
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, storyboardId: true, retryIndex: true }
    })
    if (!candidate) return null
    const claimed = await prisma.generation.updateMany({
        where: { id: candidate.id, status: 'processing', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        data: { leaseOwner: workerOwner, leaseExpiresAt: new Date(Date.now() + LEASE_MS), heartbeatAt: now, retryIndex: { increment: 1 } }
    })
    return claimed.count === 1 ? candidate : null
}

async function claimMerge() {
    const now = new Date()
    const candidate = await prisma.videoMerge.findFirst({
        where: {
            status: 'processing',
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
            AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }]
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, episodeId: true, attempts: true }
    })
    if (!candidate) return null
    const claimed = await prisma.videoMerge.updateMany({
        where: { id: candidate.id, status: 'processing', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        data: { leaseOwner: workerOwner, leaseExpiresAt: new Date(Date.now() + LEASE_MS), heartbeatAt: now, attempts: { increment: 1 } }
    })
    return claimed.count === 1 ? candidate : null
}

async function runCompose() {
    const job = await claimCompose()
    if (!job) return false
    try {
        await composeShot(job.storyboardId, job.id)
        const row = await prisma.storyboard.findUnique({ where: { id: job.storyboardId }, select: { episode: { select: { projectId: true } } } })
        if (row) await reconcileGenerationTelemetry(row.episode.projectId)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const exhausted = job.retryIndex + 1 >= MAX_ATTEMPTS
        await prisma.generation.updateMany({
            where: { id: job.id, status: 'processing', leaseOwner: workerOwner },
            data: exhausted
                ? { status: 'failed', activeKey: null, errorMsg: message, leaseOwner: null, leaseExpiresAt: null }
                : { errorMsg: message, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: new Date(Date.now() + 30_000 * (job.retryIndex + 1)) }
        })
    }
    return true
}

async function runMerge() {
    const job = await claimMerge()
    if (!job) return false
    try {
        const episode = await prisma.episode.findUnique({
            where: { id: job.episodeId },
            select: {
                project: { select: { userId: true } },
                storyboards: {
                    where: { deletedAt: null },
                    orderBy: { order: 'asc' },
                    select: {
                        videoUrl: true,
                        audioUrl: true,
                        composedVideoUrl: true,
                        generations: {
                            where: { type: 'video', status: 'completed' },
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                            select: { provider: true }
                        }
                    }
                }
            }
        })
        if (!episode) throw new Error('Episode not found')
        const paths = episode.storyboards.map(item => (usesEmbeddedVideoAudio(item.generations[0]?.provider) || !item.audioUrl ? item.videoUrl : item.composedVideoUrl))
        if (paths.some(path => !path)) throw new Error('存在尚未完成的分镜视频')
        const result = await mergeEpisodeVideos(job.episodeId, job.id, paths as string[])
        if (!result.success) throw new Error(result.error)
        await chargeWalletUsage({
            userId: episode.project.userId,
            amountPoints: quoteGenerationPoints('merge', 'ffmpeg'),
            idempotencyKey: `usage:episode-merge:${job.id}`,
            sourceType: 'video_merge',
            sourceId: job.id.toString(),
            description: `整集合并 · ${paths.length} 个镜头`,
            metadata: { episodeId: job.episodeId.toString(), shotCount: paths.length, durationSeconds: Number(result.duration.toFixed(3)) }
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const exhausted = job.attempts + 1 >= MAX_ATTEMPTS
        await prisma.videoMerge.updateMany({
            where: { id: job.id, status: 'processing', leaseOwner: workerOwner },
            data: exhausted
                ? { status: 'failed', activeKey: null, errorMsg: message, leaseOwner: null, leaseExpiresAt: null }
                : { errorMsg: message, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: new Date(Date.now() + 30_000 * (job.attempts + 1)) }
        })
    }
    return true
}

async function tick() {
    const state = globalWorker.__durableMediaWorker
    if (!state || state.running) return
    state.running = true
    let processedWork = false
    try {
        await recoverAbandonedJobs()
        for (let index = 0; index < 4; index++) {
            const [compose, merge] = await Promise.all([runCompose(), runMerge()])
            processedWork ||= compose || merge
            if (!compose && !merge) break
        }
    } catch (error) {
        console.error('[durable-worker] tick failed', error)
    } finally {
        state.running = false
        const wakeImmediately = state.wakeRequested
        state.wakeRequested = false
        state.idlePollMs = nextWorkerPollDelay(state.idlePollMs, processedWork, ACTIVE_POLL_MS, MAX_IDLE_POLL_MS)
        scheduleTick(state, wakeImmediately ? 0 : state.idlePollMs)
    }
}

function scheduleTick(state: NonNullable<typeof globalWorker.__durableMediaWorker>, delayMs: number) {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => void tick(), delayMs)
    state.timer.unref()
}

export function startDurableMediaWorker() {
    if (!durableMediaWorkerEnabled()) {
        if (!globalWorker.__durableMediaWorkerDisabledLogged) {
            console.log('[durable-worker] disabled by ENABLE_DURABLE_MEDIA_WORKER')
            globalWorker.__durableMediaWorkerDisabledLogged = true
        }
        return
    }
    if (globalWorker.__durableMediaWorker) return
    const state = { timer: null, running: false, idlePollMs: ACTIVE_POLL_MS, wakeRequested: false }
    globalWorker.__durableMediaWorker = state
    scheduleTick(state, 0)
}

export function kickDurableMediaWorker() {
    if (!durableMediaWorkerEnabled()) return
    startDurableMediaWorker()
    const state = globalWorker.__durableMediaWorker
    if (!state) return
    state.idlePollMs = ACTIVE_POLL_MS
    if (state.running) {
        state.wakeRequested = true
        return
    }
    scheduleTick(state, 0)
}
