import { after, NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { getCreatorVideoMergeJob, runCreatorVideoMerge } from '@/services/creator-video-merge'

export const maxDuration = 600

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const { jobId } = await params
    const job = await getCreatorVideoMergeJob(userId, jobId)
    if (!job) return apiError('拼接任务不存在', 404)
    if (['queued', 'writing_db'].includes(job.phase ?? '')) after(() => runCreatorVideoMerge(job.id, userId))
    const response = apiResponse({ job })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
}
