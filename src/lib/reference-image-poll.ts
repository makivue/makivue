import { clientFetch } from './client-fetch'
import { getPollingDelay } from './polling'
import { isTransientReferenceJobError, type ReferenceGenerationProgress, type ReferenceGenerationTimings } from './reference-generation-progress'
import type { ImageGenerationRecovery, ImageProviderSwitch } from './image-generation-recovery'

const REF_IMAGE_POLL_STEPS = [2000, 3000, 5000, 8000, 10000]

function nextRefImagePollInterval(attempt: number): number {
    return getPollingDelay({ baseMs: REF_IMAGE_POLL_STEPS[Math.min(attempt, REF_IMAGE_POLL_STEPS.length - 1)], jitterRatio: 0.15 })
}

export interface RefImageJobResult {
    targetType: 'character' | 'scene'
    targetId: string
    candidateUrl: string
    referenceImageUrl: string | null
    referenceCandidates: string[]
    selectedReferenceUrls?: string[]
    role?: string
    stateKey?: string
    timings?: ReferenceGenerationTimings
    provider?: string
    requestedProvider?: string
    recovery?: ImageGenerationRecovery
    fallbackReason?: string
    providerSwitch?: ImageProviderSwitch
    inspectionWarning?: string
    promptVersion?: string
}

export async function pollRefImageJob(
    kind: 'characters' | 'scenes',
    parentId: string,
    jobId: string,
    timeoutMs = 30 * 60 * 1000,
    onProgress?: (progress: ReferenceGenerationProgress) => void,
    onPhase?: (phase: string) => void
): Promise<RefImageJobResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    let lastPollingError = ''
    while (Date.now() < deadline) {
        try {
            const res = await clientFetch(`/api/${kind}/${parentId}/reference/status/${jobId}`, { cache: 'no-store' })
            if ([429, 502, 503, 504].includes(res.status)) throw new Error('服务暂时不可用，请稍后重试')
            const json = await res.json()
            if (!res.ok || !json.success) throw new Error(json.error ?? '轮询参考图任务失败')
            const data = json.data ?? {}
            onPhase?.(String(data.phase ?? ''))
            lastPollingError = ''
            const progress = data.progress as ReferenceGenerationProgress | undefined
            // The server owns the lease. An unchanged stage or elapsed timer
            // cannot prove the executor stopped; wait for its persisted state.
            if (progress) onProgress?.(progress)
            if (data.phase === 'done') {
                if (!data.result) throw new Error('参考图任务已完成但未返回结果')
                return data.result as RefImageJobResult
            }
            if (data.phase === 'error' || data.phase === 'cancelled') throw new Error(`REF_IMAGE_JOB_ERROR:${data.error ?? '参考图任务失败'}`)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.startsWith('REF_IMAGE_JOB_ERROR:')) throw new Error(message.slice('REF_IMAGE_JOB_ERROR:'.length))
            if (!isTransientReferenceJobError(message)) throw error
            // The generation runs on the server. A temporary status-request
            // failure must not mark the image itself as failed; keep polling
            // until the job returns its persisted result.
            lastPollingError = message
        }
        await new Promise(r => setTimeout(r, nextRefImagePollInterval(attempt++)))
    }
    throw new Error(`参考图任务超时（30 分钟未完成）${lastPollingError ? `，最近一次状态查询失败：${lastPollingError}` : ''}`)
}
