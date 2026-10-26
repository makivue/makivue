export const FEEDBACK_MAX_CONTENT = 2000
export const FEEDBACK_MAX_FILES = 5
const FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024
export const FEEDBACK_VIDEO_BYTES = 50 * 1024 * 1024
const FEEDBACK_INTERVAL_MS = 60_000
const FEEDBACK_WINDOW_MS = 10 * 60_000
const FEEDBACK_WINDOW_LIMIT = 5
export const FEEDBACK_RATE_MESSAGE = '每分钟最多提交一次反馈，10 分钟内最多提交 5 次。'

export type FeedbackAttachment = { url: string; name: string; kind: 'image' | 'video'; mimeType: string; size: number }
export type FeedbackUpload = { attachment: FeedbackAttachment; receipt: string }

const formats: Record<string, { kind: FeedbackAttachment['kind']; extension: string }> = {
    'image/jpeg': { kind: 'image', extension: 'jpg' },
    'image/png': { kind: 'image', extension: 'png' },
    'image/webp': { kind: 'image', extension: 'webp' },
    'image/gif': { kind: 'image', extension: 'gif' },
    'video/mp4': { kind: 'video', extension: 'mp4' },
    'video/quicktime': { kind: 'video', extension: 'mov' },
    'video/webm': { kind: 'video', extension: 'webm' }
}

export function feedbackFileFormat(file: { name: string; type: string }) {
    const extensions: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        webm: 'video/webm'
    }
    const mimeType = file.type || extensions[file.name.split('.').pop()?.toLowerCase() ?? '']
    return formats[mimeType] ? { ...formats[mimeType], mimeType } : null
}

export function feedbackFileIssue(file: { name: string; type: string; size: number }): string | null {
    const format = feedbackFileFormat(file)
    if (!format) return '附件仅支持 JPG、PNG、WebP、GIF 图片和 MP4、MOV、WebM 视频。'
    if (!Number.isSafeInteger(file.size) || file.size <= 0) return '附件不能为空。'
    if (file.size > (format.kind === 'image' ? FEEDBACK_IMAGE_BYTES : FEEDBACK_VIDEO_BYTES)) return '图片最大 10MB，视频最大 50MB。'
    return null
}

/** Both limits are rolling windows, with the exact expiry instant permitting a new submission. */
export function feedbackQuota(timestamps: number[], now: number) {
    const active = timestamps.filter(value => Number.isFinite(value) && value > now - FEEDBACK_WINDOW_MS).sort((a, b) => a - b)
    const latest = active.at(-1)
    const minuteWait = latest === undefined ? 0 : latest + FEEDBACK_INTERVAL_MS - now
    const windowWait = active.length >= FEEDBACK_WINDOW_LIMIT ? active[active.length - FEEDBACK_WINDOW_LIMIT] + FEEDBACK_WINDOW_MS - now : 0
    const retryAfterSeconds = Math.max(0, Math.ceil(Math.max(minuteWait, windowWait) / 1000))
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds, timestamps: active }
}

export function feedbackSourcePath(value: unknown) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 1024) return '/'
    // Record the page, avoiding tokens or personal data in query strings.
    return value.split(/[?#]/)[0]
}
