import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getJob } from '@/lib/projectAiJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    if (job.kind !== 'expand_prompt') return apiError('Job kind mismatch', 400)
    const guard = await assertProjectOwner(BigInt(job.projectId), userId)
    if (guard) return guard
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        id: job.id,
        projectId: job.projectId,
        phase: job.phase,
        attempts: job.attempts,
        error: job.error,
        result: job.phase === 'done' ? job.result : undefined
    })
}
