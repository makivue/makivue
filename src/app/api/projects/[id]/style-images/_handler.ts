import { NextRequest } from 'next/server'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { apiResponse, apiError } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { parseNovelSetup, stringifyNovelSetup } from '@/lib/novel'
import { deleteLocalMediaWithinSubdirectory, saveLocalMediaFile } from '@/services/local-media'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { markProjectVisualsStaleInTransaction } from '@/services/content-lineage'

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const MAX_STYLE_IMAGES = 4
const ALLOWED_MIME: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif'
}

function imageExtensionFromBytes(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp'
    if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) return '.gif'
    return null
}

// 上传项目自定义风格参考图。图片保存在本机 data/media/style/{projectId}/ 目录，
// URL 追加到 project.novelSetup.styleReferenceImages 数组。
// 保留旧路由的环境参数以兼容调用；本地文件服务不区分远程环境。
export async function handleUploadStyleImage(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const contentType = req.headers.get('content-type') ?? ''
    const declaredLength = Number(req.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 1024 * 1024) return apiError('上传请求过大，图片最大 8MB', 413)
    let buf: Buffer
    let ext: string
    if (contentType.startsWith('multipart/form-data')) {
        const form = await req.formData()
        const file = form.get('file')
        if (!(file instanceof File)) return apiError('file required (multipart field "file")')
        if (file.size > MAX_BYTES) return apiError(`文件过大，最大 ${MAX_BYTES / 1024 / 1024}MB`)
        ext = ALLOWED_MIME[file.type] ?? ''
        if (!ext) return apiError(`不支持的文件类型：${file.type}`)
        buf = Buffer.from(await file.arrayBuffer())
    } else {
        // 走原始二进制流，客户端要显式带 Content-Type，例如 image/png
        ext = ALLOWED_MIME[contentType] ?? ''
        if (!ext) return apiError(`不支持的文件类型：${contentType}`)
        buf = Buffer.from(await req.arrayBuffer())
        if (buf.length === 0) return apiError('empty body')
        if (buf.length > MAX_BYTES) return apiError(`文件过大，最大 ${MAX_BYTES / 1024 / 1024}MB`)
    }

    const detectedExt = imageExtensionFromBytes(buf)
    if (!detectedExt || detectedExt !== ext) return apiError('图片实际内容与文件类型不一致', 422)

    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })
    if (!project) return apiError('Project not found', 404)

    const filename = `style_user_${projectId}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`
    const tmpDir = path.join(process.cwd(), 'public', 'storage')
    const tmpPath = path.join(tmpDir, filename)
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(tmpPath, buf)

    let localUrl: string
    try {
        localUrl = await saveLocalMediaFile(tmpPath, `style/${projectId}`, filename)
    } catch (err) {
        return apiError(`风格图保存到本地失败：${err instanceof Error ? err.message : String(err)}`, 500)
    } finally {
        fs.unlink(tmpPath).catch(() => {})
    }

    let nextList: string[]
    try {
        nextList = await prisma.$transaction(async tx => {
            const locked = await tx.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { novelSetup: true } })
            if (!locked) throw new Error('PROJECT_NOT_FOUND')
            const setup = parseNovelSetup(locked.novelSetup)
            const current = [...new Set(setup.styleReferenceImages ?? [])]
            if (current.length >= MAX_STYLE_IMAGES) throw new Error('STYLE_IMAGE_LIMIT')
            const list = [...current, localUrl]
            await tx.project.update({
                where: { id: projectId },
                data: { novelSetup: stringifyNovelSetup({ ...setup, styleReferenceImages: list }), sourceVersion: { increment: 1 } }
            })
            await markProjectVisualsStaleInTransaction(tx, projectId, '项目风格参考图已新增，请重新生成视觉资产')
            return list
        })
    } catch (error) {
        await deleteLocalMediaWithinSubdirectory(localUrl, `style/${projectId}`).catch(cleanupError => console.error('[style-image] orphan cleanup failed', cleanupError))
        if (error instanceof Error && error.message === 'STYLE_IMAGE_LIMIT') return apiError(`每个项目最多上传 ${MAX_STYLE_IMAGES} 张风格图`, 409)
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return apiError('Project not found', 404)
        throw error
    }

    return apiResponse({ url: localUrl, styleReferenceImages: nextList })
}

// 删除某张风格参考图，只清理本机当前项目目录内的文件。
export async function handleDeleteStyleImage(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const body = await req.json().catch(() => ({}))
    const url = typeof body.url === 'string' ? body.url : ''
    if (!url) return apiError('url required')

    const nextList = await prisma
        .$transaction(async tx => {
            const project = await tx.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { novelSetup: true } })
            if (!project) throw new Error('PROJECT_NOT_FOUND')
            const setup = parseNovelSetup(project.novelSetup)
            const list = (setup.styleReferenceImages ?? []).filter(u => u !== url)
            await tx.project.update({
                where: { id: projectId },
                data: { novelSetup: stringifyNovelSetup({ ...setup, styleReferenceImages: list }), sourceVersion: { increment: 1 } }
            })
            await markProjectVisualsStaleInTransaction(tx, projectId, '项目风格参考图已移除，请重新生成视觉资产')
            return list
        })
        .catch(error => {
            if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return null
            throw error
        })
    if (!nextList) return apiError('Project not found', 404)
    let cleanupWarning: string | null = null
    try {
        await deleteLocalMediaWithinSubdirectory(url, `style/${projectId}`)
    } catch (error) {
        cleanupWarning = '项目引用已删除，但本地文件清理失败，请重试'
        console.error('[style-image] local cleanup failed', error)
    }
    return apiResponse({ styleReferenceImages: nextList, cleanupWarning })
}
