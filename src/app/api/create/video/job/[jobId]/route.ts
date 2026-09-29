import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { getJob } from '@/lib/projectAiJobStore'
import { apiError, apiResponse } from '@/lib/utils'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job || job.kind !== 'creator_video' || job.projectId !== userId.toString()) return apiError('视频任务不存在', 404)
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        phase: job.phase,
        error: job.error,
        // Provider submission finishes before the video itself. Expose the
        // task ID while the creator slot remains active until final delivery.
        result: job.result
    })
}
