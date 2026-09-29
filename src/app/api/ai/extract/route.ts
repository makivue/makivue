import type { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError } from '@/lib/utils'

/**
 * 旧同步提取接口已停用。它会在长剧本分块分析时占用同一个 HTTP 请求，
 * 必然存在网关超时风险。请使用 /api/ai/extract/preview 创建后台任务，
 * 轮询 /api/ai/extract/status/[jobId]，确认后再调用 /api/ai/extract/commit。
 */
export async function POST(req: NextRequest) {
    if (currentUserId(req) === null) return apiError('登录状态已失效，请重新登录', 401)
    return apiError('该同步接口已停用，请刷新页面后使用后台提取流程', 410)
}
