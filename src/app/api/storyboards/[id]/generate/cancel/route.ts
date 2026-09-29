import { resetStoryboardMediaInTransaction, StaleStoryboardMutationError } from '@/services/artifacts'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError, handleApiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }
type CancelTarget = 'frame' | 'video' | 'compose' | 'all'

function normalizeTarget(value: unknown): CancelTarget {
    return value === 'video' || value === 'compose' || value === 'all' ? value : 'frame'
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const body = await req.json().catch(() => ({}))
    const target = normalizeTarget(body.target)

    try {
        const storyboard = await prisma.storyboard.findFirst({ where: { id: idNum, deletedAt: null } })
        if (!storyboard) return apiError('Storyboard not found', 404)
        const { updated, cancelled } = await prisma.$transaction(
            async tx => {

                const cancelled = await tx.generation.count({ where: { storyboardId: idNum, status: { in: ['queued', 'processing'] } } })
                if (cancelled === 0) return { updated: storyboard, cancelled }
                const updated = await resetStoryboardMediaInTransaction(tx, storyboard, [], '用户手动停止，旧任务已取消')
                return { updated, cancelled }
            },
            { timeout: 60_000 }
        )

        return apiResponse({ id, target, cancelled, storyboard: updated })
    } catch (error) {
        if (error instanceof StaleStoryboardMutationError) return apiError(error.message, 409)
        console.error(`[Cancel ${id}] request failed`, error)
        return handleApiError(error, '取消任务失败，请稍后重试', 503)
    }
}
