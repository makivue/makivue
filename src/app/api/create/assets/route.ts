import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { serializeCreatorAsset } from '@/services/creator-assets'
import { parseApiId } from '@/lib/api-id'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const searchParams = new URL(req.url).searchParams
    const type = searchParams.get('type')
    if (type && type !== 'image' && type !== 'video') return apiError('作品类型无效')
    const limit = Math.min(60, Math.max(1, Number(searchParams.get('limit') ?? 24) || 24))
    const rawCursor = searchParams.get('cursor')
    const parsedCursor = rawCursor ? parseApiId(rawCursor) : null
    if (rawCursor && parsedCursor === null) return apiError('分页参数无效')
    const cursor = parsedCursor ?? undefined

    const rows = await prisma.creatorAsset.findMany({
        where: {
            userId,
            deletedAt: null,
            ...(type ? { type } : {}),
            ...(cursor ? { id: { lt: cursor } } : {})
        },
        orderBy: { id: 'desc' },
        take: limit + 1
    })
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    return apiResponse({
        items: page.map(serializeCreatorAsset),
        nextCursor: hasMore ? page.at(-1)?.id.toString() ?? null : null
    })
}
