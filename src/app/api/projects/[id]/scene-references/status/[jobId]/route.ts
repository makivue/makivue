import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertProjectOwner } from '@/lib/ownership'
import { apiError, apiResponse } from '@/lib/utils'
import { getJob, getLatestJob } from '@/lib/projectAiJobStore'
import { getJobs } from '@/lib/refImageJobStore'
import { isSceneReferenceBatchPayload } from '@/services/scene-reference-batch'

type Params = { params: Promise<{ id: string; jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, jobId } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard
    const job = jobId === 'latest' ? await getLatestJob(id, 'scene_references') : await getJob(jobId)
    if (!job && jobId === 'latest') return apiResponse(null)
    if (!job || job.projectId !== projectId.toString() || job.kind !== 'scene_references') return apiError('Job not found', 404)
    const payload = isSceneReferenceBatchPayload(job.result) ? job.result : null
    const children = payload ? await getJobs(payload.items.map(item => item.jobId)) : []
    const childById = new Map(children.map(child => [child.id, child]))
    const items = (payload?.items ?? []).map(item => {
        const child = childById.get(item.jobId)
        const interrupted = ['error', 'cancelled'].includes(job.phase) && child && !['done', 'error', 'cancelled'].includes(child.phase)
        const phase = interrupted ? job.phase : (child?.phase ?? 'error')
        return {
            ...item,
            phase,
            error: interrupted ? (job.error ?? '批次已停止') : (child?.error ?? (!child ? '参考图子任务不存在' : undefined)),
            progress: child?.result && 'progress' in child.result ? child.result.progress : undefined,
            result: phase === 'done' ? child?.result : undefined
        }
    })
    const completed = items.filter(item => ['done', 'error', 'cancelled'].includes(item.phase)).length
    const failed = items.filter(item => ['error', 'cancelled'].includes(item.phase)).length
    return apiResponse({
        id: job.id,
        phase: items.length > 0 && completed === items.length && job.phase !== 'error' && job.phase !== 'cancelled' ? 'done' : job.phase,
        total: job.total,
        completed,
        failed,
        error: job.error,
        quality: payload?.quality,
        mode: payload?.mode,
        items
    })
}
