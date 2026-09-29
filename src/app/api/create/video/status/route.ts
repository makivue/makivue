import { localFetch } from '@/lib/local-fetch'
import { NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { fetchMeteredProvider } from '@/lib/provider-token-usage.server'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { currentUserId } from '@/lib/current-user'
import { getDashScopeConfig } from '@/services/dashscope-config'
import { apiError, apiResponse } from '@/lib/utils'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSeedanceConfig } from '@/services/seedance-config'
import { getJob, updateJob } from '@/lib/projectAiJobStore'
import { findCreatorAssetByJob, saveCreatorVideoAsset } from '@/services/creator-assets'
import { parseApiId } from '@/lib/api-id'
import { decodeVeoInlineVideo, extractVeoVideoResult } from '@/services/veo-video-result'
import { extractHiModelsUsage, getHiModelsVideoTask, mergeHiModelsUsage, type HiModelsUsage } from '@/services/himodels'
import { DEFAULT_VIDEO_PROVIDER, getHiModelsVideoApiModel, isProductionVideoProvider, SEEDANCE_20_BASE_URL, SEEDANCE_25_BASE_URL } from '@/lib/provider-capabilities'
import { BillingError, chargeModelUsage } from '@/services/billing'

export const maxDuration = 180

interface CreatorVideoJobResult {
    taskId: string
    provider: string
    prompt: string
    ratio: string
    duration: number
    usage?: HiModelsUsage | null
}

async function chargeCreatorVideoUsage(userId: bigint, jobId: string, details: CreatorVideoJobResult) {
    return chargeModelUsage({
        userId,
        scopeKey: `job:${jobId}`,
        idempotencyKey: `usage:creator-video:${jobId}`,
        sourceType: 'creator_video',
        sourceId: jobId,
        description: `AI 创作台视频生成 · ${details.provider} · ${details.duration} 秒`,
        metadata: { provider: details.provider, duration: details.duration, ratio: details.ratio }
    })
}

function creatorVideoError(error: unknown, fallback: string) {
    return apiError(error instanceof Error ? error.message : fallback, error instanceof BillingError ? error.status : 500)
}

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const searchParams = new URL(req.url).searchParams
    const taskId = searchParams.get('taskId')?.trim()
    const provider = searchParams.get('provider') ?? DEFAULT_VIDEO_PROVIDER
    const jobId = searchParams.get('jobId')?.trim()
    if (!jobId || !taskId || taskId.length > 500 || !isProductionVideoProvider(provider)) return apiError('无效的视频任务')
    const sourceJobId = parseApiId(jobId)
    if (sourceJobId === null) return apiError('无效的视频任务')
    const job = await getJob(sourceJobId.toString())
    if (!job || job.kind !== 'creator_video' || job.projectId !== userId.toString()) {
        return apiError('视频任务不存在', 404)
    }
    const respond = async (data: Record<string, unknown>) => apiResponse({ ...data, ...(await readHiModelsUsage(userId, { jobId })) })
    if (job.phase === 'error') return apiError(job.error ?? '视频生成失败', 409)
    const details = job.result as CreatorVideoJobResult | undefined
    if (!details || details.taskId !== taskId || details.provider !== provider) return apiError('视频任务信息不匹配', 400)
    const existing = await findCreatorAssetByJob(userId, sourceJobId)
    if (existing) {
        try {
            await chargeCreatorVideoUsage(userId, jobId, details)
            await updateJob(jobId, { phase: 'done', progress: 1, total: 1 })
            return respond({ status: 'completed', url: existing.url, coverUrl: existing.coverUrl, asset: existing, usage: details.usage ?? null })
        } catch (error) {
            return creatorVideoError(error, '视频积分扣除失败')
        }
    }

    // Keep the creator-only video slot alive while the browser polls the
    // provider. This lease is independent from every film Generation slot.
    await updateJob(jobId, {})

    if (getHiModelsVideoApiModel(provider)) {
        try {
            const data = await withHiModelsUsageScope({ userId, jobId }, () => getHiModelsVideoTask(taskId, AbortSignal.timeout(30_000), provider))
            const usage = mergeHiModelsUsage(details.usage ?? null, extractHiModelsUsage(data))
            if (usage) await updateJob(jobId, { result: { ...details, usage } })
            if (data.error) {
                const message = typeof data.error === 'string' ? data.error : (data.error.message ?? `${provider} 生成失败`)
                await updateJob(jobId, { phase: 'error', error: message })
                return respond({ status: 'failed', error: message, usage })
            }
            const status = data.status?.toLowerCase()
            if (status && ['failed', 'cancelled', 'canceled', 'error'].includes(status)) {
                const message = data.message ?? `${provider} 生成失败`
                await updateJob(jobId, { phase: 'error', error: message })
                return respond({ status: 'failed', error: message, usage })
            }
            if (!data.done && !status?.match(/^(succeeded|completed|success)$/)) return respond({ status: 'processing', usage })
            const videoResult = extractVeoVideoResult(data)
            if (!videoResult) {
                const message = '视频已完成，但返回文件格式无法识别，请重新生成'
                await updateJob(jobId, { phase: 'error', error: message })
                return respond({ status: 'failed', error: message })
            }
            const name = `himodels_video_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`
            const localPath = path.join(process.cwd(), 'public', 'storage', name)
            await fs.mkdir(path.dirname(localPath), { recursive: true })
            if (videoResult.kind === 'inline') {
                await fs.writeFile(localPath, decodeVeoInlineVideo(videoResult))
            } else {
                const download = await localFetch(videoResult.uri, { signal: AbortSignal.timeout(120_000) })
                if (!download.ok) return apiError(`视频文件下载失败：${download.status}`, 502)
                await fs.writeFile(localPath, Buffer.from(await download.arrayBuffer()))
            }
            try {
                const asset = await saveCreatorVideoAsset({
                    userId,
                    sourceJobId,
                    localPath,
                    prompt: details.prompt,
                    provider,
                    ratio: details.ratio,
                    requestedDuration: details.duration
                })
                await chargeCreatorVideoUsage(userId, jobId, details)
                await updateJob(jobId, { phase: 'done', progress: 1, total: 1, result: { ...details, usage, asset } })
                return respond({ status: 'completed', url: asset.url, coverUrl: asset.coverUrl, asset, usage })
            } finally {
                await fs.unlink(localPath).catch(() => {})
            }
        } catch (error) {
            return creatorVideoError(error, `查询 ${provider} 任务失败`)
        }
    }

    const config = provider === 'seedance' || provider === 'seedance25' ? await getSeedanceConfig(provider) : getDashScopeConfig()
    if (!config?.apiKey) {
        await updateJob(jobId, { phase: 'error', error: '视频模型 API key 未配置' })
        return apiError('视频模型 API key 未配置', 503)
    }
    const isWan = provider === 'wanx' || provider === 'wan3' || provider === 'wan3prime'
    const baseUrl = (config.baseUrl ?? (isWan ? 'https://dashscope.aliyuncs.com' : provider === 'seedance25' ? SEEDANCE_25_BASE_URL : SEEDANCE_20_BASE_URL)).replace(/\/$/, '')

    try {
        const response = await withHiModelsUsageScope({ userId, jobId }, () =>
            fetchMeteredProvider(
                `${baseUrl}${isWan ? `/api/v1/tasks/${encodeURIComponent(taskId)}` : `/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`}`,
                {
                    headers: { Authorization: `Bearer ${config.apiKey}` },
                    cache: 'no-store',
                    signal: AbortSignal.timeout(20_000)
                },
                { provider: isWan ? 'qwen' : 'volcengine', model: provider }
            )
        )
        if (!response.ok) return apiError(`查询视频任务失败：${await response.text()}`, response.status)
        const data = await response.json()
        const status = String(isWan ? data?.output?.task_status : (data?.status ?? '')).toLowerCase()
        const url = data?.content?.video_url ?? data?.video_url ?? data?.output?.video_url ?? null
        if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled' || status === 'unknown') {
            const message = data?.error?.message ?? data?.output?.message ?? data?.output?.code ?? data?.message ?? '视频生成失败'
            await updateJob(jobId, { phase: 'error', error: message })
            return respond({ status: 'failed', error: message })
        }
        if (url) {
            const asset = await saveCreatorVideoAsset({
                userId,
                sourceJobId,
                sourceUrl: url,
                prompt: details.prompt,
                provider,
                ratio: details.ratio,
                requestedDuration: details.duration
            })
            await chargeCreatorVideoUsage(userId, jobId, details)
            await updateJob(jobId, { phase: 'done', progress: 1, total: 1, result: { ...details, asset } })
            return respond({ status: 'completed', url: asset.url, coverUrl: asset.coverUrl, asset })
        }
        return respond({ status: 'processing' })
    } catch (error) {
        return creatorVideoError(error, '查询视频任务失败')
    }
}
