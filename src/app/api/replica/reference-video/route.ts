import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { MAX_REFERENCE_VIDEO_BYTES, REFERENCE_VIDEO_MIME_EXTENSIONS, resolveReferenceVideoMimeType } from '@/lib/storyboard-reference-videos'
import { apiError, apiResponse } from '@/lib/utils'
import { probeMediaStreams } from '@/services/ffmpeg'
import { saveLocalMediaFile } from '@/services/local-media'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
    const userId = currentUserId(request)
    if (userId === null) return apiError('请先登录', 401)

    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_REFERENCE_VIDEO_BYTES + 1024 * 1024) return apiError('参考视频最大 300MB', 413)

    let tempDir: string | null = null
    try {
        const form = await request.formData().catch(() => null)
        if (!form) return apiError('上传内容无效')
        const file = form.get('file')
        if (!(file instanceof File) || file.size <= 0) return apiError('请选择参考视频')
        if (file.size > MAX_REFERENCE_VIDEO_BYTES) return apiError('参考视频最大 300MB', 413)
        const mimeType = resolveReferenceVideoMimeType(file.type, file.name)
        if (!mimeType) return apiError('参考视频仅支持 MP4、MOV、WebM 格式', 415)

        const header = Buffer.from(await file.slice(0, 12).arrayBuffer())
        const matchesFormat = mimeType === 'video/webm' ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp'
        if (!matchesFormat) return apiError('视频实际内容与文件格式不一致', 422)

        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-replica-reference-video-'))
        const filename = `${randomUUID()}${REFERENCE_VIDEO_MIME_EXTENSIONS[mimeType]}`
        const tempPath = path.join(/* turbopackIgnore: true */ tempDir, filename)
        await pipeline(Readable.fromWeb(file.stream() as ReadableStream<Uint8Array>), createWriteStream(tempPath))
        const media = await probeMediaStreams(tempPath).catch(() => null)
        if (!media?.hasVideo || !Number.isFinite(media.duration) || media.duration <= 0.05) return apiError('参考视频无效或时长为 0', 422)

        const url = await saveLocalMediaFile(tempPath, `replica/${userId}/reference-videos`, filename)
        return apiResponse({ url, name: file.name.trim().slice(0, 255) || filename, mimeType, sizeBytes: file.size, durationSeconds: Number(media.duration.toFixed(3)) }, 201)
    } catch (error) {
        console.error('[replica-reference-video] upload failed', error)
        return apiError('参考视频上传失败，请稍后重试', 500)
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}
