import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getEpJob } from '@/lib/episodeJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { cancelEpisodeBatchJob } from '@/lib/cancel-episode-batch'

type Params = { params: Promise<{ id: string; jobId: string }> }

// 取消一键生成任务：把 job 标记为 cancelled，触发 AbortSignal 打断 poll/sleep。
// 同时把数据库里仍卡在 generating/processing 的 storyboard/Generation 状态回滚，
// 让前端按钮恢复可点状态。
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id: episodeId, jobId } = await params
    const episodeIdNum = parseApiId(episodeId)
    if (episodeIdNum === null) return apiError('invalid episode id', 400)
    const guard = await assertEpisodeOwner(episodeIdNum, userId)
    if (guard) return guard
    const job = await getEpJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    if (job.episodeId !== episodeId) return apiError('Job episode mismatch', 400)

    await cancelEpisodeBatchJob(job)

    return apiResponse({ ok: true })
}
