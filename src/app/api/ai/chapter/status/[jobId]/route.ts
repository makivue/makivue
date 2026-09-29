import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getJob } from '@/lib/chapterJobStore'
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
    const { tokenUsage, tokenUsageCalls, himodelsUsageCalls, ...result } = job.result ?? {}
    const recordedUsage = await readHiModelsUsage(userId, { jobId: job.id })
    const calls = tokenUsageCalls ?? himodelsUsageCalls ?? recordedUsage.tokenUsageCalls
    return apiResponse({
        id: job.id,
        episodeId: job.episodeId,
        phase: job.phase,
        attempts: job.attempts,
        error: job.error,
        tokenUsage: tokenUsage ?? recordedUsage.tokenUsage ?? null,
        tokenUsageCalls: calls,
        himodelsUsageCalls: calls.filter(call => (call.provider ?? 'himodels') === 'himodels'),
        usageTrackingAvailable: tokenUsage ? true : recordedUsage.usageTrackingAvailable,
        result: job.phase === 'done' ? result : undefined
    })
}
