export const DRAMA_PART_BYTES = 1024 * 1024
export const DRAMA_MIN_PART_BYTES = 256 * 1024
export const DRAMA_MAX_PART_BYTES = 8 * 1024 * 1024
export const DRAMA_MAX_UPLOAD_PARTS = (2 * 1024 ** 3) / DRAMA_MIN_PART_BYTES
export const DRAMA_UPLOAD_PROTOCOL = 'adaptive-v1'
export const DRAMA_MAX_EPISODES = 500
export type DramaAssetKind = 'cover' | 'video' | 'subtitle' | 'portrait'
export type DramaAsset = { receipt: string; name: string; url: string; size: number }

const formats: Record<DramaAssetKind, Record<string, string>> = {
    cover: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
    portrait: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
    video: { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' },
    subtitle: { srt: 'application/x-subrip', vtt: 'text/vtt' }
}

export function dramaAssetFormat(kind: DramaAssetKind, name: string) {
    const extension = name.toLowerCase().split('.').pop() ?? ''
    const mime = formats[kind]?.[extension]
    return mime ? { extension, mime } : null
}

export function validateDramaFile(kind: DramaAssetKind, file: { name: string; size: number }) {
    if (!Number.isSafeInteger(file.size) || file.size <= 0) return '请选择有效文件'
    if (!dramaAssetFormat(kind, file.name)) return kind === 'subtitle' ? '字幕仅支持 SRT、VTT 格式' : kind === 'video' ? '视频仅支持 MP4、MOV、WebM 格式' : '图片仅支持 JPG、PNG、WebP 格式'
    const limit = kind === 'video' ? 2 * 1024 ** 3 : kind === 'subtitle' ? DRAMA_PART_BYTES : 10 * 1024 ** 2
    if (file.size > limit) return kind === 'video' ? '单集视频不能超过 2GB' : kind === 'subtitle' ? '字幕文件不能超过 1MB' : '图片不能超过 10MB'
    return null
}

// Validate every cue, rather than accepting renamed text files or a single valid timestamp.
export function validateDramaSubtitle(name: string, bytes: Uint8Array): string | null {
    let text: string
    try {
        text = new TextDecoder('utf-8', { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, '')
            .replace(/\r\n?/g, '\n')
            .trim()
    } catch {
        return '字幕须使用 UTF-8 编码，且包含有效时间轴'
    }
    const vtt = name.toLowerCase().endsWith('.vtt')
    if (text.includes('\0') || (vtt && !/^WEBVTT(?:[^\S\n].*)?(?:\n|$)/.test(text))) return '字幕须使用 UTF-8 编码，且包含有效时间轴'
    const blocks = text.split(/\n[\t ]*\n/).slice(vtt ? 1 : 0)
    let cues = 0
    const time = (value: string) =>
        value
            .replace(',', '.')
            .split(':')
            .reduce((sum, part) => sum * 60 + Number(part), 0)
    for (const block of blocks) {
        if (vtt && /^(NOTE(?:\s|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue
        const lines = block.split('\n')
        const index = lines[0]?.includes('-->') ? 0 : 1
        if (!vtt && !/^\d+$/.test(lines[0] ?? '')) return '字幕须使用 UTF-8 编码，且包含有效时间轴'
        const stamp = vtt ? '((?:\\d{2,}:)?[0-5]\\d:[0-5]\\d\\.\\d{3})' : '(\\d{2,}:[0-5]\\d:[0-5]\\d,\\d{3})'
        const match = new RegExp(`^${stamp} --> ${stamp}${vtt ? '(?:[ \\t]+.*)?' : ''}$`).exec(lines[index] ?? '')
        if (
            !match ||
            time(match[2]) <= time(match[1]) ||
            !lines
                .slice(index + 1)
                .join('\n')
                .trim()
        )
            return '字幕须使用 UTF-8 编码，且包含有效时间轴'
        cues += 1
    }
    return cues ? null : '字幕须使用 UTF-8 编码，且包含有效时间轴'
}
