import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertEpisodeOwner } from '@/lib/ownership'
import { getEpJob } from '@/lib/episodeJobStore'
import { cancelEpisodeBatchJob } from '@/lib/cancel-episode-batch'

type Params = { params: Promise<{ id: string }> }

// 顶部“暂停所有”没有 jobId，因此取消本集当前正在运行的批量任务。
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const episodeId = parseApiId(id)
    if (episodeId === null) return apiError('invalid episode id', 400)
    const guard = await assertEpisodeOwner(episodeId, userId)
    if (guard) return guard

    const running = await prisma.epJob.findFirst({
        where: { episodeId, phase: 'running' },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
    })
    if (!running) return apiResponse({ ok: true, cancelled: false })

    const job = await getEpJob(running.id.toString())
    if (!job) return apiResponse({ ok: true, cancelled: false })
    await cancelEpisodeBatchJob(job)
    return apiResponse({ ok: true, cancelled: true, jobId: job.id })
}
