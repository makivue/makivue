import { NextRequest } from 'next/server'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { currentUserId } from '@/lib/current-user'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { parseApiId } from '@/lib/api-id'
import { apiError, apiResponse } from '@/lib/utils'
import { VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { PROJECT_GENRES } from '@/lib/project-genres'
import { serializeStyleLibraryEntry } from '@/lib/style-library'
import { saveLocalMediaFile, deleteLocalMediaWithinSubdirectory } from '@/services/local-media'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const rawId = req.nextUrl.searchParams.get('id')
    const id = rawId === null ? null : parseApiId(rawId)
    if (rawId !== null && id === null) return apiError('风格或题材不存在', 404)
    try {
        const rows = await prisma.styleLibraryEntry.findMany({ where: { userId, ...(id !== null ? { id } : {}) }, orderBy: { id: 'desc' } })
        if (id !== null && rows.length === 0) return apiError('风格或题材不存在', 404)
        const response = apiResponse({ items: rows.map(serializeStyleLibraryEntry) })
        response.headers.set('Cache-Control', 'private, no-store')
        return response
    } catch (error) {
        console.error('[style-library] load failed', error)
        return apiError('加载风格库失败，请重试', 503)
    }
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const form = await req.formData().catch(() => null)
    if (!form) return apiError('上传内容无效')
    const field = (key: string) => (typeof form.get(key) === 'string' ? (form.get(key) as string).trim() : '')
    const kind = field('kind')
    const name = field('name')
    const description = field('description')
    const baseStyle = field('baseStyle')
    const region = field('region')
    const genre = field('genre')
    if (!['style', 'theme'].includes(kind) || !name || name.length > 80 || description.length > 4000 || region.length > 100) return apiError('请检查名称和描述长度')
    if (!VISUAL_STYLE_PRESETS.some(style => style.key === baseStyle) || (genre && !PROJECT_GENRES.some(item => item.label === genre))) return apiError('请选择有效的基础风格和题材类型')
    const images = form.getAll('images')
    if (images.length > 3) return apiError('参考图片最多 3 张')
    if (!description && images.length === 0) return apiError('请输入描述或上传参考图片')
    for (const file of images) {
        if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            return apiError('请上传不超过 10MB 的 JPG、PNG 或 WebP 图片', 415)
        }
    }

    const buffers: Buffer[] = []
    try {
        for (const file of images as File[]) {
            // Decode and re-encode instead of trusting the extension or browser MIME type.
            const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000, animated: false })
            const metadata = await image.metadata()
            if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) return apiError('图片内容无效，请重新选择', 415)
            buffers.push(await image.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer())
        }
    } catch {
        return apiError('图片内容无效，请重新选择', 415)
    }

    const subdir = `style-library/${userId}`
    const uploaded: string[] = []
    let tempDir: string | null = null
    try {
        if (buffers.length) tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-style-library-'))
        for (const buffer of buffers) {
            const filename = `${randomUUID()}.webp`
            const localPath = path.join(tempDir!, filename)
            await fs.writeFile(localPath, buffer)
            uploaded.push(await saveLocalMediaFile(localPath, subdir, filename))
        }
        const row = await prisma.styleLibraryEntry.create({
            data: { id: genId(), userId, kind, name, description, baseStyle, region: region || null, genre: genre || null, referenceImages: uploaded }
        })
        return apiResponse(serializeStyleLibraryEntry(row), 201)
    } catch (error) {
        await Promise.allSettled(uploaded.map(url => deleteLocalMediaWithinSubdirectory(url, subdir)))
        console.error('[style-library] save failed', error)
        return apiError('保存风格或题材失败，请重试', 503)
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}
