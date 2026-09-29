import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { retryP2002 } from '@/lib/jobStoreRetry'
import { parseApiId } from '@/lib/api-id'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, isUniqueConstraintError, newTextJobLease } from '@/lib/text-job-lease'
import type { HiModelsUsageCall, HiModelsUsageSummary, ProviderTokenUsageCall, ProviderTokenUsageSummary } from '@/lib/himodels-token-usage'
import type { Prisma } from '@/generated/prisma/client'

type ChapterJobPhase = 'generating' | 'writing_db' | 'done' | 'error'

interface ChapterJobResult {
    episodeId?: string
    chapterContent?: string
    actualWords?: number
    minimumWords?: number
    targetWords?: number
    repairAttempts?: number
    warning?: string
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
    createdAt: Date
    updatedAt: Date
}): ChapterJob {
    return {
        id: row.id.toString(),
        episodeId: row.episodeId.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'generating') as ChapterJobPhase,
        attempts: row.attempts ?? 0,
        error: row.error ?? undefined,
        result: (row.result as ChapterJobResult | null) ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(episodeId: string, projectId: string): Promise<ChapterJob & { createdByRequest: boolean }> {
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
                        ...newTextJobLease('chapter')
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

export async function updateJob(id: string, patch: ChapterJobUpdate): Promise<void> {
    try {
        let result = patch.result
        if (result !== undefined) {
            const current = await prisma.chapterJob.findUnique({ where: { id: BigInt(id) }, select: { result: true } }).catch(() => null)
            const previous = current?.result as ChapterJobResult | null | undefined
            result = { ...previous, ...result }
        }
        const updated = await prisma.chapterJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
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
        console.warn(`[chapterJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string): Promise<ChapterJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.chapterJob.findUnique({ where: { id: idBig } })
    if (row && isTextJobLeaseExpired(row, ['generating', 'writing_db'])) {
        await prisma.chapterJob.updateMany({
            where: { id: idBig, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
            data: expiredTextJobLease()
        })
        row = await prisma.chapterJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}
