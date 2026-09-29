import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getJob } from '@/lib/refImageJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertSceneOwner } from '@/lib/ownership'

type Params = { params: Promise<{ id: string; jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, jobId } = await params
    const job = await getJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    if (job.targetType !== 'scene' || job.targetId !== id) return apiError('Job does not belong to this scene', 400)
    const guard = await assertSceneOwner(BigInt(job.targetId), userId)
    if (guard) return guard
    const progress = job.result && 'progress' in job.result ? job.result.progress : undefined
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        id: job.id,
        targetId: job.targetId,
        phase: job.phase,
        attempts: job.attempts,
        error: job.error,
        progress,
        result: job.phase === 'done' ? job.result : undefined
    })
}
