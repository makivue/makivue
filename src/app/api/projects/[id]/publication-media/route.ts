import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { normalizePublicationMediaUrls, publicationCoverCandidates, publicationTrailerCandidates } from '@/lib/publication-media'
import { apiError, apiResponse } from '@/lib/utils'
import { probeMediaStreams } from '@/services/ffmpeg'
import { deleteLocalMediaWithinSubdirectory, localMediaMatchesSubdirectory, saveLocalMediaFile } from '@/services/local-media'

type Params = { params: Promise<{ id: string }> }

const COVER_MAX_BYTES = 10 * 1024 * 1024
const TRAILER_MAX_BYTES = 300 * 1024 * 1024
const COVER_EXTENSIONS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const TRAILER_EXTENSIONS: Record<string, string> = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' }

const PUBLICATION_MEDIA_SELECT = {
    coverUrl: true,
    trailerUrl: true,
    publicationCoverCandidates: true,
    publicationTrailerCandidates: true,
    novelSetup: true,
    characters: { where: { deletedAt: null }, select: { name: true, referenceImageUrl: true } },
    scenes: { where: { deletedAt: null }, select: { name: true, referenceImageUrl: true } },
    episodes: {
        where: { deletedAt: null },
        orderBy: { episodeNumber: 'asc' },
        select: {
            id: true,
            episodeNumber: true,
            title: true,
            videoUrl: true,
            storyboards: { where: { deletedAt: null }, orderBy: { order: 'asc' }, select: { order: true, firstFrameUrl: true, lastFrameUrl: true } }
        }
    }
} as const

export const runtime = 'nodejs'
export const maxDuration = 120

function isCoverBytes(buffer: Buffer, extension: string) {
    if (extension === '.jpg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return extension === '.webp' && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
}

function isTrailerBytes(buffer: Buffer, extension: string) {
    if (extension === '.webm') return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
}

async function ownedProject(req: NextRequest, params: Params) {
    const userId = currentUserId(req)
    if (userId === null) return { error: apiError('login required', 401) }
    const { id } = await params.params
    const projectId = parseApiId(id)
    if (projectId === null) return { error: apiError('项目 ID 格式无效', 400) }
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return { error: guard }
    return { projectId }
}

export async function POST(req: NextRequest, params: Params) {
    const owned = await ownedProject(req, params)
    if ('error' in owned) return owned.error

    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > TRAILER_MAX_BYTES + 1024 * 1024) return apiError('上传文件不能超过 300MB', 413)
    const form = await req.formData().catch(() => null)
    if (!form) return apiError('上传内容无效')
    const kind = form.get('kind')
    if (kind !== 'cover' && kind !== 'trailer') return apiError('媒体类型无效')
    const file = form.get('file')
    if (!(file instanceof File) || file.size <= 0) return apiError('请选择上传文件')

    const maxBytes = kind === 'cover' ? COVER_MAX_BYTES : TRAILER_MAX_BYTES
    if (file.size > maxBytes) return apiError(kind === 'cover' ? '封面图片不能超过 10MB' : '预告片不能超过 300MB', 413)
    const extensions = kind === 'cover' ? COVER_EXTENSIONS : TRAILER_EXTENSIONS
    const extension = extensions[file.type]
    if (!extension) return apiError(kind === 'cover' ? '封面仅支持 JPG、PNG、WebP' : '预告片仅支持 MP4、MOV、WebM', 415)

    const buffer = Buffer.from(await file.arrayBuffer())
    if (!(kind === 'cover' ? isCoverBytes(buffer, extension) : isTrailerBytes(buffer, extension))) return apiError('文件实际内容与格式不一致', 422)

    const subdir = `projects/${owned.projectId}/publication`
    let tempDir: string | null = null
    let uploadedUrl: string | null = null
    try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-project-publication-'))
        const filename = `${kind}_${Date.now()}_${randomUUID()}${extension}`
        const tempPath = path.join(tempDir, filename)
        await fs.writeFile(tempPath, buffer)
        let trailerDuration: number | null = null
        if (kind === 'trailer') {
            const media = await probeMediaStreams(tempPath)
            if (!media.hasVideo || !Number.isFinite(media.duration) || media.duration <= 0.05) return apiError('预告片无效或时长为 0', 422)
            trailerDuration = Number(media.duration.toFixed(3))
        }

        uploadedUrl = await saveLocalMediaFile(tempPath, subdir, filename)
        await prisma.$transaction(async tx => {
            const project = await tx.project.findFirst({ where: { id: owned.projectId, deletedAt: null }, select: { publicationCoverCandidates: true, publicationTrailerCandidates: true } })
            if (!project) throw new Error('PROJECT_NOT_FOUND')
            const nextCandidates = normalizePublicationMediaUrls([
                uploadedUrl,
                ...(kind === 'cover' ? normalizePublicationMediaUrls(project.publicationCoverCandidates) : normalizePublicationMediaUrls(project.publicationTrailerCandidates))
            ])
            await tx.project.update({
                where: { id: owned.projectId },
                data:
                    kind === 'cover'
                        ? { coverUrl: uploadedUrl, publicationCoverCandidates: nextCandidates }
                        : { trailerUrl: uploadedUrl, trailerDuration, publicationTrailerCandidates: nextCandidates }
            })
        })
        return apiResponse(kind === 'cover' ? { kind, url: uploadedUrl } : { kind, url: uploadedUrl, duration: trailerDuration }, 201)
    } catch (error) {
        if (uploadedUrl) await deleteLocalMediaWithinSubdirectory(uploadedUrl, subdir).catch(() => {})
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return apiError('Project not found', 404)
        console.error('[publication-media] upload failed', error)
        return apiError('作品媒体上传失败，请稍后重试', 500)
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}

export async function PUT(req: NextRequest, params: Params) {
    const owned = await ownedProject(req, params)
    if ('error' in owned) return owned.error
    const body = (await req.json().catch(() => null)) as { kind?: unknown; url?: unknown } | null
    const kind = body?.kind
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    if (kind !== 'cover' && kind !== 'trailer') return apiError('媒体类型无效')
    if (!url || url.length > 1024) return apiError('媒体地址无效')

    const project = await prisma.project.findFirst({ where: { id: owned.projectId, deletedAt: null }, select: PUBLICATION_MEDIA_SELECT })
    if (!project) return apiError('Project not found', 404)
    const candidates = kind === 'cover' ? publicationCoverCandidates(project) : publicationTrailerCandidates(project)
    const ownedPublicationObject = localMediaMatchesSubdirectory(url, `projects/${owned.projectId}/publication`)
    if (!ownedPublicationObject && !candidates.some(candidate => candidate.url === url)) return apiError('只能选择当前项目中的媒体', 422)

    const storedCandidates = normalizePublicationMediaUrls([
        url,
        ...(kind === 'cover' ? normalizePublicationMediaUrls(project.publicationCoverCandidates) : normalizePublicationMediaUrls(project.publicationTrailerCandidates))
    ])
    await prisma.project.update({
        where: { id: owned.projectId },
        data: kind === 'cover' ? { coverUrl: url, publicationCoverCandidates: storedCandidates } : { trailerUrl: url, trailerDuration: null, publicationTrailerCandidates: storedCandidates }
    })
    return apiResponse({ kind, url })
}

export async function DELETE(req: NextRequest, params: Params) {
    const owned = await ownedProject(req, params)
    if ('error' in owned) return owned.error
    const body = (await req.json().catch(() => null)) as { kind?: unknown } | null
    const kind = body?.kind
    if (kind !== 'cover' && kind !== 'trailer') return apiError('媒体类型无效')
    const current = await prisma.project.findFirst({
        where: { id: owned.projectId, deletedAt: null },
        select: { coverUrl: true, trailerUrl: true, publicationCoverCandidates: true, publicationTrailerCandidates: true }
    })
    if (!current) return apiError('Project not found', 404)
    const removedUrl = kind === 'cover' ? current.coverUrl : current.trailerUrl
    await prisma.project.update({
        where: { id: owned.projectId },
        data:
            kind === 'cover'
                ? {
                      coverUrl: null,
                      publicationCoverCandidates: normalizePublicationMediaUrls(current.publicationCoverCandidates).filter(url => url !== removedUrl),
                      visibility: 'private',
                      publishedAt: null
                  }
                : {
                      trailerUrl: null,
                      trailerDuration: null,
                      publicationTrailerCandidates: normalizePublicationMediaUrls(current.publicationTrailerCandidates).filter(url => url !== removedUrl),
                      visibility: 'private',
                      publishedAt: null
                  }
    })

    let cleanupWarning: string | null = null
    if (removedUrl && localMediaMatchesSubdirectory(removedUrl, `projects/${owned.projectId}/publication`)) {
        try {
            await deleteLocalMediaWithinSubdirectory(removedUrl, `projects/${owned.projectId}/publication`)
        } catch (error) {
            cleanupWarning = '数据库引用已删除，但存储清理失败'
            console.error('[publication-media] local storage cleanup failed', error)
        }
    }
    return apiResponse({ kind, cleanupWarning })
}
