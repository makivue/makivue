import { currentSession } from '@/lib/current-user'
import { FEEDBACK_MAX_CONTENT, FEEDBACK_MAX_FILES, FEEDBACK_RATE_MESSAGE, feedbackSourcePath } from '@/lib/site-feedback'
import { apiError, apiErrorWithDetails, apiResponse } from '@/lib/utils'
import { readFeedbackQuota, submitSiteFeedback } from '@/services/site-feedback'
import { readFeedbackReceipt } from '@/services/site-feedback-upload'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request) {
    const session = currentSession(req)
    if (!session) return apiError('请先登录', 401)
    try {
        const quota = await readFeedbackQuota(session.userId)
        return apiResponse({ allowed: quota.allowed, retryAfterSeconds: quota.retryAfterSeconds })
    } catch (error) {
        console.error('[feedback] Quota unavailable', error)
        return apiError('反馈服务暂不可用，请稍后重试。', 503)
    }
}

export async function POST(req: Request) {
    const session = currentSession(req)
    if (!session) return apiError('请先登录', 401)
    const body = await req.json().catch(() => null)
    if (!body || typeof body.content !== 'string') return apiError('请输入反馈内容。')
    const content = body.content.trim()
    if (!content || [...content].length > FEEDBACK_MAX_CONTENT) return apiError('反馈内容需为 1 至 2000 个字符。')
    const receipts: unknown = body.receipts ?? []
    if (!Array.isArray(receipts) || receipts.length > FEEDBACK_MAX_FILES || new Set(receipts).size !== receipts.length) return apiError('每次最多添加 5 个附件。')
    let attachments
    try {
        attachments = await Promise.all(receipts.map(receipt => readFeedbackReceipt(receipt, session.userId)))
    } catch {
        return apiError('附件凭证无效，请重新上传。', 400)
    }
    try {
        const result = await submitSiteFeedback({ userId: session.userId, email: session.email, content, pageName: feedbackSourcePath(body.pageName), attachments })
        if (result.status === 'rate-limited') {
            const response = apiErrorWithDetails(FEEDBACK_RATE_MESSAGE, 429, { retryAfterSeconds: result.retryAfterSeconds })
            response.headers.set('Retry-After', String(result.retryAfterSeconds))
            return response
        }
        return apiResponse({ id: result.id, retryAfterSeconds: result.retryAfterSeconds }, 201)
    } catch (error) {
        console.error('[feedback] Submission failed', error)
        return apiError('反馈提交失败，请稍后重试。', 503)
    }
}
