import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import type { ProjectAiJob } from '@/generated/prisma/client'
import { runLocalReplica, pollLocalReplicaVideo } from '@/services/local-replica'

export type ReplicaMode = 'full' | 'analyze' | 'clip'
export interface ReplicaJobResponse {
    code?: number
    message?: string
    taskId: string
    status: string
}
export interface ReplicaJobStatus extends ReplicaJobResponse {
    mode: string
    progress: number
    currentStage?: string
    stageMessage?: string
    createdAt?: string
    updatedAt?: string
    errorMessage?: string
    resultJson?: string
}
export interface ReplicaJobList {
    items: ReplicaJobStatus[]
    total: number
}
export interface ReplicaExport {
    content: string
    filename: string
    contentType: string
}
export type ReplicaData = { payload: Record<string, unknown>; output?: Record<string, unknown>; providerTask?: { id: string; provider: string }; mode: ReplicaMode }
function serialize(row: ProjectAiJob): ReplicaJobStatus {
    const data = row.result as unknown as ReplicaData
    return {
        taskId: String(row.id),
        status: row.phase === 'done' ? 'completed' : row.phase === 'error' ? 'failed' : 'processing',
        mode: data.mode,
        progress: row.progress ?? 0,
        currentStage: row.phase ?? 'queued',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        errorMessage: row.error ?? undefined,
        resultJson: JSON.stringify(data.output ?? {})
    }
}
export async function submitReplicaJob(mode: ReplicaMode, payload: Record<string, unknown>, _clientIp?: string): Promise<ReplicaJobResponse> {
    void _clientIp

    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('视频分析需要在 .env 配置 OPENAI_API_KEY 和支持视觉的 OPENAI_VISION_MODEL')
    const row = await prisma.projectAiJob.create({ data: { id: genId(), projectId: 1n, kind: 'local_replica', phase: 'queued', result: { mode, payload } as object } })
    return serialize(row)
}
export async function processReplicaJob(taskId: string) {
    const claimed = await prisma.projectAiJob.updateMany({
        where: { id: BigInt(taskId), kind: 'local_replica', phase: 'queued' },
        data: { phase: 'processing', leaseExpiresAt: new Date(Date.now() + 30 * 60_000), updatedAt: new Date() }
    })
    if (claimed.count !== 1) return
    const row = await prisma.projectAiJob.findUniqueOrThrow({ where: { id: BigInt(taskId) } })
    try {
        const data = await runLocalReplica(taskId, row.result as unknown as ReplicaData)
        await prisma.projectAiJob.update({
            where: { id: row.id },
            data: { result: data as object, phase: data.providerTask ? 'waiting_video' : 'done', progress: data.providerTask ? 60 : 100, updatedAt: new Date() }
        })
    } catch (error) {
        await prisma.projectAiJob.update({ where: { id: row.id }, data: { phase: 'error', error: error instanceof Error ? error.message : '本地复刻失败', updatedAt: new Date() } })
    }
}
export async function listReplicaJobs(query: { page?: number; perPage?: number; status?: string; mode?: string }, _clientIp?: string): Promise<ReplicaJobList> {
    void _clientIp

    const all = (await prisma.projectAiJob.findMany({ where: { kind: 'local_replica' }, orderBy: { createdAt: 'desc' } }))
        .map(serialize)
        .filter(row => (!query.mode || query.mode === row.mode) && (!query.status || query.status === row.status))
    const count = Math.min(50, Math.max(1, query.perPage || 20)),
        start = (Math.max(1, query.page || 1) - 1) * count
    return { items: all.slice(start, start + count), total: all.length }
}
export async function getReplicaJob(taskId: string, _clientIp?: string): Promise<ReplicaJobStatus> {
    void _clientIp

    if (!/^\d{1,19}$/.test(taskId)) throw new Error('无效任务编号')
    let row = await prisma.projectAiJob.findFirstOrThrow({ where: { id: BigInt(taskId), kind: 'local_replica' } })
    if (row.phase === 'waiting_video') {
        // A file transaction claims polling; another tab/process can only observe it.
        const now = new Date()
        const claimed = await prisma.projectAiJob.updateMany({
            where: { id: row.id, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: now } }] },
            data: { nextAttemptAt: new Date(Date.now() + 180_000) }
        })
        if (claimed.count) {
            try {
                const data = await pollLocalReplicaVideo(taskId, row.result as unknown as ReplicaData)
                row = await prisma.projectAiJob.update({
                    where: { id: row.id },
                    data: {
                        result: data as object,
                        phase: data.providerTask ? 'waiting_video' : 'done',
                        progress: data.providerTask ? 70 : 100,
                        nextAttemptAt: new Date(Date.now() + 5_000),
                        updatedAt: new Date()
                    }
                })
            } catch (error) {
                row = await prisma.projectAiJob.update({
                    where: { id: row.id },
                    data: {
                        phase: error instanceof Error && error.message === '供应商视频生成失败' ? 'error' : 'waiting_video',
                        error: error instanceof Error ? error.message : '视频查询失败',
                        nextAttemptAt: new Date(Date.now() + 15_000),
                        updatedAt: new Date()
                    }
                })
            }
        }
    } else if (row.phase === 'processing' && row.leaseExpiresAt && row.leaseExpiresAt < new Date()) {
        row = await prisma.projectAiJob.update({ where: { id: row.id }, data: { phase: 'error', error: '本地处理已中断，请重新提交；不会自动重复调用收费模型。' } })
    }
    return serialize(row)
}
export async function exportReplicaJob(taskId: string, format: string, _clientIp?: string): Promise<ReplicaExport> {
    void _clientIp

    const row = await getReplicaJob(taskId)
    if (row.status !== 'completed') throw new Error('请等待任务完成后导出')
    const output = JSON.parse(row.resultJson || '{}')
    const content = format === 'json' ? JSON.stringify(output, null, 2) : format === 'script' ? String(output.script ?? output.summary ?? '') : String(output.srt ?? '')
    if (!content) throw new Error('当前结果没有可导出的字幕')
    return { content, filename: `replica-${taskId}.${format === 'script' ? 'txt' : format}`, contentType: format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' }
}
