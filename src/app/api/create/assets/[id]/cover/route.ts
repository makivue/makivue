import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { uploadToOSS } from '@/services/oss'
import { replaceCreatorAssetCover } from '@/services/creator-assets'
import { parseApiId } from '@/lib/api-id'

const MAX_COVER_BYTES = 10 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
}

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const { id } = await params
    const assetId = parseApiId(id)
    if (assetId === null) return apiError('作品 ID 无效')
    const asset = await prisma.creatorAsset.findFirst({
        where: { id: assetId, userId, type: 'video', deletedAt: null },
        select: { id: true }
    })
    if (!asset) return apiError('视频作品不存在', 404)

    const form = await req.formData()
    const cover = form.get('cover')
    if (!(cover instanceof File) || cover.size === 0) return apiError('请选择封面图片')
    if (cover.size > MAX_COVER_BYTES) return apiError('封面图片不能超过 10MB')
    const extension = MIME_EXTENSIONS[cover.type]
    if (!extension) return apiError('封面仅支持 JPG、PNG、WebP')

    const storageDir = path.join(process.cwd(), 'public', 'storage')
    const filename = `creator_custom_cover_${userId}_${assetId}_${Date.now()}${extension}`
    const localPath = path.join(storageDir, filename)
    await fs.mkdir(storageDir, { recursive: true })
    try {
        await fs.writeFile(localPath, Buffer.from(await cover.arrayBuffer()))
        const coverUrl = await uploadToOSS(localPath, `creator/${userId}/covers`, filename)
        const updated = await replaceCreatorAssetCover(userId, assetId, coverUrl)
        if (!updated) return apiError('视频作品不存在', 404)
        return apiResponse(updated)
    } finally {
        await fs.unlink(localPath).catch(() => {})
    }
}
