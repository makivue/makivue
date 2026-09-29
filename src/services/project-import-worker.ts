import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { parseApiId } from '@/lib/api-id'
import type { ProjectAiJob } from '@/lib/projectAiJobStore'
import { newTextJobLease } from '@/lib/text-job-lease'
import { detectAndParseScriptChunk, mergeDetectedScriptChunks, splitImportText, type DetectedScriptResult } from '@/services/script-import'
import { persistDetectedImport, type ImportVideoAspectRatio } from '@/services/project-import'
import { buildProjectImportPreview, type ProjectImportPreview } from '@/lib/project-import-preview'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { projectImportWorkerEnabled } from '@/lib/media-worker-config'
import type { Locale } from '@/i18n/config'
import type { EpisodeFormat } from '@/lib/novel'

const PROJECT_IMPORT_MAX_ATTEMPTS = 3
export const PROJECT_IMPORT_HEARTBEAT_MS = 30_000
const PROJECT_IMPORT_LEASE_MS = 2 * 60 * 1000
const ACTIVE_POLL_MS = 2_000
const IDLE_POLL_MS = 15_000

interface ProjectImportChunkCheckpoint {
    index: number
    detected: DetectedScriptResult
}

interface ProjectImportCommitCheckpoint {
    projectId: string
    visualStyle: string
    videoAspectRatio: ImportVideoAspectRatio
    contentLanguage?: Locale
    episodeFormat?: EpisodeFormat
}

export interface ProjectImportJobPayload {
    version: 1
    input?: { rawText: string }
    completedChunks?: ProjectImportChunkCheckpoint[]
    detected?: DetectedScriptResult
    preview?: ProjectImportPreview
    commit?: ProjectImportCommitCheckpoint
}

export interface ClaimedProjectImportJob {
    id: string
    projectId: string
    phase: 'generating' | 'writing_db'
    attempts: number
    leaseOwner: string
    result: unknown
}

class ImportLeaseLostError extends Error {
    constructor() {
        super('Project import lease lost')
    }
}

class InvalidImportCheckpointError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readProjectImportPayload(value: unknown): ProjectImportJobPayload | undefined {
    if (!isRecord(value)) return undefined
    if (value.version === 1) return value as unknown as ProjectImportJobPayload
    // Jobs that reached confirmation before the durable format was deployed
    // contain only { detected, preview }. Keep those confirmable.
    if (isRecord(value.detected)) {
        return {
            version: 1,
            detected: value.detected as unknown as DetectedScriptResult,
            preview: isRecord(value.preview) ? (value.preview as unknown as ProjectImportPreview) : undefined
        }
    }
    return undefined
}

function heartbeatProjectImportLease() {
    const now = new Date()
    return { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + PROJECT_IMPORT_LEASE_MS) }
}

function newProjectImportLease() {
    return { ...newTextJobLease('project-import'), ...heartbeatProjectImportLease() }
}

/** The API deliberately exposes progress/preview, never the persisted source text. */
export function publicProjectImportStatus(job: ProjectAiJob) {
    const stored = readProjectImportPayload(job.result)
    return {
        id: job.id,
        phase: job.phase,
        progress: job.progress,
        total: job.total,
        error: job.phase === 'error' ? job.error : undefined,
        result: job.phase === 'awaiting_confirmation' ? stored?.preview : job.phase === 'done' ? job.result : undefined
    }
}

export async function queueProjectImportCommit({
    jobId,
    userId,
    detected,
    preview,
    visualStyle,
    videoAspectRatio,
    contentLanguage,
    episodeFormat
}: {
    jobId: string
    userId: bigint
    detected: DetectedScriptResult
    preview?: ProjectImportPreview
    visualStyle: string
    videoAspectRatio: ImportVideoAspectRatio
    contentLanguage?: Locale
    episodeFormat?: EpisodeFormat
}): Promise<boolean> {
    const id = parseApiId(jobId)
    if (id === null) return false
    const payload: ProjectImportJobPayload = {
        version: 1,
        detected,
        preview,
        commit: { projectId: genId().toString(), visualStyle, videoAspectRatio, contentLanguage, episodeFormat }
    }
    const queued = await prisma.projectAiJob.updateMany({
        where: { id, projectId: userId, kind: 'project_import', phase: 'awaiting_confirmation' },
        data: {
            phase: 'queued',
            attempts: 0,
            progress: 0,
            total: 1,
            error: null,
            result: payload as unknown as object,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            updatedAt: new Date()
        }
    })
    return queued.count === 1
}

async function expireExhaustedProjectImportJobs(jobId?: string) {
    let id: bigint | undefined
    if (jobId !== undefined) {
        const parsedId = parseApiId(jobId)
        if (parsedId === null) return
        id = parsedId
    }
    const now = new Date()
    await prisma.projectAiJob.updateMany({
        where: {
            ...(id === undefined ? {} : { id }),
            kind: 'project_import',
            attempts: { gte: PROJECT_IMPORT_MAX_ATTEMPTS },
            OR: [{ phase: 'queued' }, { phase: { in: ['generating', 'writing_db'] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }]
        },
        data: {
            phase: 'error',
            error: '剧本导入失败',
            activeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            updatedAt: now
        }
    })
}

export async function claimProjectImportJob(jobId?: string): Promise<ClaimedProjectImportJob | null> {
    let id: bigint | undefined
    if (jobId !== undefined) {
        const parsedId = parseApiId(jobId)
        if (parsedId === null) return null
        id = parsedId
    }
    await expireExhaustedProjectImportJobs(jobId)

    const now = new Date()
    const candidate = await prisma.projectAiJob.findFirst({
        where: {
            ...(id === undefined ? {} : { id }),
            kind: 'project_import',
            attempts: { lt: PROJECT_IMPORT_MAX_ATTEMPTS },
            OR: [
                {
                    phase: 'queued',
                    AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }]
                },
                {
                    phase: { in: ['generating', 'writing_db'] },
                    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }]
                }
            ]
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, projectId: true, phase: true, attempts: true, result: true }
    })
    if (!candidate) return null

    const payload = readProjectImportPayload(candidate.result)
    const nextPhase: ClaimedProjectImportJob['phase'] = payload?.commit ? 'writing_db' : 'generating'
    const lease = newProjectImportLease()
    const candidatePhase = candidate.phase ?? 'queued'
    const claimed = await prisma.projectAiJob.updateMany({
        where: {
            id: candidate.id,
            kind: 'project_import',
            phase: candidatePhase,
            attempts: candidate.attempts,
            ...(candidatePhase === 'queued' ? { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } : { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] })
        },
        data: {
            phase: nextPhase,
            attempts: { increment: 1 },
            error: null,
            nextAttemptAt: null,
            ...lease,
            updatedAt: now
        }
    })
    if (claimed.count !== 1) return null

    return {
        id: candidate.id.toString(),
        projectId: candidate.projectId.toString(),
        phase: nextPhase,
        attempts: (candidate.attempts ?? 0) + 1,
        leaseOwner: lease.leaseOwner,
        result: candidate.result
    }
}

async function heartbeatImportLease(job: ClaimedProjectImportJob): Promise<boolean> {
    const heartbeat = await prisma.projectAiJob.updateMany({
        where: { id: BigInt(job.id), kind: 'project_import', phase: job.phase, leaseOwner: job.leaseOwner },
        data: { ...heartbeatProjectImportLease(), updatedAt: new Date() }
    })
    return heartbeat.count === 1
}

async function withImportHeartbeat<T>(job: ClaimedProjectImportJob, work: (assertLease: () => void) => Promise<T>): Promise<T> {
    let leaseLost = false
    let heartbeatChain = Promise.resolve()
    const beat = async () => {
        try {
            if (!(await heartbeatImportLease(job))) leaseLost = true
        } catch (error) {
            // A transient heartbeat write must not abort a healthy provider
            // request. The next checkpoint is still guarded by leaseOwner.
            console.warn(`[project-import] heartbeat failed for ${job.id}`, error)
        }
    }
    await beat()
    if (leaseLost) throw new ImportLeaseLostError()

    const timer = setInterval(() => {
        heartbeatChain = heartbeatChain.then(beat)
    }, PROJECT_IMPORT_HEARTBEAT_MS)
    timer.unref()
    try {
        return await work(() => {
            if (leaseLost) throw new ImportLeaseLostError()
        })
    } finally {
        clearInterval(timer)
        await heartbeatChain
    }
}

async function checkpointAnalysis(job: ClaimedProjectImportJob, payload: ProjectImportJobPayload, progress: number, total: number) {
    const checkpointed = await prisma.projectAiJob.updateMany({
        where: { id: BigInt(job.id), kind: 'project_import', phase: 'generating', leaseOwner: job.leaseOwner },
        data: {
            result: payload as unknown as object,
            progress,
            total,
            ...heartbeatProjectImportLease(),
            updatedAt: new Date()
        }
    })
    if (checkpointed.count !== 1) throw new ImportLeaseLostError()
}

async function finishAnalysis(job: ClaimedProjectImportJob, detected: DetectedScriptResult, preview: ProjectImportPreview, total: number) {
    const payload: ProjectImportJobPayload = { version: 1, detected, preview }
    const finished = await prisma.projectAiJob.updateMany({
        where: { id: BigInt(job.id), kind: 'project_import', phase: 'generating', leaseOwner: job.leaseOwner },
        data: {
            phase: 'awaiting_confirmation',
            attempts: 0,
            progress: total,
            total,
            error: null,
            result: payload as unknown as object,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            heartbeatAt: new Date(),
            updatedAt: new Date()
        }
    })
    if (finished.count !== 1) throw new ImportLeaseLostError()
}

async function finishCommit(job: ClaimedProjectImportJob, result: unknown) {
    const finished = await prisma.projectAiJob.updateMany({
        where: { id: BigInt(job.id), kind: 'project_import', phase: 'writing_db', leaseOwner: job.leaseOwner },
        data: {
            phase: 'done',
            error: null,
            result: result as object,
            activeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            heartbeatAt: new Date(),
            updatedAt: new Date()
        }
    })
    if (finished.count !== 1) throw new ImportLeaseLostError()
}

async function releaseFailedJob(job: ClaimedProjectImportJob, error: unknown) {
    if (error instanceof ImportLeaseLostError) return
    const message = error instanceof Error ? error.message : String(error)
    const terminal = error instanceof InvalidImportCheckpointError || job.attempts >= PROJECT_IMPORT_MAX_ATTEMPTS
    await prisma.projectAiJob.updateMany({
        where: { id: BigInt(job.id), kind: 'project_import', phase: job.phase, leaseOwner: job.leaseOwner },
        data: terminal
            ? {
                  phase: 'error',
                  error: message || '剧本导入失败',
                  activeKey: null,
                  leaseOwner: null,
                  leaseExpiresAt: null,
                  nextAttemptAt: null,
                  heartbeatAt: new Date(),
                  updatedAt: new Date()
              }
            : {
                  phase: 'queued',
                  error: message,
                  leaseOwner: null,
                  leaseExpiresAt: null,
                  nextAttemptAt: new Date(Date.now() + 5_000 * job.attempts),
                  heartbeatAt: new Date(),
                  updatedAt: new Date()
              }
    })
}

async function executeAnalysis(job: ClaimedProjectImportJob, payload: ProjectImportJobPayload) {
    const rawText = payload.input?.rawText
    if (typeof rawText !== 'string' || rawText.trim().length < 20) {
        throw new InvalidImportCheckpointError('导入识别结果已失效，请重新识别')
    }
    const chunks = splitImportText(rawText)
    const completed = new Map<number, DetectedScriptResult>()
    for (const checkpoint of payload.completedChunks ?? []) {
        if (Number.isInteger(checkpoint.index) && checkpoint.index >= 0 && checkpoint.index < chunks.length && checkpoint.detected) {
            completed.set(checkpoint.index, checkpoint.detected)
        }
    }

    await withImportHeartbeat(job, async assertLease => {
        for (let index = 0; index < chunks.length; index += 1) {
            if (completed.has(index)) continue
            assertLease()
            // project_import jobs store their authenticated owner in projectId
            // until the actual project is created at confirmation time.
            const detected = await withHiModelsUsageScope({ userId: BigInt(job.projectId), jobId: job.id }, () => detectAndParseScriptChunk(chunks[index], index, chunks.length))
            assertLease()
            completed.set(index, detected)
            const completedChunks = [...completed.entries()].sort(([left], [right]) => left - right).map(([chunkIndex, chunkResult]) => ({ index: chunkIndex, detected: chunkResult }))
            await checkpointAnalysis(job, { version: 1, input: { rawText }, completedChunks }, completed.size, chunks.length)
        }
    })

    const ordered = chunks.map((_, index) => completed.get(index)).filter((value): value is DetectedScriptResult => Boolean(value))
    if (ordered.length !== chunks.length) throw new Error('剧本导入失败')
    const detected = mergeDetectedScriptChunks(ordered, rawText)
    await finishAnalysis(job, detected, buildProjectImportPreview(detected, rawText), chunks.length)
}

async function executeCommit(job: ClaimedProjectImportJob, payload: ProjectImportJobPayload) {
    if (!payload.detected || !payload.commit) throw new InvalidImportCheckpointError('导入识别结果已失效，请重新识别')
    const projectId = parseApiId(payload.commit.projectId)
    if (projectId === null) throw new InvalidImportCheckpointError('导入识别结果已失效，请重新识别')
    const result = await withImportHeartbeat(job, () =>
        persistDetectedImport({
            userId: BigInt(job.projectId),
            detected: payload.detected!,
            visualStyle: payload.commit!.visualStyle,
            videoAspectRatio: payload.commit!.videoAspectRatio,
            contentLanguage: payload.commit!.contentLanguage,
            episodeFormat: payload.commit!.episodeFormat,
            projectId
        })
    )
    await finishCommit(job, result)
}

export async function executeClaimedProjectImportJob(job: ClaimedProjectImportJob): Promise<void> {
    try {
        const payload = readProjectImportPayload(job.result)
        if (!payload) throw new InvalidImportCheckpointError('导入识别结果已失效，请重新识别')
        if (job.phase === 'writing_db') await executeCommit(job, payload)
        else await executeAnalysis(job, payload)
    } catch (error) {
        await releaseFailedJob(job, error)
    }
}

export async function runProjectImportJob(jobId?: string): Promise<boolean> {
    const claimed = await claimProjectImportJob(jobId)
    if (!claimed) return false
    await executeClaimedProjectImportJob(claimed)
    return true
}

const globalImportWorker = globalThis as typeof globalThis & {
    __projectImportWorker?: { timer: NodeJS.Timeout | null; running: boolean; wakeRequested: boolean }
}

async function tickProjectImportWorker() {
    const state = globalImportWorker.__projectImportWorker
    if (!state || state.running) return
    state.running = true
    let processed = false
    try {
        processed = await runProjectImportJob()
    } catch (error) {
        console.error('[project-import] worker tick failed', error)
    } finally {
        state.running = false
        const wakeImmediately = state.wakeRequested
        state.wakeRequested = false
        scheduleProjectImportTick(state, wakeImmediately || processed ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    }
}

function scheduleProjectImportTick(state: NonNullable<typeof globalImportWorker.__projectImportWorker>, delayMs: number) {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => void tickProjectImportWorker(), delayMs)
    state.timer.unref()
}

export function startProjectImportWorker() {
    if (!projectImportWorkerEnabled()) return
    if (globalImportWorker.__projectImportWorker || !process.env.DATABASE_URL?.trim()) return
    const state = { timer: null, running: false, wakeRequested: false }
    globalImportWorker.__projectImportWorker = state
    scheduleProjectImportTick(state, 0)
}

export function kickProjectImportWorker() {
    if (!projectImportWorkerEnabled()) return
    startProjectImportWorker()
    const state = globalImportWorker.__projectImportWorker
    if (!state) return
    if (state.running) {
        state.wakeRequested = true
        return
    }
    scheduleProjectImportTick(state, 0)
}
