import { localMediaKey } from '@/services/local-media'
import { after, NextRequest } from 'next/server'
import { apiError, apiResponse, handleApiError } from '@/lib/utils'
import { listReplicaJobs, submitReplicaJob, processReplicaJob, type ReplicaMode } from '@/lib/replica-jobs'
import { getForwardedClientIp } from '@/lib/forwarded-client-ip'
import { DEFAULT_VIDEO_PROVIDER, normalizeVideoDuration } from '@/lib/provider-capabilities'
import { currentUserId } from '@/lib/current-user'
import { assertWalletHasCoins, BillingError } from '@/services/billing'

const MODES = new Set<ReplicaMode>(['full', 'analyze', 'clip'])

export async function GET(request: NextRequest) {
    try {
        const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1)
        const perPage = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get('perPage')) || 20))
        const status = request.nextUrl.searchParams.get('status')?.trim() || undefined
        const mode = request.nextUrl.searchParams.get('mode')?.trim() || undefined
        return apiResponse(await listReplicaJobs({ page, perPage, status, mode }, getForwardedClientIp(request.headers)))
    } catch (error) {
        return handleApiError(error, '任务列表加载失败')
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as Record<string, unknown>
        const mode = body.mode
        if (typeof mode !== 'string' || !MODES.has(mode as ReplicaMode)) {
            return apiError('不支持的生成模式')
        }
        const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : ''
        const videoFile = typeof body.videoFile === 'string' ? body.videoFile.trim() : ''
        if (!videoUrl && !videoFile) return apiError('请提供参考视频链接')
        if (!localMediaKey(videoUrl || videoFile)) return apiError('请先上传参考视频到本地工作区')
        if (mode !== 'analyze') {
            const userId = currentUserId(request)
            if (userId === null) return apiError('请先登录', 401)
            await assertWalletHasCoins(userId)
        }
        const payload = { ...body }
        delete payload.mode
        if (mode === 'full') {
            const requestedProvider = body.videoProvider ?? DEFAULT_VIDEO_PROVIDER
            const videoProvider =
                requestedProvider === 'seedance25'
                    ? 'seedance25'
                    : requestedProvider === 'seedance'
                      ? 'seedance'
                      : requestedProvider === 'wan3'
                        ? 'wan3'
                        : requestedProvider === 'wan3prime'
                          ? 'wan3prime'
                          : null
            if (!videoProvider) return apiError('不支持的同款视频生成模型')
            payload.videoProvider = videoProvider
            payload.videoDuration = normalizeVideoDuration(videoProvider, Number(body.videoDuration))
        }
        const job = await submitReplicaJob(mode as ReplicaMode, payload, getForwardedClientIp(request.headers))
        after(() => processReplicaJob(job.taskId))
        return apiResponse(job)
    } catch (error) {
        return handleApiError(error, '任务提交失败', error instanceof BillingError ? error.status : 500)
    }
}
