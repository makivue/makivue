import { clientFetch, readApiJson } from './client-fetch'
import { getPollingDelay } from './polling'

export interface ChapterJobResult {
    episodeId: string
    chapterContent: string
    actualWords?: number
    minimumWords?: number
    targetWords?: number
    repairAttempts?: number
    warning?: string
}

class ChapterRequestError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean
    ) {
        super(message)
    }
}

const retryableStatus = (status: number) => [408, 429, 500, 502, 503, 504].includes(status)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function readChapterResponse(response: Response, fallback: string) {
    let json
    try {
        json = await readApiJson(response)
    } catch (error) {
        throw new ChapterRequestError(error instanceof Error ? error.message : fallback, response.ok || retryableStatus(response.status))
    }
    if (!response.ok || !json.success) throw new ChapterRequestError(json.error ?? fallback, retryableStatus(response.status))
    return json.data ?? {}
}

export async function startChapterJob(episodeId: string): Promise<string> {
    const recoveryDelays = [0, 1200, 2500, 5000]
    for (let attempt = 0; ; attempt += 1) {
        if (recoveryDelays[attempt] > 0) await sleep(recoveryDelays[attempt])
        try {
            const response = await clientFetch('/api/ai/chapter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ episodeId }),
                timeoutMs: 15_000
            })
            const data = await readChapterResponse(response, '创建章节生成任务失败')
            if (!data.jobId) throw new ChapterRequestError('未拿到章节任务 ID', false)
            return data.jobId
        } catch (error) {
            if (error instanceof ChapterRequestError && !error.retryable) throw error
            if (attempt === recoveryDelays.length - 1) {
                throw new Error('网络连接暂时中断，后台任务可能仍在运行。连接恢复后请点击“继续生成剩余章节”。', { cause: error })
            }
        }
    }
}

// A chapter includes generation, in-place repairs and factual review. Keep
// polling the same job through short outages without submitting another debit.
export async function pollChapterJob(jobId: string, timeoutMs = 35 * 60 * 1000): Promise<ChapterJobResult> {
    const deadline = Date.now() + timeoutMs
    const steps = [4000, 6000, 10000, 15000, 20000, 30000]
    let attempt = 0
    let failures = 0
    while (Date.now() < deadline) {
        let data
        try {
            const response = await clientFetch(`/api/ai/chapter/status/${jobId}`, { timeoutMs: 15_000 })
            data = await readChapterResponse(response, '轮询章节任务失败')
            failures = 0
        } catch (error) {
            if (error instanceof ChapterRequestError && !error.retryable) throw error
            failures += 1
            if (failures >= 5) {
                throw new Error('网络连接暂时中断，后台任务可能仍在运行。连接恢复后请点击“继续生成剩余章节”。', { cause: error })
            }
            await sleep(Math.min(getPollingDelay({ baseMs: 4000, failureCount: failures }), Math.max(0, deadline - Date.now())))
            continue
        }
        if (data.phase === 'done') {
            if (!data.result?.chapterContent?.trim()) throw new Error('章节任务已完成但未返回结果')
            return data.result as ChapterJobResult
        }
        if (data.phase === 'error' || data.phase === 'cancelled') throw new Error(data.error ?? '章节任务失败')
        await sleep(Math.min(getPollingDelay({ baseMs: steps[Math.min(attempt++, steps.length - 1)] }), Math.max(0, deadline - Date.now())))
    }
    throw new Error('章节任务超时，请稍后查看章节状态或继续生成剩余章节')
}
