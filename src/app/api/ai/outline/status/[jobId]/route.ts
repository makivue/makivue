import { NextRequest } from 'next/server'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { apiResponse, apiError, handleApiError } from '@/lib/utils'
import { cancelJob, getJob, isRecoverableOutlineJob } from '@/lib/outlineJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { hiModelsResponseDiagnosticsEnabled } from '@/lib/himodels-response-diagnostics'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    const guard = await assertProjectOwner(BigInt(job.projectId), userId)
    if (guard) return guard
    const { himodelsResponses, himodelsResponsesDropped, tokenUsage, tokenUsageCalls, himodelsUsageCalls, ...result } = job.result ?? {}
    const recordedUsage = await readHiModelsUsage(userId, { jobId: job.id })
    const calls = tokenUsageCalls ?? himodelsUsageCalls ?? recordedUsage.tokenUsageCalls
    return apiResponse({
        id: job.id,
        phase: job.phase,
        totalEpisodes: job.totalEpisodes,
        receivedChapters: job.receivedChapters,
        error: job.error,
        recoverable: isRecoverableOutlineJob(job),
        tokenUsage: tokenUsage ?? recordedUsage.tokenUsage ?? null,
        tokenUsageCalls: calls,
        himodelsUsageCalls: calls.filter(call => (call.provider ?? 'himodels') === 'himodels'),
        usageTrackingAvailable: tokenUsage ? true : recordedUsage.usageTrackingAvailable,
        result: job.phase === 'done' ? result : undefined,
        ...(hiModelsResponseDiagnosticsEnabled() ? { himodelsResponses, himodelsResponsesDropped } : {})
    })
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    const guard = await assertProjectOwner(BigInt(job.projectId), userId)
    if (guard) return guard

    try {
        const cancelled = await cancelJob(job.id, job.projectId)
        const current = await getJob(job.id)
        return apiResponse({
            id: job.id,
            cancelled,
            phase: current?.phase ?? job.phase,
            receivedChapters: current?.receivedChapters ?? job.receivedChapters,
            totalEpisodes: current?.totalEpisodes ?? job.totalEpisodes
        })
    } catch (error) {
        console.error(`[outline] cancel job ${job.id} failed`, error)
        return handleApiError(error, '取消大纲任务失败', 503)
    }
}
