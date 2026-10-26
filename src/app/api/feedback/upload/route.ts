import { currentUserId } from '@/lib/current-user'
import { FEEDBACK_VIDEO_BYTES, feedbackFileIssue } from '@/lib/site-feedback'
import { apiError, apiResponse } from '@/lib/utils'
import { FeedbackFileValidationError, uploadFeedbackFile } from '@/services/site-feedback-upload'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const limit = FEEDBACK_VIDEO_BYTES + 64 * 1024
    if (!req.body || Number(req.headers.get('content-length')) > limit) return apiError('图片最大 10MB，视频最大 50MB。', 413)
    // Bound actual bytes, including requests with missing or forged Content-Length.
    const reader = req.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > limit) {
                await reader.cancel()
                return apiError('图片最大 10MB，视频最大 50MB。', 413)
            }
            chunks.push(value)
        }
    } catch {
        return apiError('附件上传失败，请检查文件后重试。', 400)
    } finally {
        reader.releaseLock()
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers.get('content-type') ?? '' } }).formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File) || form?.getAll('file').length !== 1) return apiError('请选择图片或视频。')
    const issue = feedbackFileIssue(file)
    if (issue) return apiError(issue)
    try {
        return apiResponse(await uploadFeedbackFile(file, Buffer.from(await file.arrayBuffer()), userId), 201)
    } catch (error) {
        if (error instanceof FeedbackFileValidationError) return apiError(error.message, 400)
        console.error('[feedback] Upload failed', error)
        return apiError('附件上传失败，请检查文件后重试。', 503)
    }
}
