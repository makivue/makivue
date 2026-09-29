import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }

const COMPARISON_TYPE = 'video_speech_comparison'
const COMPARISON_PROVIDERS = ['seedance', 'wanx'] as const

async function comparisonSnapshot(storyboardId: bigint) {
    const rows = await prisma.generation.findMany({
        where: {
            storyboardId,
            type: COMPARISON_TYPE,
            provider: { in: [...COMPARISON_PROVIDERS] }
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, status: true, resultUrl: true, errorMsg: true, requestBody: true, createdAt: true }
    })
    return COMPARISON_PROVIDERS.map(provider => rows.find(row => row.provider === provider) ?? null).filter((row): row is NonNullable<typeof row> => !!row)
}

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const storyboardId = parseApiId(id)
    if (storyboardId === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(storyboardId, userId)
    if (guard) return guard
    return apiResponse(await comparisonSnapshot(storyboardId))
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const storyboardId = parseApiId(id)
    if (storyboardId === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(storyboardId, userId)
    if (guard) return guard

    return apiError('该视频对照功能已停用，历史样片仍可查看', 410)
}
