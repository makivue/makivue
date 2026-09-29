import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getJob } from '@/lib/extractJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { jobId } = await params
    const job = await getJob(jobId)
    if (!job) return apiError('Job not found or expired', 404)
    const guard = await assertProjectOwner(BigInt(job.projectId), userId)
    if (guard) return guard
    return apiResponse({
        ...(await readHiModelsUsage(userId, { jobId: job.id })),
        id: job.id,
        phase: job.phase,
        chunksDone: job.chunksDone,
        chunksTotal: job.chunksTotal,
        charactersFound: job.charactersFound,
        scenesFound: job.scenesFound,
        error: job.error,
        updatedAt: job.updatedAt,
        checkpointAvailable: job.chunksDone > 0 && !!job.result,
        // 只在 done 时才返回结果，避免中途无意义传输
        result: job.phase === 'done' ? job.result : undefined
    })
}
