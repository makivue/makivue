import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { retryP2002 } from '@/lib/jobStoreRetry'
import { parseApiId } from '@/lib/api-id'
import { HIMODELS_RAW_RESPONSE_MAX_RECORDS, type HiModelsRawResponse } from '@/lib/himodels-response-diagnostics'
import type { HiModelsUsageCall, HiModelsUsageSummary, ProviderTokenUsageCall, ProviderTokenUsageSummary } from '@/lib/himodels-token-usage'
import type { Prisma } from '@/generated/prisma/client'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, isUniqueConstraintError, newTextJobLease, TEXT_JOB_EXPIRED_ERROR } from '@/lib/text-job-lease'

export const OUTLINE_JOB_STALE_MS = 3 * 60 * 1000

type OutlineJobPhase = 'generating' | 'filling' | 'writing_db' | 'done' | 'error' | 'cancelled'

interface OutlineJobResult {
    count: number
    requested: number
    missing: number[]
    warning?: string
    seriesQuality?: Record<string, number>
    himodelsResponses?: HiModelsRawResponse[]
    himodelsResponsesDropped?: number
    tokenUsage?: HiModelsUsageSummary | ProviderTokenUsageSummary
    tokenUsageCalls?: ProviderTokenUsageCall[]
    himodelsUsageCalls?: HiModelsUsageCall[]
}

export interface OutlineJob {
    id: string
    projectId: string
    phase: OutlineJobPhase
    totalEpisodes: number
    receivedChapters: number
    error?: string
    result?: OutlineJobResult
    createdAt: number
    updatedAt: number
}

export interface CreatedOutlineJob extends OutlineJob {
    createdByRequest: boolean
}

export interface OutlineJobUpdate {
    phase?: OutlineJobPhase
    totalEpisodes?: number
    receivedChapters?: number
    error?: string
    result?: Partial<OutlineJobResult>
}

export function isRecoverableOutlineJob(job: Pick<OutlineJob, 'phase' | 'error' | 'receivedChapters' | 'totalEpisodes'>): boolean {
    const interrupted = job.error === TEXT_JOB_EXPIRED_ERROR || /租约.*过期|心跳.*超时|服务重启后任务.*过期/.test(job.error ?? '')
    return job.phase === 'error' && interrupted && job.receivedChapters < job.totalEpisodes
}

function serialize(row: {
    id: bigint
    projectId: bigint
    phase: string | null
    totalEpisodes: number | null
    receivedChapters: number | null
    error: string | null
    result: unknown
    createdAt: Date
    updatedAt: Date
}): OutlineJob {
    return {
        id: row.id.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'generating') as OutlineJobPhase,
        totalEpisodes: row.totalEpisodes ?? 0,
        receivedChapters: row.receivedChapters ?? 0,
        error: row.error ?? undefined,
        result: (row.result as OutlineJobResult | null) ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(projectId: string, totalEpisodes: number): Promise<CreatedOutlineJob> {
    const activeKey = `outline:${projectId}`
    const activePhases = ['generating', 'filling', 'writing_db']
    const now = new Date()
    const staleBefore = new Date(now.getTime() - OUTLINE_JOB_STALE_MS)
    // Older cancellation paths did not always release the unique active key.
    // Clean terminal leftovers before creating the replacement job.
    await prisma.outlineJob.updateMany({
        where: { activeKey, phase: { notIn: activePhases } },
        data: { activeKey: null, leaseOwner: null, leaseExpiresAt: null }
    })
    await prisma.outlineJob.updateMany({
        where: {
            activeKey,
            phase: { in: activePhases },
            OR: [{ leaseExpiresAt: { lt: now } }, { heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
        },
        data: { phase: 'error', error: '任务租约过期，已自动回收，请重试', activeKey: null, leaseOwner: null, leaseExpiresAt: null }
    })
    const existing = await prisma.outlineJob.findFirst({ where: { activeKey, phase: { in: activePhases } } })
    if (existing) return { ...serialize(existing), createdByRequest: false }
    let row
    let createdByRequest = true
    try {
        row = await retryP2002(
            () =>
                prisma.outlineJob.create({
                    data: {
                        id: genId(),
                        projectId: BigInt(projectId),
                        phase: 'generating',
                        totalEpisodes,
                        receivedChapters: 0,
                        activeKey,
                        ...newTextJobLease('outline')
                    }
                }),
            'outlineJobStore.createJob'
        )
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const duplicate = await prisma.outlineJob.findUnique({ where: { activeKey } })
        if (!duplicate) throw error
        row = duplicate
        createdByRequest = false
    }
    return { ...serialize(row), createdByRequest }
}

export async function updateJob(id: string, patch: OutlineJobUpdate): Promise<void> {
    try {
        // A terminal summary must not overwrite response diagnostics saved by
        // earlier batches, retries or chapter-filling calls.
        let result = patch.result
        if (result !== undefined) {
            const current = await prisma.outlineJob.findUnique({ where: { id: BigInt(id) }, select: { result: true } }).catch(() => null)
            const previous = current?.result as OutlineJobResult | null | undefined
            result = { ...previous, ...result }
        }
        const updated = await prisma.outlineJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.totalEpisodes !== undefined ? { totalEpisodes: patch.totalEpisodes } : {}),
                ...(patch.receivedChapters !== undefined ? { receivedChapters: patch.receivedChapters } : {}),
                ...(patch.error !== undefined ? { error: patch.error } : {}),
                ...(result !== undefined ? { result: result as unknown as Prisma.InputJsonValue } : {}),
                ...heartbeatTextJobLease(patch.phase === 'done' || patch.phase === 'error'),
                updatedAt: new Date()
            }
        })
        if (updated.count === 0 && patch.phase === 'writing_db') throw new Error('任务已取消，停止写入')
        if (patch.phase === 'error') {
            const { releaseModelReservations } = await import('@/services/wallet-reservations')
            await releaseModelReservations(`job:${id}`)
        }
    } catch (err) {
        if (err instanceof Error && err.message === '任务已取消，停止写入') throw err
        console.warn(`[outlineJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function cancelJob(id: string, projectId: string, reason = '用户手动取消大纲生成'): Promise<boolean> {
    const idBig = parseApiId(id)
    const projectIdBig = parseApiId(projectId)
    if (idBig === null || projectIdBig === null) return false
    // Outline checkpoints take the same project lock. Waiting for it here
    // guarantees that no delayed checkpoint can commit after cancellation returns.
    const cancelled = await prisma.$transaction(
        async tx => {
            await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectIdBig} FOR UPDATE`
            return tx.outlineJob.updateMany({
                where: { id: idBig, projectId: projectIdBig, phase: { in: ['generating', 'filling', 'writing_db'] } },
                data: {
                    phase: 'cancelled',
                    error: reason,
                    ...heartbeatTextJobLease(true),
                    updatedAt: new Date()
                }
            })
        },
        { timeout: 60_000 }
    )
    if (cancelled.count > 0) {
        const { releaseModelReservations } = await import('@/services/wallet-reservations')
        await releaseModelReservations(`job:${id}`).catch(error => console.warn(`[outlineJobStore] release reservation for cancelled job ${id} failed:`, error))
    }
    return cancelled.count > 0
}

/** Persist each completed upstream response independently of the final job summary. */
export async function appendOutlineHiModelsResponse(id: string, response: HiModelsRawResponse): Promise<void> {
    const current = await prisma.outlineJob.findUnique({ where: { id: BigInt(id) }, select: { result: true } })
    const result = (current?.result ?? {}) as Partial<OutlineJobResult>
    const responses = [...(result.himodelsResponses ?? []), response]
    const dropped = Math.max(0, responses.length - HIMODELS_RAW_RESPONSE_MAX_RECORDS)
    await prisma.outlineJob.updateMany({
        where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
        data: {
            result: {
                ...result,
                himodelsResponses: responses.slice(-HIMODELS_RAW_RESPONSE_MAX_RECORDS),
                himodelsResponsesDropped: (result.himodelsResponsesDropped ?? 0) + dropped
            } as unknown as Prisma.InputJsonValue
        }
    })
}

export async function getJob(id: string): Promise<OutlineJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.outlineJob.findUnique({ where: { id: idBig } })
    const now = new Date()
    const staleBefore = new Date(now.getTime() - OUTLINE_JOB_STALE_MS)
    const heartbeatAt = row?.heartbeatAt ?? row?.updatedAt
    const staleHeartbeat = Boolean(row && ['generating', 'filling', 'writing_db'].includes(row.phase ?? '') && heartbeatAt && heartbeatAt < staleBefore)
    if (row && (isTextJobLeaseExpired(row, ['generating', 'filling', 'writing_db'], now.getTime()) || staleHeartbeat)) {
        await prisma.outlineJob.updateMany({
            where: {
                id: idBig,
                phase: { in: ['generating', 'filling', 'writing_db'] },
                OR: [{ leaseExpiresAt: { lt: now } }, { heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
            },
            data: expiredTextJobLease()
        })
        row = await prisma.outlineJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}

export async function getActiveProjectJob(projectId: bigint): Promise<OutlineJob | undefined> {
    const row = await prisma.outlineJob.findFirst({
        where: { projectId, phase: { in: ['generating', 'filling', 'writing_db'] } },
        orderBy: { updatedAt: 'desc' }
    })
    if (!row) return undefined
    const checked = await getJob(row.id.toString())
    return checked && ['generating', 'filling', 'writing_db'].includes(checked.phase) ? checked : undefined
}

export async function assertJobActive(id: string): Promise<void> {
    const idBig = parseApiId(id)
    if (idBig === null) throw new Error('大纲任务已失效，停止写入')
    const row = await prisma.outlineJob.findFirst({
        where: { id: idBig, phase: { in: ['generating', 'filling', 'writing_db'] } },
        select: { id: true }
    })
    if (!row) throw new Error('大纲任务已失效，停止写入')
}
