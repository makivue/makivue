import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { getJob, updateJob } from '@/lib/projectAiJobStore'
import { isStoryDirectionsJobStale, STORY_DIRECTIONS_INTERRUPTED_ERROR } from '@/lib/story-directions-job'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job || job.kind !== 'story_directions' || job.projectId !== userId.toString()) {
        return apiError('Job not found or expired', 404)
    }
    if (job.phase === 'generating' && isStoryDirectionsJobStale(job.updatedAt)) {
        await updateJob(job.id, {
            phase: 'error',
            error: STORY_DIRECTIONS_INTERRUPTED_ERROR
        })
        return apiResponse({ ...(await readHiModelsUsage(userId, { jobId: job.id })), id: job.id, phase: 'error', error: STORY_DIRECTIONS_INTERRUPTED_ERROR })
    }
    return apiResponse({ ...(await readHiModelsUsage(userId, { jobId: job.id })), id: job.id, phase: job.phase, error: job.error, result: job.phase === 'done' ? job.result : undefined })
}
