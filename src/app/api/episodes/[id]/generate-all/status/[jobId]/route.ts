import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getEpJob } from '@/lib/episodeJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string; jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id: episodeId, jobId } = await params
    const episodeIdNum = parseApiId(episodeId)
    if (episodeIdNum === null) return apiError('invalid episode id', 400)
    const guard = await assertEpisodeOwner(episodeIdNum, userId)
    if (guard) return guard
    const job = await getEpJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    if (job.episodeId !== episodeIdNum.toString()) return apiError('Job does not belong to this episode', 404)
    return apiResponse({ ...job, ...(req.nextUrl.searchParams.get('view') === 'progress' ? {} : await readHiModelsUsage(userId, { jobId: job.id })) })
}
