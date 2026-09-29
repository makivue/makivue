import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { getJob } from '@/lib/projectAiJobStore'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string; jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, jobId } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('invalid project id', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard
    const job = await getJob(jobId)
    if (!job || job.kind !== 'style_reference' || job.projectId !== id) return apiError('Job not found or expired', 404)
    return apiResponse({ ...(await readHiModelsUsage(userId, { jobId: job.id })), id: job.id, phase: job.phase, error: job.error, result: job.phase === 'done' ? job.result : undefined })
}
