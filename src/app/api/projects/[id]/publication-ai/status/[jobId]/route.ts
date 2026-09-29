import { NextRequest } from 'next/server'
import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { assertProjectOwner } from '@/lib/ownership'
import { getJob } from '@/lib/projectAiJobStore'
import { apiError, apiResponse } from '@/lib/utils'

type Params = { params: Promise<{ id: string; jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, jobId } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard
    const job = await getJob(jobId)
    if (!job || !['publication_metadata', 'publication_covers'].includes(job.kind) || job.projectId !== id) return apiError('Job not found or expired', 404)
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        id: job.id,
        kind: job.kind,
        phase: job.phase,
        progress: job.progress,
        total: job.total,
        error: job.error,
        result: job.phase === 'done' ? job.result : undefined
    })
}
