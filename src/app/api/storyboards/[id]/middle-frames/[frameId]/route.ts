import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { apiResponse, apiError } from '@/lib/utils'
import { generateFrame } from '@/services/ai'
import { isImageProvider, type ImageProvider, type VideoProvider } from '@/services/ai'
import { resetFollowingContinuousMediaInTransaction, resetStoryboardMediaInTransaction, StaleStoryboardMutationError } from '@/services/artifacts'
import { normalizeImageQuality } from '@/lib/image-quality'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { reconcileGenerationTelemetry } from '@/services/production-observability'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string; frameId: string }> }
export const maxDuration = 600

function parseMiddleFrameMeta(requestBody: string | null | undefined, fallbackIndex: number) {
    if (!requestBody) return { index: fallbackIndex, count: fallbackIndex }
    try {
        const parsed = JSON.parse(requestBody)
        const index = Number(parsed?.middleFrameIndex)
        const count = Number(parsed?.middleFrameCount)
        return {
            index: Number.isFinite(index) && index > 0 ? Math.round(index) : fallbackIndex,
            count: Number.isFinite(count) && count > 0 ? Math.round(count) : fallbackIndex
        }
    } catch {
        return { index: fallbackIndex, count: fallbackIndex }
    }
}

async function getMiddleFrames(storyboardId: bigint) {
    const rows = await prisma.generation.findMany({
        where: { storyboardId, type: 'middle_frame', status: 'completed', resultUrl: { not: null } },
        orderBy: { createdAt: 'asc' }
    })

    return rows
        .map((row, fallbackIndex) => ({
            row,
            ...parseMiddleFrameMeta(row.requestBody, fallbackIndex + 1)
        }))
        .sort((a, b) => a.index - b.index || (a.row.createdAt?.getTime() ?? 0) - (b.row.createdAt?.getTime() ?? 0))
}

async function getRestoredFrameStatus(storyboardId: bigint) {
    const storyboard = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        select: { firstFrameUrl: true, plannedLastFrameUrl: true, lastFrameUrl: true }
    })
    return storyboard?.firstFrameUrl || storyboard?.plannedLastFrameUrl || storyboard?.lastFrameUrl ? 'completed' : 'pending'
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, frameId } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const frameIdNum = parseApiId(frameId)
    if (frameIdNum === null) return apiError('中间帧 ID 格式无效', 400)
    const frame = await prisma.generation.findFirst({
        where: { id: frameIdNum, storyboardId: idNum, type: 'middle_frame', status: { not: 'archived' } },
        include: { storyboard: true }
    })
    if (!frame) return apiError('Middle frame not found', 404)

    try {
        await prisma.$transaction(
            async tx => {
                await resetStoryboardMediaInTransaction(tx, frame.storyboard, ['video'], '中间帧已删除，旧视频已重置')
                await tx.generation.updateMany({ where: { id: frameIdNum }, data: { status: 'archived', activeKey: null } })
                await resetFollowingContinuousMediaInTransaction(tx, frame.storyboard.episodeId, frame.storyboard.order)
            },
            { timeout: 60_000 }
        )
    } catch (error) {
        if (error instanceof StaleStoryboardMutationError) return apiError(error.message, 409)
        throw error
    }

    return apiResponse({ id: frameId, deleted: true })
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id, frameId } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const frameIdNum = parseApiId(frameId)
    if (frameIdNum === null) return apiError('中间帧 ID 格式无效', 400)
    const body = await req.json().catch(() => ({}))
    const videoProvider: VideoProvider | undefined =
        body.provider === 'wanx' || body.provider === 'wan3' || body.provider === 'wan3prime' || body.provider === 'seedance' || body.provider === 'seedance25' ? body.provider : undefined
    const imageProvider: ImageProvider | undefined = isImageProvider(body.imageProvider) ? body.imageProvider : undefined
    const imageQuality = normalizeImageQuality(body.imageQuality)

    const target = await prisma.generation.findFirst({
        where: { id: frameIdNum, storyboardId: idNum, type: 'middle_frame', status: 'completed' }
    })
    if (!target) return apiError('Middle frame not found', 404)

    const storyboard = await prisma.storyboard.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            characters: { include: { character: true } },
            scene: true,
            episode: { select: { projectId: true } }
        }
    })
    if (!storyboard) return apiError('Storyboard not found', 404)
    if (!storyboard.firstFrameUrl) return apiError('Regenerating a middle frame requires an existing first frame', 409)

    const middleFrames = await getMiddleFrames(idNum)
    const targetPosition = middleFrames.findIndex(item => item.row.id === frameIdNum)
    const targetMeta = parseMiddleFrameMeta(target.requestBody, targetPosition >= 0 ? targetPosition + 1 : 1)
    const middleFrameCount = Math.max(targetMeta.count, middleFrames.length, targetMeta.index)
    const previous = middleFrames
        .filter(item => item.row.id !== frameIdNum && item.index < targetMeta.index)
        .sort((a, b) => b.index - a.index || (b.row.createdAt?.getTime() ?? 0) - (a.row.createdAt?.getTime() ?? 0))[0]
    const next = middleFrames
        .filter(item => item.row.id !== frameIdNum && item.index > targetMeta.index)
        .sort((a, b) => a.index - b.index || (a.row.createdAt?.getTime() ?? 0) - (b.row.createdAt?.getTime() ?? 0))[0]
    const continuityFrameUrl = previous?.row.resultUrl ?? storyboard.firstFrameUrl
    const continuityFrameLabel = previous ? `intermediate frame ${previous.index}` : 'opening frame'
    const plannedEndingFrameUrl = storyboard.plannedLastFrameUrl ?? storyboard.lastFrameUrl
    const nextContinuityFrameUrl = next?.row.resultUrl ?? plannedEndingFrameUrl ?? null
    const nextContinuityFrameLabel = next ? `intermediate frame ${next.index}` : plannedEndingFrameUrl ? 'planned ending frame' : undefined
    const taskProvider = imageProvider ?? 'banana'
    try {
        await assertSufficientPoints(userId, quoteGenerationPoints('middle_frame', taskProvider, storyboard.duration ?? 0))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const generation = await prisma.generation.create({
        data: {
            id: genId(),
            storyboardId: idNum,
            type: 'middle_frame',
            provider: taskProvider,
            status: 'processing',
            prompt: storyboard.imagePrompt ?? '',
            resourceVersion: storyboard.operationVersion
        }
    })
    try {
        const updated = await prisma.$transaction(
            async tx => {
                const current = await resetStoryboardMediaInTransaction(tx, storyboard, ['video'], '中间帧重新生成，旧视频已重置', {
                    preserveGenerationId: generation.id,
                    patch: { frameStatus: 'generating' }
                })
                await tx.generation.updateMany({ where: { id: frameIdNum }, data: { status: 'archived', activeKey: null } })
                await resetFollowingContinuousMediaInTransaction(tx, storyboard.episodeId, storyboard.order)
                return current
            },
            { timeout: 60_000 }
        )
        Object.assign(storyboard, updated)
    } catch (error) {
        await prisma.generation.updateMany({ where: { id: generation.id, status: 'processing' }, data: { status: 'cancelled', activeKey: null, errorMsg: '分镜已变化，旧任务作废' } })
        if (error instanceof StaleStoryboardMutationError) return apiError(error.message, 409)
        throw error
    }

    after(async () => {
        try {
            const ok = await withHiModelsUsageScope({ userId }, () =>
                generateFrame(generation.id, storyboard, 'middle_frame', {
                    ...(videoProvider ? { videoProvider } : {}),
                    ...(imageProvider ? { provider: imageProvider } : {}),
                    imageQuality,
                    middleFrameIndex: targetMeta.index,
                    middleFrameCount,
                    continuityFrameUrl,
                    continuityFrameLabel,
                    nextContinuityFrameUrl,
                    ...(nextContinuityFrameLabel ? { nextContinuityFrameLabel } : {})
                })
            )

            if (ok) {
                const applied = await prisma.storyboard.updateMany({
                    where: { id: idNum, deletedAt: null, operationVersion: storyboard.operationVersion },
                    data: { frameStatus: 'completed' }
                })
                if (applied.count !== 1) throw new StaleStoryboardMutationError()
                return
            }

            await prisma.storyboard.updateMany({
                where: { id: idNum, deletedAt: null, operationVersion: storyboard.operationVersion },
                data: { frameStatus: await getRestoredFrameStatus(idNum) }
            })
        } catch (error) {
            if (error instanceof StaleStoryboardMutationError) {
                await prisma.generation.updateMany({ where: { id: generation.id }, data: { status: 'archived', activeKey: null } })
                return
            }
            console.error(error)
        } finally {
            try {
                await reconcileGenerationTelemetry(storyboard.episode.projectId)
            } catch (observabilityError) {
                console.error('[middle-frame] billing/telemetry reconciliation failed:', observabilityError)
            }
        }
    })

    return apiResponse(generation, 202)
}
