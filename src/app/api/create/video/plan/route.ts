import { after, NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { parseVideoThemeInput } from '@/lib/creator-video-plan'
import { createCreatorGenerationJob, CreatorGenerationCapacityError } from '@/lib/creator-generation-concurrency'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { updateJob } from '@/lib/projectAiJobStore'
import { runCreatorVideoPlan } from '@/services/creator-video-plan'

export const maxDuration = 600

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    let input
    try {
        input = parseVideoThemeInput(await req.json())
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '主题参数无效', 400)
    }
    let jobId: string | undefined
    try {
        const job = await createCreatorGenerationJob(userId, 'video_plan')
        jobId = job.id
        after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runCreatorVideoPlan(job.id, input)))
        return apiResponse({ jobId: job.id }, 202)
    } catch (error) {
        if (jobId) await updateJob(jobId, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
        return apiError(error instanceof Error ? error.message : '创作脚本生成失败', error instanceof CreatorGenerationCapacityError ? 429 : 500)
    }
}
