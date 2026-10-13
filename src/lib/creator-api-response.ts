import { readApiJson } from './client-fetch'
import type { MessageValues } from '@/i18n/catalog'

const UPLOAD_TIMEOUT_MESSAGE = '请求体上传超时（HTTP 408），请检查网络或减小参考文件后重试'
const ASSET_UPLOAD_TIMEOUT_MESSAGE = '素材上传超时，请检查网络或减小文件后重新上传'

export class CreatorUploadServiceTimeoutError extends Error {
    constructor(message = '上传服务响应超时，请稍后重试') {
        super(message)
        this.name = 'CreatorUploadServiceTimeoutError'
    }
}

function uploadBodyTimeout() {
    return new CreatorUploadServiceTimeoutError(UPLOAD_TIMEOUT_MESSAGE)
}

export async function readCreatorApiResponse(response: Response, operation: 'request' | 'generation' | 'upload' = 'request') {
    if (response.status === 408) throw uploadBodyTimeout()
    if (response.status === 504) {
        if (operation === 'upload') throw new CreatorUploadServiceTimeoutError()
        if (operation === 'generation') throw new Error('生成服务响应超时，请稍后查看我的作品确认任务状态')
        throw new Error('服务响应超时，请稍后重试')
    }
    const payload = await readApiJson(response).catch(error => {
        if (operation === 'upload' && response.status === 413) throw new Error('上传文件超过服务大小限制，请减小文件后重试')
        if (operation === 'upload' && response.status === 415) throw new Error('上传文件格式不支持，请更换格式后重试')
        throw error
    })
    if (payload?.error_code === 'GW.0408') throw uploadBodyTimeout()
    if (operation === 'upload' && payload?.error_code === 'GW.0402') throw new CreatorUploadServiceTimeoutError()
    if (typeof payload?.error_code === 'string') {
        throw new Error(`${typeof payload.error_msg === 'string' ? payload.error_msg : '请求失败'}（${payload.error_code}）`)
    }
    return payload
}

export function creatorUploadErrorMessage(error: unknown): string {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return ASSET_UPLOAD_TIMEOUT_MESSAGE
    return error instanceof Error ? error.message : '参考视频上传失败'
}

export function creatorGenerationErrorMessage(error: unknown): string {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return '请求提交超时，请先查看我的作品确认任务状态，避免重复生成'
    const message = error instanceof Error ? error.message : String(error)
    // Background jobs persist only error.message, so the browser receives a
    // plain Error rather than the provider's original TimeoutError instance.
    if (/^(?:signal timed out|the operation was aborted due to timeout)[.!]?$/i.test(message.trim())) return '生成服务响应超时，暂未取得生成结果'
    return message
}

export function creatorGenerationFailureSummary(total: number, failures: readonly { ratio: string; message: string }[], t: (source: string, values?: MessageValues) => string): string | null {
    if (failures.length === 0) return null
    if (total === 1) return t('生成未完成（{ratio}）：{message}', { ratio: failures[0].ratio, message: t(failures[0].message) })
    const details = failures.map(failure => `${failure.ratio}：${t(failure.message)}`).join('；')
    if (failures.length === total) return t('本次生成均未完成：{details}', { details })
    return t('已完成 {completed}/{total} 个比例；未完成：{details}', { completed: total - failures.length, total, details })
}
