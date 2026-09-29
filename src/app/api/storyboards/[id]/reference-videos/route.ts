import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertStoryboardOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { getVideoProviderCapability, isAvailableProductionVideoProvider } from '@/lib/provider-capabilities'
import {
    formatReferenceVideoDurationViolation,
    getReferenceVideoDurationViolation,
    MAX_REFERENCE_VIDEO_BYTES,
    MAX_STORYBOARD_REFERENCE_VIDEOS,
    parseStoryboardReferenceVideos,
    REFERENCE_VIDEO_MIME_EXTENSIONS,
    resolveReferenceVideoMimeType,
    type ReferenceVideoMimeType,
    type StoryboardReferenceVideo
} from '@/lib/storyboard-reference-videos'
import { apiError, apiResponse } from '@/lib/utils'
import { resetFollowingContinuousMediaInTransaction, resetStoryboardMediaInTransaction } from '@/services/artifacts'
import { probeMediaStreams } from '@/services/ffmpeg'
import { deleteLocalMediaWithinSubdirectory, saveLocalMediaFile } from '@/services/local-media'

type Params = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const maxDuration = 120

function isIsoBaseMedia(buffer: Buffer) {
    return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
}

function isWebm(buffer: Buffer) {
    return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
}

function contentMatchesMime(buffer: Buffer, mimeType: ReferenceVideoMimeType) {
    return mimeType === 'video/webm' ? isWebm(buffer) : isIsoBaseMedia(buffer)
}

function jsonVideos(videos: StoryboardReferenceVideo[]) {
    return videos as unknown as Prisma.InputJsonValue
}

class ReferenceVideoDurationUploadError extends Error {}

async function ownedStoryboard(req: NextRequest, params: Params) {
    const userId = currentUserId(req)
    if (userId === null) return { error: apiError('login required', 401) }
    const { id } = await params.params
    const storyboardId = parseApiId(id)
    if (storyboardId === null) return { error: apiError('分镜 ID 格式无效', 400) }
    const guard = await assertStoryboardOwner(storyboardId, userId)
    if (guard) return { error: guard }
    const storyboard = await prisma.storyboard.findFirst({ where: { id: storyboardId, deletedAt: null } })
    if (!storyboard) return { error: apiError('Storyboard not found', 404) }
    return { storyboardId, storyboard }
}

export async function POST(req: NextRequest, params: Params) {
    const owned = await ownedStoryboard(req, params)
    if ('error' in owned) return owned.error

    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REFERENCE_VIDEO_BYTES + 1024 * 1024) {
        return apiError('参考视频最大 300MB', 413)
    }
    const form = await req.formData().catch(() => null)
    if (!form) return apiError('上传内容无效')
    const provider = form.get('provider')
    if (!isAvailableProductionVideoProvider(provider)) return apiError('不支持的视频模型', 422)
    const capability = getVideoProviderCapability(provider)
    if (!capability?.maxVideoReferences) return apiError(`${capability?.label ?? provider} 不支持视频作为参考素材`, 422)

    const value = form.get('file')
    if (!(value instanceof File) || value.size <= 0) return apiError('请选择参考视频')
    if (value.size > MAX_REFERENCE_VIDEO_BYTES) return apiError('参考视频最大 300MB', 413)
    const mimeType = resolveReferenceVideoMimeType(value.type, value.name)
    if (!mimeType) return apiError('参考视频仅支持 MP4、MOV、WebM 格式', 415)
    const extension = REFERENCE_VIDEO_MIME_EXTENSIONS[mimeType]

    const buffer = Buffer.from(await value.arrayBuffer())
    if (!contentMatchesMime(buffer, mimeType)) return apiError('视频实际内容与文件格式不一致', 422)

    const assetId = randomUUID()
    const subdir = `storyboards/${owned.storyboardId}/reference-videos`
    let tempDir: string | null = null
    let uploadedUrl: string | null = null
    try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-storyboard-reference-video-'))
        const filename = `${Date.now()}_${assetId}${extension}`
        const tempPath = path.join(tempDir, filename)
        await fs.writeFile(tempPath, buffer)
        const media = await probeMediaStreams(tempPath)
        if (!media.hasVideo || !Number.isFinite(media.duration) || media.duration <= 0.05) return apiError('参考视频无效或时长为 0', 422)
        const durationViolation = getReferenceVideoDurationViolation([{ name: value.name, durationSeconds: media.duration }], capability.referenceVideoDuration)
        if (durationViolation) {
            return apiError(formatReferenceVideoDurationViolation(capability.label, durationViolation), 422)
        }

        uploadedUrl = await saveLocalMediaFile(tempPath, subdir, filename)
        const asset: StoryboardReferenceVideo = {
            id: assetId,
            url: uploadedUrl,
            name: value.name.trim().slice(0, 255) || filename,
            mimeType,
            sizeBytes: value.size,
            durationSeconds: Number(media.duration.toFixed(3)),
            createdAt: new Date().toISOString()
        }

        const nextVideos = await prisma.$transaction(
            async tx => {
                const current = await tx.storyboard.findUnique({ where: { id: owned.storyboardId } })
                if (!current || current.deletedAt) throw new Error('STORYBOARD_NOT_FOUND')
                const videos = parseStoryboardReferenceVideos(current.referenceVideoAssets)
                if (videos.length >= Math.min(MAX_STORYBOARD_REFERENCE_VIDEOS, capability.maxVideoReferences)) throw new Error('REFERENCE_VIDEO_LIMIT')
                const next = [...videos, asset]
                const transactionDurationViolation = getReferenceVideoDurationViolation(next, capability.referenceVideoDuration)
                if (transactionDurationViolation) {
                    throw new ReferenceVideoDurationUploadError(formatReferenceVideoDurationViolation(capability.label, transactionDurationViolation))
                }
                await resetStoryboardMediaInTransaction(tx, current, ['video'], '参考视频已更新，旧视频已重置', {
                    patch: { referenceVideoAssets: jsonVideos(next), sourceVersion: { increment: 1 }, staleReason: null }
                })
                await resetFollowingContinuousMediaInTransaction(tx, current.episodeId, current.order, [current.id])
                return next
            },
            { timeout: 60_000 }
        )
        return apiResponse({ referenceVideos: nextVideos }, 201)
    } catch (error) {
        if (uploadedUrl) {
            await deleteLocalMediaWithinSubdirectory(uploadedUrl, subdir).catch(cleanupError => console.error('[reference-video] orphan cleanup failed', cleanupError))
        }
        if (error instanceof Error && error.message === 'REFERENCE_VIDEO_LIMIT') return apiError(`每个分镜最多上传 ${MAX_STORYBOARD_REFERENCE_VIDEOS} 个参考视频`, 409)
        if (error instanceof ReferenceVideoDurationUploadError) return apiError(error.message, 422)
        if (error instanceof Error && error.message === 'STORYBOARD_NOT_FOUND') return apiError('Storyboard not found', 404)
        console.error('[reference-video] upload failed', error)
        return apiError('参考视频上传失败，请稍后重试', 500)
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}

export async function DELETE(req: NextRequest, params: Params) {
    const owned = await ownedStoryboard(req, params)
    if ('error' in owned) return owned.error
    const body = (await req.json().catch(() => null)) as { assetId?: unknown } | null
    const assetId = typeof body?.assetId === 'string' ? body.assetId.trim() : ''
    if (!assetId) return apiError('参考视频 ID 无效')

    const result = await prisma
        .$transaction(
            async tx => {
                const current = await tx.storyboard.findUnique({ where: { id: owned.storyboardId } })
                if (!current || current.deletedAt) throw new Error('STORYBOARD_NOT_FOUND')
                const videos = parseStoryboardReferenceVideos(current.referenceVideoAssets)
                const removed = videos.find(video => video.id === assetId)
                if (!removed) throw new Error('REFERENCE_VIDEO_NOT_FOUND')
                const next = videos.filter(video => video.id !== assetId)
                await resetStoryboardMediaInTransaction(tx, current, ['video'], '参考视频已移除，旧视频已重置', {
                    patch: { referenceVideoAssets: next.length ? jsonVideos(next) : Prisma.DbNull, sourceVersion: { increment: 1 }, staleReason: null }
                })
                await resetFollowingContinuousMediaInTransaction(tx, current.episodeId, current.order, [current.id])
                return { removed, next }
            },
            { timeout: 60_000 }
        )
        .catch(error => {
            if (error instanceof Error && (error.message === 'STORYBOARD_NOT_FOUND' || error.message === 'REFERENCE_VIDEO_NOT_FOUND')) return error
            throw error
        })
    if (result instanceof Error) return apiError(result.message === 'STORYBOARD_NOT_FOUND' ? 'Storyboard not found' : '参考视频不存在', 404)

    const subdir = `storyboards/${owned.storyboardId}/reference-videos`
    let cleanupWarning: string | null = null
    try {
        await deleteLocalMediaWithinSubdirectory(result.removed.url, subdir)
    } catch (error) {
        cleanupWarning = '数据库引用已删除，但存储清理失败'
        console.error('[reference-video] local storage cleanup failed', error)
    }
    return apiResponse({ referenceVideos: result.next, cleanupWarning })
}
