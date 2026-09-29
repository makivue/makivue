import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { parseApiId } from '@/lib/api-id'
import { assertProjectOwner } from '@/lib/ownership'
import { getJob as getProjectJob, getLatestJob } from '@/lib/projectAiJobStore'
import { getJobs } from '@/lib/refImageJobStore'
import { isCharacterReferenceBatchPayload } from '@/services/character-reference-batch'

type Params = { params: Promise<{ id: string; jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, jobId } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const job = jobId === 'latest' ? await getLatestJob(projectId.toString(), 'character_references') : await getProjectJob(jobId)
    if (jobId === 'latest' && (!job || job.phase === 'cancelled')) return apiResponse(null)
    if (!job || job.kind !== 'character_references' || job.projectId !== projectId.toString()) return apiError('Job not found or expired', 404)
    if (!isCharacterReferenceBatchPayload(job.result)) {
        return apiResponse({
            ...(await readHiModelsUsage(userId, { jobId: job.id })),
            id: job.id,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            phase: job.phase,
            error: job.error,
            total: job.total,
            completed: 0,
            failed: job.phase === 'error' || job.phase === 'cancelled' ? job.total : 0,
            queued: 0,
            active: 0,
            items: []
        })
    }

    const childJobs = await getJobs(job.result.items.map(item => item.jobId))
    const childById = new Map(childJobs.map(child => [child.id, child]))
    const items = job.result.items.map(item => {
        const child = childById.get(item.jobId)
        const missing = !child
        const interrupted = ['error', 'cancelled'].includes(job.phase) && child && !['done', 'error', 'cancelled'].includes(child.phase)
        const phase = interrupted ? job.phase : (child?.phase ?? 'error')
        return {
            ...item,
            phase,
            attempts: child?.attempts ?? 0,
            error: interrupted ? (job.error ?? '角色参考图批次失败') : (child?.error ?? (missing ? '参考图子任务不存在' : undefined)),
            progress: child?.result && 'progress' in child.result ? child.result.progress : undefined,
            result: phase === 'done' ? child?.result : undefined
        }
    })
    const completed = items.filter(item => ['done', 'error', 'cancelled'].includes(item.phase)).length
    const failed = items.filter(item => item.phase === 'error' || item.phase === 'cancelled').length
    const queued = items.filter(item => item.phase === 'queued').length
    const active = items.filter(item => item.phase === 'generating' || item.phase === 'writing_db').length
    const phase = items.length > 0 && completed === items.length && !['error', 'cancelled'].includes(job.phase) ? 'done' : job.phase

    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        id: job.id,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        phase,
        error: job.error,
        total: items.length,
        completed,
        failed,
        queued,
        active,
        concurrency: job.result.concurrency,
        quality: job.result.quality,
        mode: job.result.mode ?? (job.result.replaceSelected ? 'all' : 'missing'),
        replaceSelected: job.result.replaceSelected,
        items
    })
}
