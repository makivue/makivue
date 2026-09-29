import { localTransactionLock } from '@/lib/local-store'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { parseApiId } from '@/lib/api-id'
import type { Prisma } from '@/generated/prisma/client'

export type EpJobPhase = 'running' | 'done' | 'error' | 'cancelled'
type ShotStepStatus = 'pending' | 'frame_running' | 'frame_done' | 'video_running' | 'video_done' | 'failed' | 'skipped'

export interface EpJobShot {
    storyboardId: string
    order: number
    status: ShotStepStatus
    errorMsg?: string
    errorDetail?: string
    failedStage?: 'frame' | 'video'
    stageStartedAt?: number
}

export interface EpJob {
    id: string
    projectId: string
    episodeId: string
    phase: EpJobPhase
    total: number
    shots: EpJobShot[]
    createdAt: number
    updatedAt: number
    errorMsg?: string
    reused?: boolean
}

export const EP_JOB_STALE_MS = 3 * 60 * 1000
const EP_JOB_FRAME_STAGE_TIMEOUT_MS = 10 * 60 * 1000
const EP_JOB_VIDEO_STAGE_TIMEOUT_MS = 45 * 60 * 1000
const EP_JOB_HEARTBEAT_EXPIRED_ERROR = '任务租约过期，已自动回收，请重试'
const EP_JOB_STAGE_EXPIRED_ERROR = '镜头生成阶段长时间没有完成，已自动停止；请重试未完成镜头'
const EP_JOB_GENERATION_TYPES = ['illustrations', 'first_frame', 'middle_frame', 'last_frame', 'video']

// ---- DB helpers ----

function serializeJob(row: {
    id: bigint
    projectId: bigint
    episodeId: bigint
    phase: string | null
    total: number | null
    shots: unknown
    errorMsg: string | null
    createdAt: Date
    updatedAt: Date
}): EpJob {
    return {
        id: row.id.toString(),
        projectId: row.projectId.toString(),
        episodeId: row.episodeId.toString(),
        phase: (row.phase ?? 'running') as EpJobPhase,
        total: row.total ?? 0,
        shots: (row.shots as EpJobShot[] | null) ?? [],
        errorMsg: row.errorMsg ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export function isEpJobHeartbeatExpired(updatedAt: Date | number, now = Date.now()) {
    const updatedAtMs = updatedAt instanceof Date ? updatedAt.getTime() : updatedAt
    return now - updatedAtMs > EP_JOB_STALE_MS
}

function normalizeExpiredShots(shots: unknown, reason: string): EpJobShot[] {
    return ((shots as EpJobShot[] | null) ?? []).map(shot => {
        if (shot.status === 'frame_running' || shot.status === 'video_running') {
            return { ...shot, status: 'failed', failedStage: shot.status === 'video_running' ? 'video' : 'frame', errorMsg: reason }
        }
        if (shot.status === 'pending' || shot.status === 'frame_done') {
            return { ...shot, status: 'skipped', errorMsg: reason }
        }
        return shot
    })
}

/**
 * A storyboard replacement invalidates the whole batch snapshot, including
 * shots that happened to finish before the replacement. Keep the job as an
 * audit row, but make every item non-error so the UI cannot present an
 * intentional replacement as a wall of generation failures.
 */
export function supersedeEpJobShots(shots: unknown, reason: string): EpJobShot[] {
    return ((shots as EpJobShot[] | null) ?? []).map(shot => {
        const superseded: EpJobShot = { ...shot, status: 'skipped', errorMsg: reason }
        delete superseded.failedStage
        delete superseded.stageStartedAt
        return superseded
    })
}

function isEpJobStageExpired(shots: unknown, now = Date.now(), legacyStartedAt?: Date | number) {
    const legacyStartedAtMs = legacyStartedAt instanceof Date ? legacyStartedAt.getTime() : legacyStartedAt
    return ((shots as EpJobShot[] | null) ?? []).some(shot => {
        const startedAt = shot.stageStartedAt ?? legacyStartedAtMs
        if (!startedAt) return false
        if (shot.status === 'frame_running') return now - startedAt > EP_JOB_FRAME_STAGE_TIMEOUT_MS
        if (shot.status === 'video_running') return now - startedAt > EP_JOB_VIDEO_STAGE_TIMEOUT_MS
        return false
    })
}

function parseStoryboardIds(shots: unknown) {
    const ids: bigint[] = []
    for (const shot of (shots as EpJobShot[] | null) ?? []) {
        try {
            ids.push(BigInt(shot.storyboardId))
        } catch {
            // Ignore malformed legacy progress entries; the ep job itself can
            // still be expired without touching unrelated generation rows.
        }
    }
    return ids
}

async function expireEpJob(
    tx: Prisma.TransactionClient,
    row: {
        id: bigint
        shots: unknown
        createdAt: Date
        updatedAt: Date
    },
    staleBefore: Date,
    options: { force?: boolean; reason?: string } = {}
) {
    const reason = options.reason ?? EP_JOB_HEARTBEAT_EXPIRED_ERROR
    const expired = await tx.epJob.updateMany({
        where: { id: row.id, phase: 'running', ...(options.force ? {} : { updatedAt: { lt: staleBefore } }) },
        data: {
            phase: 'error',
            shots: normalizeExpiredShots(row.shots, reason) as unknown as object,
            errorMsg: reason,
            updatedAt: new Date()
        }
    })
    if (expired.count !== 1) return false

    const storyboardIds = parseStoryboardIds(row.shots)
    if (storyboardIds.length === 0) return true

    // Old request-bound callbacks cannot be resumed after their pod exits.
    // Release only generation rows that belong to the same storyboards, were
    // created after this batch started, and also stopped updating before the
    // batch heartbeat deadline. Fresh manual work is left untouched.
    const abandoned = await tx.generation.findMany({
        where: {
            storyboardId: { in: storyboardIds },
            type: { in: EP_JOB_GENERATION_TYPES },
            status: { in: ['queued', 'processing'] },
            createdAt: { gte: row.createdAt },
            OR: [{ updatedAt: { lt: staleBefore } }, { updatedAt: null }]
        },
        select: { id: true, storyboardId: true, type: true }
    })
    if (abandoned.length === 0) return true

    await tx.generation.updateMany({
        where: { id: { in: abandoned.map(item => item.id) }, status: { in: ['queued', 'processing'] } },
        data: {
            status: 'failed',
            activeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorMsg: reason
        }
    })

    const frameStoryboardIds = [...new Set(abandoned.filter(item => item.type !== 'video').map(item => item.storyboardId))]
    const videoStoryboardIds = [...new Set(abandoned.filter(item => item.type === 'video').map(item => item.storyboardId))]
    if (frameStoryboardIds.length > 0) {
        await tx.storyboard.updateMany({
            where: { id: { in: frameStoryboardIds }, frameStatus: 'generating', firstFrameUrl: null },
            data: { frameStatus: 'failed' }
        })
        await tx.storyboard.updateMany({
            where: { id: { in: frameStoryboardIds }, frameStatus: 'generating', firstFrameUrl: { not: null } },
            data: { frameStatus: 'completed' }
        })
    }
    if (videoStoryboardIds.length > 0) {
        await tx.storyboard.updateMany({
            where: { id: { in: videoStoryboardIds }, videoStatus: 'generating', videoUrl: null },
            data: { videoStatus: 'failed' }
        })
        await tx.storyboard.updateMany({
            where: { id: { in: videoStoryboardIds }, videoStatus: 'generating', videoUrl: { not: null } },
            data: { videoStatus: 'completed' }
        })
    }
    return true
}

async function findActiveEpJob(tx: Prisma.TransactionClient, episodeId: bigint) {
    const staleBefore = new Date(Date.now() - EP_JOB_STALE_MS)
    const running = await tx.epJob.findMany({
        where: { episodeId, phase: 'running' },
        orderBy: { createdAt: 'desc' }
    })
    let active: (typeof running)[number] | undefined
    for (const row of running) {
        const stageExpired = isEpJobStageExpired(row.shots, Date.now(), row.createdAt)
        if (!stageExpired && !isEpJobHeartbeatExpired(row.updatedAt)) {
            active ??= row
            continue
        }
        const expired = await expireEpJob(tx, row, staleBefore, stageExpired ? { force: true, reason: EP_JOB_STAGE_EXPIRED_ERROR } : undefined)
        if (!expired) {
            const refreshed = await tx.epJob.findUnique({ where: { id: row.id } })
            if (refreshed?.phase === 'running') active ??= refreshed
        }
    }
    return active
}

// ---- AbortController (per-process, NOT shared across pods) ----
// The AbortController only works within the same Node process where the
// generate-all handler is running. Cross-pod cancellation requires the DB
// phase check which happens in checkCancelled().

type ControllerStore = Map<string, AbortController>

const globalControllers = globalThis as unknown as { __epJobControllers?: ControllerStore }
if (!globalControllers.__epJobControllers) {
    globalControllers.__epJobControllers = new Map()
}
const controllers: ControllerStore = globalControllers.__epJobControllers!

// ---- Public API ----

export async function getActiveEpJobForEpisode(episodeId: string): Promise<EpJob | undefined> {
    const episodeIdBig = BigInt(episodeId)
    const lockName = `studio-episode-batch:${episodeId}`
    const row = await prisma.$transaction(async tx => {
        const lockRows = await localTransactionLock(lockName)
        if (Number(lockRows[0]?.acquired ?? 0) !== 1) throw new Error('批量任务正在提交，请稍后重试')
        try {
            return await findActiveEpJob(tx, episodeIdBig)
        } finally {
            // The enclosing local-file transaction releases its exclusive workspace lock.
        }
    })
    return row ? serializeJob(row) : undefined
}

export async function createEpJob(projectId: string, episodeId: string, shots: Array<{ storyboardId: string; order: number }>): Promise<EpJob> {
    const episodeIdBig = BigInt(episodeId)
    const lockName = `studio-episode-batch:${episodeId}`
    const result = await prisma.$transaction(async tx => {
        const lockRows = await localTransactionLock(lockName)
        if (Number(lockRows[0]?.acquired ?? 0) !== 1) throw new Error('批量任务正在提交，请稍后重试')
        try {
            const existing = await findActiveEpJob(tx, episodeIdBig)
            if (existing) return { row: existing, reused: true }
            const row = await tx.epJob.create({
                data: {
                    id: genId(),
                    projectId: BigInt(projectId),
                    episodeId: episodeIdBig,
                    phase: 'running',
                    total: shots.length,
                    shots: shots.map(s => ({
                        storyboardId: s.storyboardId,
                        order: s.order,
                        status: 'pending' as ShotStepStatus
                    }))
                }
            })
            return { row, reused: false }
        } finally {
            // The enclosing local-file transaction releases its exclusive workspace lock.
        }
    })
    const job = { ...serializeJob(result.row), reused: result.reused }
    if (result.reused) return job
    // Create AbortController for in-process signal
    controllers.set(job.id, new AbortController())
    return job
}

export async function heartbeatEpJob(id: string): Promise<void> {
    try {
        await prisma.epJob.updateMany({
            where: { id: BigInt(id), phase: 'running' },
            data: { updatedAt: new Date() }
        })
    } catch (err) {
        console.warn(`[episodeJobStore] heartbeatEpJob(${id}) failed:`, err)
    }
}

export function getEpJobSignal(jobId: string): AbortSignal | undefined {
    return controllers.get(jobId)?.signal
}

/** Abort request-bound work after the matching database transaction commits. */
export function abortEpJobControllers(jobIds: Array<string | bigint>): void {
    for (const jobId of jobIds) {
        const ctrl = controllers.get(jobId.toString())
        if (ctrl && !ctrl.signal.aborted) ctrl.abort()
    }
}

export async function isEpJobCancelled(jobId: string): Promise<boolean> {
    // Check DB first (cross-pod in case cancel came from another instance)
    const row = await prisma.epJob.findUnique({
        where: { id: BigInt(jobId) },
        select: { phase: true }
    })
    if (row?.phase !== 'running') return true
    // Also check local AbortController
    const ctrl = controllers.get(jobId)
    if (ctrl?.signal.aborted) return true
    return false
}

export async function cancelEpJob(jobId: string): Promise<boolean> {
    // Update DB so other pods see the cancellation
    const updated = await prisma.epJob.updateMany({
        where: { id: BigInt(jobId), phase: 'running' },
        data: { phase: 'cancelled', updatedAt: new Date() }
    })
    // Fire local AbortController if it exists
    abortEpJobControllers([jobId])
    return updated.count > 0
}

export async function finalizeEpJob(id: string, phase: Extract<EpJobPhase, 'done' | 'error' | 'cancelled'>, errorMsg?: string): Promise<void> {
    try {
        await prisma.$transaction(async tx => {
            const row = await tx.epJob.findUnique({
                where: { id: BigInt(id) },
                select: { shots: true }
            })
            if (!row) return
            const shots = ((row.shots as EpJobShot[] | null) ?? []).map(shot => {
                if (phase === 'cancelled') {
                    return shot.status === 'frame_running' || shot.status === 'video_running' ? { ...shot, status: 'pending' as const, errorMsg: '已暂停' } : shot
                }
                if (shot.status === 'frame_running' || shot.status === 'video_running') {
                    return {
                        ...shot,
                        status: 'failed' as const,
                        failedStage: shot.status === 'video_running' ? ('video' as const) : ('frame' as const),
                        errorMsg: shot.errorMsg ?? errorMsg ?? '任务异常结束'
                    }
                }
                if (shot.status === 'pending' || shot.status === 'frame_done') {
                    return { ...shot, status: 'skipped' as const, errorMsg: shot.errorMsg ?? errorMsg ?? '任务结束前未执行' }
                }
                return shot
            })
            // A replacement transaction may already have cancelled and
            // normalized this job. A late executor must never overwrite that
            // terminal state with `done`, `error`, or stale red shot rows.
            await tx.epJob.updateMany({
                where: { id: BigInt(id), phase: 'running' },
                data: {
                    phase,
                    shots: shots as unknown as object,
                    ...(errorMsg ? { errorMsg } : {}),
                    updatedAt: new Date()
                }
            })
        })
    } catch (err) {
        console.warn(`[episodeJobStore] finalizeEpJob(${id}) failed:`, err)
    } finally {
        controllers.delete(id)
    }
}

export async function updateShot(jobId: string, storyboardId: string, patch: Partial<EpJobShot>): Promise<void> {
    try {
        // 两个批次 worker 会同时更新同一 JSON。行锁会保持到事务提交，
        // 串行化 read-modify-write，避免一个镜头的进度覆盖另一个镜头。
        await prisma.$transaction(async tx => {
            const id = BigInt(jobId)
            const lockedRows = await tx.epJob.findMany({ where: { id: id }, select: { id: true } })
            if (lockedRows.length === 0) return
            const row = await tx.epJob.findUnique({
                where: { id },
                select: { phase: true, shots: true }
            })
            if (!row || row.phase !== 'running') return
            const shots = (row.shots as EpJobShot[] | null) ?? []
            const next = shots.map(s => {
                if (s.storyboardId !== storyboardId) return s
                const updated = { ...s, ...patch }
                if (patch.status === 'frame_running' || patch.status === 'video_running') {
                    updated.stageStartedAt = Date.now()
                } else if (patch.status) {
                    delete updated.stageStartedAt
                }
                if (patch.status && patch.status !== 'failed' && patch.status !== 'skipped') {
                    delete updated.errorMsg
                    delete updated.errorDetail
                    delete updated.failedStage
                }
                return updated
            })
            await tx.epJob.update({
                where: { id },
                data: { shots: next as unknown as object, updatedAt: new Date() }
            })
        })
    } catch (err) {
        console.warn(`[episodeJobStore] updateShot(${jobId}, ${storyboardId}) failed:`, err)
    }
}

export async function getEpJob(id: string): Promise<EpJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.epJob.findUnique({ where: { id: idBig } })
    if (!row) return undefined
    // Polling is also a recovery path. If a pod disappears after the modal has
    // started polling, the UI must leave "running" on its own instead of
    // waiting for the user to submit another batch first.
    if (row.phase === 'running' && (isEpJobHeartbeatExpired(row.updatedAt) || isEpJobStageExpired(row.shots, Date.now(), row.createdAt))) {
        await getActiveEpJobForEpisode(row.episodeId.toString())
        row = await prisma.epJob.findUnique({ where: { id: idBig } })
        if (!row) return undefined
    }
    // Cleanup: returns undefined for jobs completed >2h ago (keep fresh)
    if ((row.phase === 'done' || row.phase === 'error') && Date.now() - row.updatedAt.getTime() > 2 * 60 * 60 * 1000) {
        return undefined
    }
    return serializeJob(row)
}
