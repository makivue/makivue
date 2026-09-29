import type { ExtractedCharacter, ExtractedScene } from '@/services/llm'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { parseApiId } from '@/lib/api-id'
import type { Prisma } from '@/generated/prisma/client'

type ExtractJobPhase = 'analyzing' | 'merging' | 'done' | 'error'

interface ExtractJobResult {
    characters: Array<ExtractedCharacter & { frequency: number }>
    scenes: Array<ExtractedScene & { frequency: number }>
    chunkCount: number
}

export interface ExtractJob {
    id: string
    projectId: string
    phase: ExtractJobPhase
    chunksDone: number
    chunksTotal: number
    charactersFound: number
    scenesFound: number
    error?: string
    result?: ExtractJobResult
    createdAt: number
    updatedAt: number
}

export interface ExtractJobUpdate {
    phase?: ExtractJobPhase
    chunksDone?: number
    chunksTotal?: number
    charactersFound?: number
    scenesFound?: number
    error?: string
    result?: ExtractJobResult
}

function serialize(row: {
    id: bigint
    projectId: bigint
    phase: string | null
    chunksDone: number | null
    chunksTotal: number | null
    charactersFound: number | null
    scenesFound: number | null
    error: string | null
    resultCharacters: unknown
    resultScenes: unknown
    createdAt: Date
    updatedAt: Date
}): ExtractJob {
    const characters = (row.resultCharacters as ExtractJobResult['characters'] | null) ?? null
    const scenes = (row.resultScenes as ExtractJobResult['scenes'] | null) ?? null
    return {
        id: row.id.toString(),
        projectId: row.projectId.toString(),
        phase: (row.phase ?? 'analyzing') as ExtractJobPhase,
        chunksDone: row.chunksDone ?? 0,
        chunksTotal: row.chunksTotal ?? 0,
        charactersFound: row.charactersFound ?? 0,
        scenesFound: row.scenesFound ?? 0,
        error: row.error ?? undefined,
        result: characters && scenes ? { characters, scenes, chunkCount: row.chunksTotal ?? 0 } : undefined,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime()
    }
}

// A single extraction batch has a 75s provider timeout and three controlled
// attempts. Six minutes without a checkpoint therefore means the worker is no
// longer alive, not merely slow.
const ACTIVE_JOB_STALE_MS = 6 * 60 * 1000

const STALE_JOB_ERROR = '后台任务已中断，请点击“重新提取”。'
const STALE_CHECKPOINT_JOB_ERROR = '后台任务已中断，已完成进度已保存。请点击“继续提取”，系统会从上次完成的批次继续。'

export async function getActiveJob(projectId: string, activeKey?: string): Promise<ExtractJob | undefined> {
    const staleBefore = new Date(Date.now() - ACTIVE_JOB_STALE_MS)
    const row = await prisma.extractJob.findFirst({
        where: {
            projectId: BigInt(projectId),
            ...(activeKey ? { activeKey } : {}),
            OR: [
                { phase: { in: ['analyzing', 'merging'] }, updatedAt: { gte: staleBefore } },
                { phase: 'done', committedAt: null }
            ]
        },
        orderBy: { createdAt: 'desc' }
    })
    return row ? serialize(row) : undefined
}

export async function createOrReuseActiveJob(projectId: string, resumeFromJobId?: string, activeKey?: string): Promise<{ job: ExtractJob; resumed: boolean }> {
    const projectIdBig = BigInt(projectId)
    let resumeFromJobIdBig: bigint | undefined
    try {
        resumeFromJobIdBig = resumeFromJobId ? BigInt(resumeFromJobId) : undefined
    } catch {
        resumeFromJobIdBig = undefined
    }
    return prisma.$transaction(async tx => {
        // 串行化同一项目的“检查 + 创建”，避免双击或两个浏览器标签同时创建重复提取任务。
        await tx.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM projects WHERE id = ${projectIdBig} FOR UPDATE
        `
        // 旧版本在状态轮询发现任务超时时，只把 phase 改成 error，未释放
        // active_key。相同剧本再次提取会因此永久撞唯一索引。创建前顺手修复
        // 这类遗留终态记录，让已有项目无需人工清库即可恢复。
        if (activeKey) {
            await tx.extractJob.updateMany({
                where: {
                    activeKey,
                    OR: [{ phase: 'error' }, { phase: 'done', committedAt: { not: null } }]
                },
                data: { activeKey: null, leaseOwner: null, leaseExpiresAt: null }
            })
        }
        const staleBefore = new Date(Date.now() - ACTIVE_JOB_STALE_MS)
        const active = await tx.extractJob.findFirst({
            where: {
                projectId: projectIdBig,
                ...(activeKey ? { activeKey } : {}),
                OR: [
                    { phase: { in: ['analyzing', 'merging'] }, updatedAt: { gte: staleBefore } },
                    { phase: 'done', committedAt: null }
                ]
            },
            orderBy: { createdAt: 'desc' }
        })
        if (active) return { job: serialize(active), resumed: true }

        const interrupted = await tx.extractJob.findFirst({
            where: {
                projectId: projectIdBig,
                phase: { in: ['analyzing', 'merging'] },
                updatedAt: { lt: staleBefore }
            },
            orderBy: { createdAt: 'desc' }
        })
        await tx.extractJob.updateMany({
            where: {
                projectId: projectIdBig,
                phase: { in: ['analyzing', 'merging'] },
                updatedAt: { lt: staleBefore }
            },
            data: { phase: 'error', error: STALE_JOB_ERROR, activeKey: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() }
        })
        // Resume only the job that was just interrupted. Reusing an older
        // failed extraction could mix checkpoints from a previous script.
        const requestedCheckpoint = resumeFromJobIdBig
            ? await tx.extractJob.findFirst({
                  where: {
                      id: resumeFromJobIdBig,
                      projectId: projectIdBig,
                      phase: 'error',
                      chunksDone: { gt: 0 }
                  }
              })
            : null
        const checkpointCandidate = requestedCheckpoint ?? interrupted
        const checkpoint =
            checkpointCandidate && (checkpointCandidate.chunksDone ?? 0) > 0 && checkpointCandidate.resultCharacters !== null && checkpointCandidate.resultScenes !== null ? checkpointCandidate : null
        const created = await tx.extractJob.create({
            data: {
                id: genId(),
                projectId: projectIdBig,
                phase: 'analyzing',
                chunksDone: checkpoint?.chunksDone ?? 0,
                chunksTotal: checkpoint?.chunksTotal ?? 0,
                charactersFound: 0,
                scenesFound: 0,
                resultCharacters: checkpoint?.resultCharacters ?? undefined,
                resultScenes: checkpoint?.resultScenes ?? undefined,
                activeKey,
                leaseOwner: `extract:${process.pid}`,
                leaseExpiresAt: new Date(Date.now() + ACTIVE_JOB_STALE_MS),
                heartbeatAt: new Date()
            }
        })
        return { job: serialize(created), resumed: false }
    })
}

export async function updateJob(id: string, patch: ExtractJobUpdate, transaction?: Prisma.TransactionClient): Promise<void> {
    try {
        const data: Record<string, unknown> = { updatedAt: new Date(), heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + ACTIVE_JOB_STALE_MS) }
        if (patch.phase !== undefined) data.phase = patch.phase
        if (patch.chunksDone !== undefined) data.chunksDone = patch.chunksDone
        if (patch.chunksTotal !== undefined) data.chunksTotal = patch.chunksTotal
        if (patch.charactersFound !== undefined) data.charactersFound = patch.charactersFound
        if (patch.scenesFound !== undefined) data.scenesFound = patch.scenesFound
        if (patch.error !== undefined) data.error = patch.error
        if (patch.result !== undefined) {
            data.resultCharacters = patch.result.characters as unknown as object
            data.resultScenes = patch.result.scenes as unknown as object
        }
        if (patch.phase === 'error') {
            data.activeKey = null
            data.leaseOwner = null
            data.leaseExpiresAt = null
        }
        if (patch.phase === 'done') {
            data.leaseOwner = null
            data.leaseExpiresAt = null
        }
        const updated = await (transaction ?? prisma).extractJob.updateMany({
            where: { id: BigInt(id), phase: { notIn: ['cancelled', 'done', 'error'] } },
            data
        })
        if (updated.count === 0 && (patch.phase === 'merging' || transaction)) throw new Error('任务已取消，停止写入')
        if (patch.phase === 'error') {
            const { releaseModelReservations } = await import('@/services/wallet-reservations')
            await releaseModelReservations(`job:${id}`)
        }
    } catch (err) {
        if (transaction) throw err
        if (err instanceof Error && err.message === '任务已取消，停止写入') throw err
        console.warn(`[extractJobStore] updateJob(${id}) failed:`, err)
    }
}

export async function getJob(id: string): Promise<ExtractJob | undefined> {
    const idBig = parseApiId(id)
    if (idBig === null) return undefined
    let row = await prisma.extractJob.findUnique({ where: { id: idBig } })
    if (row && (row.phase === 'analyzing' || row.phase === 'merging') && row.updatedAt.getTime() < Date.now() - ACTIVE_JOB_STALE_MS) {
        const checkpointAvailable = (row.chunksDone ?? 0) > 0 && row.resultCharacters !== null && row.resultScenes !== null
        await prisma.extractJob.updateMany({
            where: {
                id: idBig,
                phase: { in: ['analyzing', 'merging'] },
                updatedAt: row.updatedAt
            },
            data: {
                phase: 'error',
                error: checkpointAvailable ? STALE_CHECKPOINT_JOB_ERROR : STALE_JOB_ERROR,
                activeKey: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                updatedAt: new Date()
            }
        })
        row = await prisma.extractJob.findUnique({ where: { id: idBig } })
    }
    return row ? serialize(row) : undefined
}
