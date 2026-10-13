import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { retryP2002 } from '@/lib/jobStoreRetry'
import { parseApiId } from '@/lib/api-id'
import { GENERATION_MAX_RETRIES } from '@/lib/generation-retry-policy'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, isUniqueConstraintError, newTextJobLease } from '@/lib/text-job-lease'
import type { HiModelsUsageCall, HiModelsUsageSummary, ProviderTokenUsageCall, ProviderTokenUsageSummary } from '@/lib/himodels-token-usage'
import type { Prisma } from '@/generated/prisma/client'

const CHAPTER_LEASE_MS = 3 * 60 * 1000
const ACTIVE_PHASES = ['generating', 'writing_db']

function chapterLease() {
    const now = new Date()
    return { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + CHAPTER_LEASE_MS) }
}

export class ChapterLeaseLostError extends Error {
    constructor() {
        super('任务已取消，停止写入')
    }
}

type ChapterJobPhase = 'generating' | 'writing_db' | 'done' | 'error'

interface ChapterJobResult {
    generationSourceVersion?: number
    generationOperationVersion?: number
    recoveryCount?: number
    retryRemaining?: number
    episodeId?: string
    chapterContent?: string
    draftContent?: string
    draftSourceVersion?: number
    actualWords?: number
    minimumWords?: number
    targetWords?: number
    repairAttempts?: number
    warning?: string
    reviewStatus?: 'passed' | 'needs_review'
    tokenUsage?: HiModelsUsageSummary | ProviderTokenUsageSummary
    tokenUsageCalls?: ProviderTokenUsageCall[]
    himodelsUsageCalls?: HiModelsUsageCall[]
}

export interface ChapterJob {
    id: string
    episodeId: string
    projectId: string
    phase: ChapterJobPhase
    attempts: number
    leaseOwner?: string
    leaseExpiresAt?: number
    error?: string
    result?: ChapterJobResult
    createdAt: number
    updatedAt: number
}

export interface ChapterJobUpdate {
    phase?: ChapterJobPhase
    attempts?: number
    error?: string
    result?: Partial<ChapterJobResult>
}

function serialize(row: {
    id: bigint
    episodeId: bigint
    projectId: bigint
    phase: string | null
    attempts: number | null
    error: string | null
    result: unknown
    leaseOwner?: string | null
    leaseExpiresAt?: Date | null
    createdAt: Date
    updatedAt: Date
}): ChapterJob {
    return {
        id: row.id.toString(),
        episodeId: row.episodeId.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'generating') as ChapterJobPhase,
        attempts: row.attempts ?? 0,
        leaseOwner: row.leaseOwner ?? undefined,
        leaseExpiresAt: row.leaseExpiresAt?.getTime(),
        error: row.error ?? undefined,
        result: (row.result as ChapterJobResult | null) ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(
    episodeId: string,
    projectId: string,
    versions?: Pick<ChapterJobResult, 'generationSourceVersion' | 'generationOperationVersion'>
): Promise<ChapterJob & { createdByRequest: boolean }> {
    const activeKey = `chapter:${episodeId}`
    await prisma.chapterJob.updateMany({
        where: { activeKey, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
        data: { phase: 'error', error: '任务租约过期，已自动回收，请重试', activeKey: null, leaseOwner: null, leaseExpiresAt: null }
    })
    const existing = await prisma.chapterJob.findFirst({ where: { activeKey } })
    if (existing) return { ...serialize(existing), createdByRequest: false }
    let row
    let createdByRequest = true
    try {
        row = await retryP2002(
            () =>
                prisma.chapterJob.create({
                    data: {
                        id: genId(),
                        episodeId: BigInt(episodeId),
                        projectId: BigInt(projectId),
                        phase: 'generating',
                        attempts: 0,
                        activeKey,
                        result: { ...versions, retryRemaining: GENERATION_MAX_RETRIES, recoveryCount: 0 },
                        ...newTextJobLease('chapter'),
                        ...chapterLease()
                    }
                }),
            'chapterJobStore.createJob'
        )
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const duplicate = await prisma.chapterJob.findUnique({ where: { activeKey } })
        if (!duplicate) throw error
        row = duplicate
        createdByRequest = false
    }
    return { ...serialize(row), createdByRequest }
}

export async function updateJob(id: string, patch: ChapterJobUpdate, leaseOwner?: string): Promise<void> {
    try {
        let result = patch.result
        if (result !== undefined) {
            const current = await prisma.chapterJob.findUnique({ where: { id: BigInt(id) }, select: { result: true } })
            const previous = current?.result as ChapterJobResult | null | undefined
            result = { ...previous, ...result }
        }
        const updated = await prisma.chapterJob.updateMany({
            where: { id: BigInt(id), ...(leaseOwner ? { leaseOwner } : {}), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
                ...(patch.error !== undefined ? { error: patch.error } : {}),
                ...(result !== undefined ? { result: result as unknown as Prisma.InputJsonValue } : {}),
                ...(patch.phase === 'done' || patch.phase === 'error' ? heartbeatTextJobLease(true) : chapterLease()),
                updatedAt: new Date()
            }
        })
        if (updated.count === 0 && leaseOwner) throw new ChapterLeaseLostError()
        if (updated.count === 0 && patch.phase === 'writing_db') throw new Error('任务已取消，停止写入')
        if (patch.phase === 'error') {
            const { releaseModelReservations } = await import('@/services/wallet-reservations')
            await releaseModelReservations(`job:${id}`)
        }
    } catch (err) {
        if (leaseOwner) throw err
        if (err instanceof Error && err.message === '任务已取消，停止写入') throw err
        console.warn(`[chapterJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string, deferExpiry = false): Promise<ChapterJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.chapterJob.findUnique({ where: { id: idBig } })
    if (!deferExpiry && row && isTextJobLeaseExpired(row, ['generating', 'writing_db'])) {
        await prisma.chapterJob.updateMany({
            where: { id: idBig, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
            data: expiredTextJobLease()
        })
        row = await prisma.chapterJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}

/** Only a real executor renews the lease. Pollers may claim one expired job,
 * using a conditional write so concurrent requests/pods cannot start duplicates.
 */
export async function recoverExpiredChapterJob(job: ChapterJob): Promise<{ job: ChapterJob; claimed: boolean }> {
    const now = new Date()
    if (!ACTIVE_PHASES.includes(job.phase) || !job.leaseExpiresAt || job.leaseExpiresAt >= now.getTime()) return { job, claimed: false }
    const where = { id: BigInt(job.id), phase: { in: ACTIVE_PHASES }, leaseOwner: job.leaseOwner, leaseExpiresAt: { lt: now } }
    const canRecover =
        job.result?.generationSourceVersion !== undefined &&
        job.result.generationOperationVersion !== undefined &&
        (job.result.recoveryCount ?? 0) < 1 &&
        (job.result.retryRemaining ?? 0) > 0 &&
        job.attempts < 2
    if (!canRecover) {
        const expired = await prisma.chapterJob.updateMany({ where, data: expiredTextJobLease() })
        if (expired.count) {
            const { releaseModelReservations } = await import('@/services/wallet-reservations')
            await releaseModelReservations(`job:${job.id}`)
        }
        return { job: (await getJob(job.id, true)) ?? job, claimed: false }
    }
    const lease = { ...newTextJobLease('chapter-recovery'), ...chapterLease() }
    const result = { ...job.result, recoveryCount: 1, retryRemaining: 0 }
    const claimed = await prisma.chapterJob.updateMany({ where, data: { phase: 'generating', error: null, ...lease, result: result as unknown as Prisma.InputJsonValue } })
    if (claimed.count !== 1) return { job: (await getJob(job.id, true)) ?? job, claimed: false }
    return { job: { ...job, phase: 'generating', error: undefined, leaseOwner: lease.leaseOwner, leaseExpiresAt: lease.leaseExpiresAt.getTime(), result }, claimed: true }
}
