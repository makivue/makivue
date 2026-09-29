import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { retryP2002 } from '@/lib/jobStoreRetry'
import { parseApiId } from '@/lib/api-id'
import { expiredTextJobLease, heartbeatTextJobLease, isTextJobLeaseExpired, isUniqueConstraintError, newTextJobLease } from '@/lib/text-job-lease'

type ScriptJobPhase = 'generating' | 'writing_db' | 'done' | 'error'

interface ScriptJobResult {
    episodeId: string
    episodeNumber: number
    title: string | null
    synopsis: string | null
    script: string
    allScripted: boolean
}

export interface ScriptJob {
    id: string
    episodeId: string
    projectId: string
    phase: ScriptJobPhase
    attempts: number
    error?: string
    result?: ScriptJobResult
    createdAt: number
    updatedAt: number
}

export interface ScriptJobUpdate {
    phase?: ScriptJobPhase
    attempts?: number
    error?: string
    result?: ScriptJobResult
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
}): ScriptJob {
    return {
        id: row.id.toString(),
        episodeId: row.episodeId.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'generating') as ScriptJobPhase,
        attempts: row.attempts ?? 0,
        error: row.error ?? undefined,
        result: (row.result as ScriptJobResult | null) ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(episodeId: string, projectId: string): Promise<ScriptJob & { createdByRequest: boolean }> {
    const activeKey = `script:${episodeId}`
    await prisma.scriptJob.updateMany({
        where: { activeKey, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
        data: { phase: 'error', error: '任务租约过期，已自动回收，请重试', activeKey: null, leaseOwner: null, leaseExpiresAt: null }
    })
    const existing = await prisma.scriptJob.findFirst({ where: { activeKey } })
    if (existing) return { ...serialize(existing), createdByRequest: false }
    let row
    let createdByRequest = true
    try {
        row = await retryP2002(
            () =>
                prisma.scriptJob.create({
                    data: {
                        id: genId(),
                        episodeId: BigInt(episodeId),
                        projectId: BigInt(projectId),
                        phase: 'generating',
                        attempts: 0,
                        activeKey,
                        ...newTextJobLease('script')
                    }
                }),
            'scriptJobStore.createJob'
        )
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const duplicate = await prisma.scriptJob.findUnique({ where: { activeKey } })
        if (!duplicate) throw error
        row = duplicate
        createdByRequest = false
    }
    return { ...serialize(row), createdByRequest }
}

export async function updateJob(id: string, patch: ScriptJobUpdate): Promise<void> {
    try {
        const updated = await prisma.scriptJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
                ...(patch.error !== undefined ? { error: patch.error } : {}),
                ...(patch.result !== undefined ? { result: patch.result as unknown as object } : {}),
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
        console.warn(`[scriptJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string): Promise<ScriptJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.scriptJob.findUnique({ where: { id: idBig } })
    if (row && isTextJobLeaseExpired(row, ['generating', 'writing_db'])) {
        await prisma.scriptJob.updateMany({
            where: { id: idBig, phase: { in: ['generating', 'writing_db'] }, leaseExpiresAt: { lt: new Date() } },
            data: expiredTextJobLease()
        })
        row = await prisma.scriptJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}
