import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { genId } from '@/lib/id'
import { generateVideo } from '@/services/ai'
import { getConfiguredVideoLanguage } from '@/services/video-language'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { assertGenerationQueueCapacity, cleanupStaleGenerationSlots, GenerationQueueFullError, tryClaimGenerationSlot, waitForGenerationSlot } from '@/lib/generation-concurrency'
import { reconcileGenerationTelemetry } from '@/services/production-observability'

export const maxDuration = 1800

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

    const storyboard = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        include: {
            episode: { select: { projectId: true } },
            characters: { include: { character: true } },
            scene: true
        }
    })
    if (!storyboard) return apiError('Storyboard not found', 404)
    if (!storyboard.dialogue?.trim()) return apiError('语音对照只用于有台词的分镜')
    if (!storyboard.firstFrameUrl && !storyboard.plannedLastFrameUrl && !storyboard.lastFrameUrl) return apiError('请先完成主插图，再生成语音效果对照')

    const active = await prisma.generation.findMany({
        where: { storyboardId, type: COMPARISON_TYPE, status: { in: ['queued', 'processing'] } },
        select: { id: true, provider: true, status: true }
    })
    if (active.length > 0) return apiResponse(active, 202)

    const videoLanguage = await getConfiguredVideoLanguage()
    const estimatedPoints = (quoteGenerationPoints('video', 'seedance', storyboard.duration ?? 0) ?? 0) + (quoteGenerationPoints('video', 'wanx', storyboard.duration ?? 0) ?? 0)
    try {
        await assertSufficientPoints(userId, estimatedPoints)
        await cleanupStaleGenerationSlots(userId, 'video')
        await assertGenerationQueueCapacity(userId, 'video', 2)
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        if (error instanceof GenerationQueueFullError) return apiError(error.message, 429)
        throw error
    }

    const generations = await prisma.$transaction(
        COMPARISON_PROVIDERS.map(provider =>
            prisma.generation.create({
                data: {
                    id: genId(),
                    storyboardId,
                    type: COMPARISON_TYPE,
                    provider,
                    status: 'queued',
                    prompt: storyboard.videoPrompt ?? storyboard.actionDesc ?? storyboard.imagePrompt ?? ''
                }
            })
        )
    )
    const seedanceGeneration = generations.find(generation => generation.provider === 'seedance')!
    const wanGeneration = generations.find(generation => generation.provider === 'wanx')!

    after(async () => {
        const runWithVideoSlot = async (generationId: bigint, task: () => Promise<unknown>) => {
            try {
                const slotParams = {
                    userId,
                    projectId: storyboard.episode.projectId,
                    category: 'video' as const,
                    generationId
                }
                const claimed = (await tryClaimGenerationSlot(slotParams)) === 'claimed' || (await waitForGenerationSlot(slotParams))
                if (!claimed) return
                await task()
            } catch (error) {
                await prisma.generation.updateMany({
                    where: { id: generationId, status: { in: ['queued', 'processing'] } },
                    data: { status: 'failed', errorMsg: error instanceof Error ? error.message : String(error) }
                })
            }
        }
        const seedanceTask = runWithVideoSlot(seedanceGeneration.id, () =>
            withHiModelsUsageScope({ userId }, () =>
                generateVideo(seedanceGeneration.id, storyboard, {
                    provider: 'seedance',
                    referenceMode: 'single',
                    videoLanguage,
                    comparisonOnly: true
                })
            )
        )
        const wanTask = runWithVideoSlot(wanGeneration.id, () =>
            withHiModelsUsageScope({ userId }, () =>
                generateVideo(wanGeneration.id, storyboard, {
                    provider: 'wanx',
                    referenceMode: 'single',
                    videoLanguage,
                    comparisonOnly: true
                })
            )
        )
        await Promise.allSettled([seedanceTask, wanTask])
        await reconcileGenerationTelemetry(storyboard.episode.projectId).catch(() => {})
    })

    return apiResponse(
        generations.map(generation => ({
            id: generation.id,
            provider: generation.provider,
            status: generation.status,
            comparisonOnly: true
        })),
        202
    )
}
