import { NextRequest } from 'next/server'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertStoryboardOwner } from '@/lib/ownership'

// 轮询单个 generation 任务状态
export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { searchParams } = new URL(req.url)
    const rawGenerationId = searchParams.get('id')
    if (!rawGenerationId) return apiError('id required')
    const generationId = parseApiId(rawGenerationId)
    if (generationId === null) return apiError('任务 ID 格式无效', 400)

    const generation = await prisma.generation.findUnique({
        where: { id: generationId }
    })
    if (!generation) return apiError('Generation not found', 404)
    const guard = await assertStoryboardOwner(generation.storyboardId, userId)
    if (guard) return guard
    return apiResponse({ ...generation, ...(await readHiModelsUsage(userId, { generationId: generationId.toString() })) })
}
