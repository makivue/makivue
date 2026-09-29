import { prisma } from '@/lib/prisma'
import type { StoryboardProductionIssue } from '@/lib/script-production'
import { genId } from '@/lib/id'
import { retryP2002 } from '@/lib/jobStoreRetry'
import { parseApiId } from '@/lib/api-id'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, isUniqueConstraintError, newTextJobLease } from '@/lib/text-job-lease'

type StoryboardJobPhase = 'generating' | 'writing_db' | 'done' | 'error' | 'cancelled'

interface StoryboardJobResult {
    episodeId: string
    count: number
    cancelled: boolean
    validationIssues?: StoryboardProductionIssue[]
}

export interface StoryboardJob {
    id: string
    episodeId: string
    projectId: string
    phase: StoryboardJobPhase
    attempts: number
    error?: string
    result?: StoryboardJobResult
    createdAt: number
    updatedAt: number
}

export interface StoryboardJobUpdate {
    phase?: StoryboardJobPhase
    attempts?: number
    error?: string
    result?: StoryboardJobResult
}

function serialize(row: {
    id: bigint
    episodeId: bigint
    projectId: bigint
    phase: string | null
    attempts: number | null
    error: string | null
    result: unknown
    createdAt: Date
    updatedAt: Date
}): StoryboardJob {
    return {
        id: row.id.toString(),
        episodeId: row.episodeId.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'generating') as StoryboardJobPhase,
        attempts: row.attempts ?? 0,
        error: row.error ?? undefined,
        result: (row.result as StoryboardJobResult | null) ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(episodeId: string, projectId: string): Promise<StoryboardJob> {
    const activeKey = `storyboard:${episodeId}`
    await prisma.storyboardJob.updateMany({
        where: { activeKey, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
        data: { phase: 'error', error: '任务租约过期，已自动回收，请重试', activeKey: null, leaseOwner: null, leaseExpiresAt: null }
    })
    const existing = await prisma.storyboardJob.findFirst({ where: { activeKey } })
    if (existing) return serialize(existing)
    let row
    try {
        row = await retryP2002(
            () =>
                prisma.storyboardJob.create({
                    data: {
                        id: genId(),
                        episodeId: BigInt(episodeId),
                        projectId: BigInt(projectId),
                        phase: 'generating',
                        attempts: 0,
                        activeKey,
                        ...newTextJobLease('storyboard')
                    }
                }),
            'storyboardJobStore.createJob'
        )
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const duplicate = await prisma.storyboardJob.findUnique({ where: { activeKey } })
        if (!duplicate) throw error
        row = duplicate
    }
    return serialize(row)
}

export async function updateJob(id: string, patch: StoryboardJobUpdate): Promise<void> {
    try {
        const updated = await prisma.storyboardJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
                ...(patch.error !== undefined ? { error: patch.error } : {}),
                ...(patch.result !== undefined ? { result: patch.result as unknown as object } : {}),
                ...heartbeatTextJobLease(patch.phase === 'done' || patch.phase === 'error' || patch.phase === 'cancelled'),
                updatedAt: new Date()
            }
        })
        if (updated.count === 0 && patch.phase === 'writing_db') throw new Error('任务已取消，停止写入')
        if (patch.phase === 'error' || patch.phase === 'cancelled') {
            const { releaseModelReservations } = await import('@/services/wallet-reservations')
            await releaseModelReservations(`job:${id}`)
        }
    } catch (err) {
        if (err instanceof Error && err.message === '任务已取消，停止写入') throw err
        console.warn(`[storyboardJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string): Promise<StoryboardJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.storyboardJob.findUnique({ where: { id: idBig } })
    if (row && isTextJobLeaseExpired(row, ['generating', 'writing_db'])) {
        await prisma.storyboardJob.updateMany({
            where: { id: idBig, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
            data: expiredTextJobLease()
        })
        row = await prisma.storyboardJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}

export async function cancelRunningJobs(episodeId: string): Promise<void> {
    try {
        await prisma.storyboardJob.updateMany({
            where: {
                episodeId: BigInt(episodeId),
                phase: { in: ['generating', 'writing_db'] }
            },
            data: { phase: 'cancelled', ...heartbeatTextJobLease(true), updatedAt: new Date() }
        })
    } catch (err) {
        console.warn(`[storyboardJobStore] cancelRunningJobs(${episodeId}) failed:`, err)
    }
}
