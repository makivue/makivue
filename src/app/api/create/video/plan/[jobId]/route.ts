import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { getJob } from '@/lib/projectAiJobStore'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job || job.kind !== 'creator_video_plan' || job.projectId !== userId.toString()) return apiError('任务不存在', 404)
    const response = apiResponse({ phase: job.phase, error: job.error, result: job.phase === 'done' ? job.result : undefined, ...(await readHiModelsUsage(userId, { jobId: job.id })) })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
}
