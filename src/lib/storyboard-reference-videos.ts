export const MAX_STORYBOARD_REFERENCE_VIDEOS = 3
export const MAX_REFERENCE_VIDEO_BYTES = 300 * 1024 * 1024

export const REFERENCE_VIDEO_MIME_EXTENSIONS = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm'
} as const

export type ReferenceVideoMimeType = keyof typeof REFERENCE_VIDEO_MIME_EXTENSIONS

export type StoryboardReferenceVideo = {
    id: string
    url: string
    name: string
    mimeType: ReferenceVideoMimeType
    sizeBytes: number
    durationSeconds: number
    createdAt: string
}

export type ReferenceVideoDurationRule = {
    min: number
    max: number
    totalMax?: number
}

export type ReferenceVideoDurationViolation =
    | { kind: 'too_short'; video: Pick<StoryboardReferenceVideo, 'name' | 'durationSeconds'>; limit: number }
    | { kind: 'too_long'; video: Pick<StoryboardReferenceVideo, 'name' | 'durationSeconds'>; limit: number }
    | { kind: 'total_too_long'; limit: number; total: number }

export function resolveReferenceVideoMimeType(mimeType: string, filename: string): ReferenceVideoMimeType | null {
    if (mimeType in REFERENCE_VIDEO_MIME_EXTENSIONS) return mimeType as ReferenceVideoMimeType
    const extension = filename
        .trim()
        .toLowerCase()
        .match(/\.[a-z0-9]+$/)?.[0]
    if (extension === '.mp4') return 'video/mp4'
    if (extension === '.mov') return 'video/quicktime'
    if (extension === '.webm') return 'video/webm'
    return null
}

function nonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseStoryboardReferenceVideos(value: unknown): StoryboardReferenceVideo[] {
    if (!Array.isArray(value)) return []
    const videos: StoryboardReferenceVideo[] = []
    const seen = new Set<string>()
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const record = item as Record<string, unknown>
        const id = nonEmptyString(record.id)
        const url = nonEmptyString(record.url)
        const name = nonEmptyString(record.name)
        const mimeType = nonEmptyString(record.mimeType)
        const sizeBytes = Number(record.sizeBytes)
        const durationSeconds = Number(record.durationSeconds)
        const createdAt = nonEmptyString(record.createdAt)
        if (
            !id ||
            seen.has(id) ||
            !url ||
            !(url.startsWith('/api/local-media/') || /^https?:\/\//i.test(url)) ||
            !name ||
            !(mimeType && mimeType in REFERENCE_VIDEO_MIME_EXTENSIONS) ||
            !Number.isFinite(sizeBytes) ||
            sizeBytes <= 0 ||
            !Number.isFinite(durationSeconds) ||
            durationSeconds <= 0 ||
            !createdAt
        ) {
            continue
        }
        seen.add(id)
        videos.push({
            id,
            url,
            name,
            mimeType: mimeType as ReferenceVideoMimeType,
            sizeBytes,
            durationSeconds,
            createdAt
        })
        if (videos.length >= MAX_STORYBOARD_REFERENCE_VIDEOS) break
    }
    return videos
}

export function totalReferenceVideoDuration(videos: readonly Pick<StoryboardReferenceVideo, 'durationSeconds'>[]) {
    return videos.reduce((total, video) => total + video.durationSeconds, 0)
}

export function getReferenceVideoDurationViolation(
    videos: readonly Pick<StoryboardReferenceVideo, 'name' | 'durationSeconds'>[],
    rule: ReferenceVideoDurationRule | null | undefined
): ReferenceVideoDurationViolation | null {
    if (!rule) return null
    const tooShort = videos.find(video => video.durationSeconds < rule.min)
    if (tooShort) return { kind: 'too_short', video: tooShort, limit: rule.min }
    const tooLong = videos.find(video => video.durationSeconds > rule.max)
    if (tooLong) return { kind: 'too_long', video: tooLong, limit: rule.max }
    if (rule.totalMax !== undefined) {
        const total = totalReferenceVideoDuration(videos)
        if (total > rule.totalMax) return { kind: 'total_too_long', limit: rule.totalMax, total }
    }
    return null
}

export function formatReferenceVideoDurationViolation(providerLabel: string, violation: ReferenceVideoDurationViolation) {
    if (violation.kind === 'too_short') {
        return `${providerLabel} 的参考视频“${violation.video.name}”不能短于 ${violation.limit} 秒，请更换或调整后重新上传`
    }
    if (violation.kind === 'too_long') {
        return `${providerLabel} 的参考视频“${violation.video.name}”不能超过 ${violation.limit} 秒，请裁剪后重新上传`
    }
    return `${providerLabel} 的参考视频合计不能超过 ${violation.limit} 秒，请删除或裁剪后重新上传`
}
