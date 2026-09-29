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
    if (!job || job.kind !== 'creator_image' || job.projectId !== userId.toString()) return apiError('图片任务不存在', 404)
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        phase: job.phase,
        error: job.error,
        providerSwitch: job.result && typeof job.result === 'object' && 'providerSwitch' in job.result ? job.result.providerSwitch : undefined,
        result: job.phase === 'done' ? job.result : undefined
    })
}
