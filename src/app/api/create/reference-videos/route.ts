import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { getVideoProviderCapability, isAvailableProductionVideoProvider } from '@/lib/provider-capabilities'
import {
    formatReferenceVideoDurationViolation,
    getReferenceVideoDurationViolation,
    MAX_REFERENCE_VIDEO_BYTES,
    REFERENCE_VIDEO_MIME_EXTENSIONS,
    resolveReferenceVideoMimeType,
    type ReferenceVideoMimeType,
    type StoryboardReferenceVideo
} from '@/lib/storyboard-reference-videos'
import { apiError, apiResponse } from '@/lib/utils'
import { probeMediaStreams } from '@/services/ffmpeg'
import { deleteLocalMediaWithinSubdirectory, saveLocalMediaFile } from '@/services/local-media'

export const runtime = 'nodejs'
export const maxDuration = 120

function contentMatchesMime(buffer: Buffer, mimeType: ReferenceVideoMimeType) {
    if (mimeType === 'video/webm') return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)

    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REFERENCE_VIDEO_BYTES + 1024 * 1024) return apiError('参考视频最大 300MB', 413)

    const form = await req.formData().catch(() => null)
    if (!form) return apiError('上传内容无效')
    const mode = form.get('mode') ?? 'video'
    if (mode !== 'image' && mode !== 'video') return apiError('上传内容无效')
    const provider = form.get('provider')
    if (mode === 'video' && !isAvailableProductionVideoProvider(provider)) return apiError('不支持的视频模型', 422)
    const capability = mode === 'video' && isAvailableProductionVideoProvider(provider) ? getVideoProviderCapability(provider) : null
    if (mode === 'video' && !capability?.maxVideoReferences) return apiError(`${capability?.label ?? provider} 不支持视频作为参考素材`, 422)

    const file = form.get('file')
    if (!(file instanceof File) || file.size <= 0) return apiError('请选择参考视频')
    if (file.size > MAX_REFERENCE_VIDEO_BYTES) return apiError('参考视频最大 300MB', 413)
    const mimeType = resolveReferenceVideoMimeType(file.type, file.name)
    if (!mimeType) return apiError('参考视频仅支持 MP4、MOV、WebM 格式', 415)

    const buffer = Buffer.from(await file.arrayBuffer())
    if (!contentMatchesMime(buffer, mimeType)) return apiError('视频实际内容与文件格式不一致', 422)

    const subdir = `creator/${userId}/reference-videos`
    let tempDir: string | null = null
    let uploadedUrl: string | null = null
    try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-creator-reference-video-'))
        const id = randomUUID()
        const filename = `${Date.now()}_${id}${REFERENCE_VIDEO_MIME_EXTENSIONS[mimeType]}`
        const tempPath = path.join(tempDir, filename)
        await fs.writeFile(tempPath, buffer)
        const media = await probeMediaStreams(tempPath)
        if (!media.hasVideo || !Number.isFinite(media.duration) || media.duration <= 0.05) return apiError('参考视频无效或时长为 0', 422)
        const violation = getReferenceVideoDurationViolation([{ name: file.name, durationSeconds: media.duration }], capability?.referenceVideoDuration)
        if (violation && capability) return apiError(formatReferenceVideoDurationViolation(capability.label, violation), 422)

        uploadedUrl = await saveLocalMediaFile(tempPath, subdir, filename)
        const referenceVideo: StoryboardReferenceVideo = {
            id,
            url: uploadedUrl,
            name: file.name.trim().slice(0, 255) || filename,
            mimeType,
            sizeBytes: file.size,
            durationSeconds: Number(media.duration.toFixed(3)),
            createdAt: new Date().toISOString()
        }
        return apiResponse({ referenceVideo }, 201)
    } catch (error) {
        if (uploadedUrl) await deleteLocalMediaWithinSubdirectory(uploadedUrl, subdir).catch(() => {})
        console.error('[creator-reference-video] upload failed', error)
        return apiError('参考视频上传失败，请稍后重试', 500)
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}

export async function DELETE(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!url) return apiError('参考视频不存在', 404)
    try {
        await deleteLocalMediaWithinSubdirectory(url, `creator/${userId}/reference-videos`)
        return apiResponse({ removed: true })
    } catch (error) {
        console.error('[creator-reference-video] delete failed', error)
        return apiError('参考视频删除失败', 500)
    }
}
