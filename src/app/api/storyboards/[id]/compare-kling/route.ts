import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { genId } from '@/lib/id'
import { generateKlingComparison, getKlingConfig } from '@/services/kling-comparison'
import { isHighDynamicVideoShot } from '@/lib/video-production-plan'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'

export const maxDuration = 1800

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const storyboardId = parseApiId(id)
    if (storyboardId === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(storyboardId, userId)
    if (guard) return guard
    const comparison = await prisma.generation.findFirst({
        where: { storyboardId, type: 'video_comparison', provider: 'kling' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, resultUrl: true, errorMsg: true, createdAt: true }
    })
    return apiResponse(comparison)
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const storyboardId = parseApiId(id)
    if (storyboardId === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(storyboardId, userId)
    if (guard) return guard

    const [storyboard, active] = await Promise.all([
        prisma.storyboard.findFirst({
            where: { id: storyboardId, deletedAt: null },
            include: { characters: { include: { character: true } }, scene: true }
        }),
        prisma.generation.findFirst({
            where: { storyboardId, type: 'video_comparison', provider: 'kling', status: { in: ['queued', 'processing'] } },
            select: { id: true, status: true }
        })
    ])
    if (!storyboard) return apiError('Storyboard not found', 404)
    if (!storyboard.firstFrameUrl) return apiError('请先完成主插图，再生成 Kling 对照样片')
    if (!isHighDynamicVideoShot({ shotType: storyboard.shotType, actionDesc: storyboard.actionDesc, imagePrompt: storyboard.imagePrompt })) {
        return apiError('当前镜头不是高动态候选。Kling 目前只开放对照测试，避免增加无必要成本。')
    }
    try {
        getKlingConfig()
    } catch (error) {
        return apiError(error instanceof Error ? error.message : String(error), 503)
    }
    if (active) return apiResponse(active, 202)

    try {
        await assertSufficientPoints(userId, quoteGenerationPoints('video_comparison', 'kling', storyboard.duration ?? 5))
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        throw error
    }

    const generation = await prisma.generation.create({
        data: {
            id: genId(),
            storyboardId,
            type: 'video_comparison',
            provider: 'kling',
            status: 'processing',
            prompt: storyboard.videoPrompt ?? storyboard.actionDesc ?? storyboard.imagePrompt ?? ''
        }
    })
    after(() => generateKlingComparison(generation.id, storyboard, userId))
    return apiResponse({ id: generation.id, status: generation.status, comparisonOnly: true }, 202)
}
