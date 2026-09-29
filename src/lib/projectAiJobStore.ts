import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { retryP2002 } from '@/lib/jobStoreRetry'
import { parseApiId } from '@/lib/api-id'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, isUniqueConstraintError, newTextJobLease } from '@/lib/text-job-lease'
import type { Prisma } from '@/generated/prisma/client'

type ProjectAiJobPhase = 'queued' | 'generating' | 'awaiting_confirmation' | 'writing_db' | 'done' | 'error' | 'cancelled'
export type ProjectAiJobKind =
    | 'novel'
    | 'setup'
    | 'split_episodes'
    | 'expand_prompt'
    | 'project_import'
    | 'story_directions'
    | 'style_reference'
    | 'publication_metadata'
    | 'publication_covers'
    | 'character_references'
    | 'scene_references'
    | 'creator_image'
    | 'creator_video'

export interface ProjectAiJob {
    id: string
    projectId: string
    kind: ProjectAiJobKind
    phase: ProjectAiJobPhase
    attempts: number
    progress: number
    total: number
    error?: string
    result?: unknown
    leaseOwner?: string
    leaseExpiresAt?: number
    nextAttemptAt?: number
    createdAt: number
    updatedAt: number
}

export type CreatedProjectAiJob = ProjectAiJob & { reused: boolean }

export interface ProjectAiJobUpdate {
    phase?: ProjectAiJobPhase
    attempts?: number
    progress?: number
    total?: number
    error?: string
    result?: unknown
}

function serialize(row: {
    id: bigint
    projectId: bigint
    kind: string
    phase: string | null
    attempts: number | null
    progress: number | null
    total: number | null
    error: string | null
    result: unknown
    leaseOwner: string | null
    leaseExpiresAt: Date | null
    nextAttemptAt: Date | null
    createdAt: Date
    updatedAt: Date
}): ProjectAiJob {
    return {
        id: row.id.toString(),
        projectId: row.projectId.toString(),
        kind: row.kind as ProjectAiJobKind,
        phase: (row.phase ?? 'generating') as ProjectAiJobPhase,
        attempts: row.attempts ?? 0,
        progress: row.progress ?? 0,
        total: row.total ?? 0,
        error: row.error ?? undefined,
        result: row.result ?? undefined,
        leaseOwner: row.leaseOwner ?? undefined,
        leaseExpiresAt: row.leaseExpiresAt?.getTime(),
        nextAttemptAt: row.nextAttemptAt?.getTime(),
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(projectId: string, kind: ProjectAiJobKind, total = 0): Promise<CreatedProjectAiJob> {
    const activeKey = `project-ai:${projectId}:${kind}`
    await prisma.projectAiJob.updateMany({
        where: { activeKey, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
        data: { phase: 'error', error: '任务租约过期，已自动回收，请重试', activeKey: null, leaseOwner: null, leaseExpiresAt: null }
    })
    const existing = await prisma.projectAiJob.findFirst({ where: { activeKey } })
    if (existing) return { ...serialize(existing), reused: true }
    let row
    let reused = false
    try {
        row = await retryP2002(
            () =>
                prisma.projectAiJob.create({
                    data: {
                        id: genId(),
                        projectId: BigInt(projectId),
                        kind,
                        phase: 'generating',
                        attempts: 0,
                        progress: 0,
                        total,
                        activeKey,
                        ...newTextJobLease('project-ai')
                    }
                }),
            'projectAiJobStore.createJob'
        )
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const duplicate = await prisma.projectAiJob.findUnique({ where: { activeKey } })
        if (!duplicate) throw error
        row = duplicate
        reused = true
    }
    return { ...serialize(row), reused }
}

export async function updateJob(id: string, patch: ProjectAiJobUpdate, transaction?: Prisma.TransactionClient): Promise<void> {
    try {
        const updated = await (transaction ?? prisma).projectAiJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
                ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
                ...(patch.total !== undefined ? { total: patch.total } : {}),
                ...(patch.error !== undefined ? { error: patch.error } : {}),
                ...(patch.result !== undefined ? { result: patch.result as unknown as object } : {}),
                ...heartbeatTextJobLease(patch.phase === 'done' || patch.phase === 'error'),
                updatedAt: new Date()
            }
        })
        if (updated.count === 0 && (patch.phase === 'writing_db' || transaction)) throw new Error('任务已取消，停止写入')
        if (patch.phase === 'error') {
            const { releaseModelReservations } = await import('@/services/wallet-reservations')
            await releaseModelReservations(`job:${id}`)
        }
    } catch (err) {
        if (transaction) throw err
        if (err instanceof Error && err.message === '任务已取消，停止写入') throw err
        console.warn(`[projectAiJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string): Promise<ProjectAiJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.projectAiJob.findUnique({ where: { id: idBig } })
    // Project imports keep their input/checkpoints in result and are recovered
    // by the import worker. Converting them to error here would destroy the
    // recovery path at the exact moment a status poll tries to resume them.
    if (row && row.kind !== 'project_import' && isTextJobLeaseExpired(row, ['generating', 'writing_db'])) {
        await prisma.projectAiJob.updateMany({
            where: { id: idBig, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
            data: expiredTextJobLease()
        })
        row = await prisma.projectAiJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}

/** Prefer unfinished work; otherwise recover the most recent result from the last day. */
export async function getLatestJob(projectId: string, kind: ProjectAiJobKind): Promise<ProjectAiJob | undefined> {
    const projectIdBig = parseApiId(projectId)
    if (projectIdBig === null) return undefined
    const where = { projectId: projectIdBig, kind }
    const active = await prisma.projectAiJob.findFirst({
        where: { ...where, phase: { in: ['queued', 'generating', 'writing_db'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
    })
    const latest =
        active ??
        (await prisma.projectAiJob.findFirst({
            where: { ...where, updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
            orderBy: { createdAt: 'desc' },
            select: { id: true }
        }))
    // Reuse lease reconciliation so an interrupted worker is shown as failed,
    // rather than restoring a spinner that can never finish.
    return latest ? getJob(latest.id.toString()) : undefined
}
