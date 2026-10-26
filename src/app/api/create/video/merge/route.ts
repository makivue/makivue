import { after, NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { createCreatorGenerationJob, CreatorGenerationCapacityError } from '@/lib/creator-generation-concurrency'
import { parseCreatorMergeInput } from '@/lib/creator-video-merge'
import { loadCreatorMergeAssets, CreatorMergeValidationError, runCreatorVideoMerge, getCreatorVideoMergeJob } from '@/services/creator-video-merge'

export const maxDuration = 600

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const job = await getCreatorVideoMergeJob(userId)
    if (job && ['queued', 'writing_db'].includes(job.phase ?? '')) after(() => runCreatorVideoMerge(job.id, userId))
    const response = apiResponse({ job })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    let input
    try {
        input = parseCreatorMergeInput(await req.json())
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '拼接参数无效', 400)
    }
    try {
        await loadCreatorMergeAssets(userId, input)
        const job = await createCreatorGenerationJob(userId, 'video_merge', { input: { ...input }, requestKey: input.requestKey })
        after(() => runCreatorVideoMerge(job.id, userId))
        return apiResponse({ jobId: job.id }, 202)
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '视频拼接提交失败', error instanceof CreatorGenerationCapacityError ? 429 : error instanceof CreatorMergeValidationError ? 400 : 500)
    }
}
