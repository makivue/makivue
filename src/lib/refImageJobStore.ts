import { parseApiId } from '@/lib/api-id'
import { genId } from '@/lib/id'
import type { ImageGenerationRecovery, ImageProviderSwitch } from '@/lib/image-generation-recovery'
import { isP2002Error, retryP2002 } from '@/lib/jobStoreRetry'
import { prisma } from '@/lib/prisma'
import { isRefImageJobLeaseExpired, REF_IMAGE_STALE_WINDOW_MS, type ReferenceGenerationProgress, type ReferenceGenerationTimings } from '@/lib/reference-generation-progress'

type RefImageJobPhase = 'queued' | 'generating' | 'writing_db' | 'done' | 'error' | 'cancelled'
export type RefImageTargetType = 'character' | 'scene'

interface RefImageJobResult {
    targetType: RefImageTargetType
    targetId: string
    candidateUrl: string
    referenceImageUrl: string | null
    referenceCandidates: string[]
    /** Scene reference views selected together for downstream generation. */
    selectedReferenceUrls?: string[]
    /** Actual image provider after server-side style routing. */
    provider?: string
    requestedProvider?: string
    recovery?: ImageGenerationRecovery
    fallbackReason?: string
    providerSwitch?: ImageProviderSwitch
    /** Advisory quality note when a usable best-effort image was retained. */
    inspectionWarning?: string
    /** Registered prompt policy used for this reference generation. */
    promptVersion?: string
    /** Reference asset role; legacy roles are retained when reading existing local records. */
    role?: string
    /** Script/storyboard visual-state ledger entry represented by this asset. */
    stateKey?: string
    /** Server-side stage timings for diagnosing slow reference generation. */
    timings?: ReferenceGenerationTimings
}

interface RefImageJobProgressResult {
    progress: ReferenceGenerationProgress
}

type RefImageJobPayload = RefImageJobResult | RefImageJobProgressResult

export interface RefImageJob {
    id: string
    targetType: RefImageTargetType
    targetId: string
    projectId: string
    phase: RefImageJobPhase
    attempts: number
    error?: string
    result?: RefImageJobPayload
    createdAt: number
    updatedAt: number
}

export type CreatedRefImageJob = RefImageJob & { reused: boolean }

export interface RefImageJobUpdate {
    phase?: RefImageJobPhase
    attempts?: number
    error?: string
    result?: RefImageJobPayload
}

function serialize(row: {
    id: bigint
    targetType: string
    targetId: bigint
    projectId: bigint
    phase: string | null
    attempts: number | null
    error: string | null
    result: unknown
    createdAt: Date
    updatedAt: Date
}): RefImageJob {
    return {
        id: row.id.toString(),
        targetType: row.targetType as RefImageTargetType,
        targetId: row.targetId.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'generating') as RefImageJobPhase,
        attempts: row.attempts ?? 0,
        error: row.error ?? undefined,
        result: (row.result as RefImageJobPayload | null) ?? undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

export async function createJob(
    targetType: RefImageTargetType,
    targetId: string,
    projectId: string,
    options: { promptVersion?: string; provider?: string; quality?: string; role?: string; mode?: string; requestId?: string } = {}
): Promise<CreatedRefImageJob> {
    const activeKey = [
        targetType,
        targetId,
        options.role ?? 'default',
        options.promptVersion ?? 'unknown',
        options.provider ?? 'default',
        options.quality ?? 'standard',
        options.mode ?? 'candidate',
        options.requestId ?? 'shared'
    ].join(':')
    const now = new Date()
    const legacyStaleBefore = new Date(now.getTime() - REF_IMAGE_STALE_WINDOW_MS)
    let reused = false
    let row
    try {
        row = await prisma.$transaction(async tx => {
            await tx.refImageJob.updateMany({
                where: {
                    activeKey,
                    phase: { in: ['queued', 'generating', 'writing_db'] },
                    OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null, updatedAt: { lt: legacyStaleBefore } }]
                },
                data: { phase: 'error', error: '图片任务超过 2 分钟没有心跳，已自动回收，请重试', activeKey: null, leaseOwner: null, leaseExpiresAt: null }
            })
            const existing = await tx.refImageJob.findFirst({ where: { activeKey, phase: { in: ['queued', 'generating', 'writing_db'] } }, orderBy: { updatedAt: 'desc' } })
            if (existing) {
                reused = true
                return existing
            }
            return retryP2002(
                () =>
                    tx.refImageJob.create({
                        data: {
                            id: genId(),
                            targetType,
                            targetId: BigInt(targetId),
                            projectId: BigInt(projectId),
                            phase: 'queued',
                            attempts: 0,
                            promptVersion: options.promptVersion,
                            provider: options.provider,
                            quality: options.quality,
                            activeKey,
                            leaseOwner: null,
                            leaseExpiresAt: null,
                            heartbeatAt: null
                        }
                    }),
                'refImageJobStore.createJob'
            )
        })
    } catch (error) {
        if (!isP2002Error(error)) throw error
        const duplicate = await prisma.refImageJob.findUnique({ where: { activeKey } })
        if (!duplicate) throw error
        reused = true
        row = duplicate
    }
    return { ...serialize(row), reused }
}

export async function updateJob(id: string, patch: RefImageJobUpdate): Promise<void> {
    try {
        const updated = await prisma.refImageJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data: {
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
                ...(patch.error !== undefined ? { error: patch.error } : {}),
                ...(patch.result !== undefined ? { result: patch.result as unknown as object } : {}),
                ...(patch.phase === 'done' || patch.phase === 'error' || patch.phase === 'cancelled'
                    ? { activeKey: null, leaseOwner: null, leaseExpiresAt: null }
                    : { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + REF_IMAGE_STALE_WINDOW_MS) }),
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
        console.warn(`[refImageJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string): Promise<RefImageJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.refImageJob.findUnique({ where: { id: idBig } })
    const now = new Date()
    const legacyStaleBefore = new Date(now.getTime() - REF_IMAGE_STALE_WINDOW_MS)
    if (row && ['queued', 'generating', 'writing_db'].includes(row.phase ?? '') && isRefImageJobLeaseExpired(row, now.getTime())) {
        const recovered = await prisma.refImageJob.updateMany({
            where: {
                id: idBig,
                phase: { in: ['queued', 'generating', 'writing_db'] },
                OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null, updatedAt: { lt: legacyStaleBefore } }]
            },
            data: {
                phase: 'error',
                error: '图片任务超过 2 分钟没有心跳，已自动回收，请重试',
                activeKey: null,
                leaseOwner: null,
                leaseExpiresAt: null
            }
        })
        if (recovered.count > 0) row = await prisma.refImageJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}

/**
 * Loads a batch of reference jobs with one query and recovers stale rows with
 * at most one update plus one refresh query. The returned order matches ids.
 */
export async function getJobs(ids: readonly string[]): Promise<RefImageJob[]> {
    const parsedIds = [...new Set(ids.map(parseApiId).filter((id): id is bigint => id !== null))]
    if (parsedIds.length === 0) return []

    let rows = await prisma.refImageJob.findMany({ where: { id: { in: parsedIds } } })
    const now = new Date()
    const legacyStaleBefore = new Date(now.getTime() - REF_IMAGE_STALE_WINDOW_MS)
    const staleIds = rows.filter(row => ['queued', 'generating', 'writing_db'].includes(row.phase ?? '') && isRefImageJobLeaseExpired(row, now.getTime())).map(row => row.id)
    if (staleIds.length > 0) {
        const recovered = await prisma.refImageJob.updateMany({
            where: {
                id: { in: staleIds },
                phase: { in: ['queued', 'generating', 'writing_db'] },
                OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null, updatedAt: { lt: legacyStaleBefore } }]
            },
            data: {
                phase: 'error',
                error: '图片任务超过 2 分钟没有心跳，已自动回收，请重试',
                activeKey: null,
                leaseOwner: null,
                leaseExpiresAt: null
            }
        })
        if (recovered.count > 0) rows = await prisma.refImageJob.findMany({ where: { id: { in: parsedIds } } })
    }

    const byId = new Map(rows.map(row => [row.id.toString(), serialize(row)]))
    return ids.flatMap(id => {
        const job = byId.get(id)
        return job ? [job] : []
    })
}

/** Keeps batch-owned queued rows alive while earlier items use the workers. */
export async function heartbeatQueuedJobs(ids: readonly string[]): Promise<void> {
    const parsedIds = [...new Set(ids.map(parseApiId).filter((id): id is bigint => id !== null))]
    if (parsedIds.length === 0) return
    const now = new Date()
    await prisma.refImageJob.updateMany({
        where: { id: { in: parsedIds }, phase: 'queued' },
        data: { heartbeatAt: now, updatedAt: now }
    })
}
