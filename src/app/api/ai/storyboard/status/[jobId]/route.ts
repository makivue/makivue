import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getJob } from '@/lib/storyboardJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    const guard = await assertEpisodeOwner(BigInt(job.episodeId), userId)
    if (guard) return guard
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        id: job.id,
        episodeId: job.episodeId,
        phase: job.phase,
        attempts: job.attempts,
        error: job.error,
        result: job.phase === 'done' || job.phase === 'cancelled' ? job.result : undefined
    })
}
