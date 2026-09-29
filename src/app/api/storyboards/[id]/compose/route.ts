import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError, handleApiError } from '@/lib/utils'
import { probeMediaStreams, validateVideoSegments } from '@/services/ffmpeg'
import { currentUserId } from '@/lib/current-user'
import { assertStoryboardOwner } from '@/lib/ownership'
import { genId } from '@/lib/id'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { usesEmbeddedVideoAudio } from '@/lib/video-audio-policy'
import { parseApiId } from '@/lib/api-id'
import { kickDurableMediaWorker } from '@/services/durable-media-worker'
import { clearEpisodeMergedVideoInTransaction } from '@/services/artifacts'

type Params = { params: Promise<{ id: string }> }

function isPrimaryKeyConflict(error: unknown) {
    return /unique constraint failed.*primary|duplicate entry/i.test(error instanceof Error ? error.message : String(error))
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('分镜 ID 格式无效', 400)
    const guard = await assertStoryboardOwner(idNum, userId)
    if (guard) return guard
    const requestBody = (await req.json().catch(() => ({}))) as { validateExisting?: boolean }

    const storyboard = await prisma.storyboard.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            episode: { select: { projectId: true } },
            generations: {
                where: { type: 'video', status: 'completed' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { provider: true }
            }
        }
    })
    if (!storyboard) return apiError('Storyboard not found', 404)
    if (!storyboard.videoUrl) return apiError('Video not generated yet')

    // 原生音频能力只是 Provider 契约，仍需探测本次实际输出，不能把无音轨文件静默确认为成片。
    if (usesEmbeddedVideoAudio(storyboard.generations[0]?.provider)) {
        const streams = await probeMediaStreams(storyboard.videoUrl)
        if (!streams.hasVideo || !streams.hasAudio) return apiError('视频模型本次输出缺少可用音轨，不能确认为原生成片；请重新生成带原声的视频', 422)
        if (storyboard.composedVideoUrl === storyboard.videoUrl && storyboard.composeStatus === 'completed' && storyboard.compositionMode === 'passthrough') {
            return apiResponse({ id, status: 'completed', skipped: true, nativeAudio: true, resultUrl: storyboard.videoUrl })
        }
        const applied = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${storyboard.episodeId} FOR UPDATE`
            const updated = await tx.storyboard.updateMany({
                where: { id: idNum, deletedAt: null, operationVersion: storyboard.operationVersion, videoUrl: storyboard.videoUrl },
                data: {
                    composedVideoUrl: storyboard.videoUrl,
                    composeStatus: 'completed',
                    compositionMode: 'passthrough',
                    expectedAudioMode: storyboard.dialogue?.trim() ? 'native_dialogue' : 'native_ambience'
                }
            })
            if (updated.count === 1) await clearEpisodeMergedVideoInTransaction(tx, storyboard.episodeId)
            return updated.count === 1
        })
        if (!applied) return apiError('视频已更新，本次合成未覆盖新版本，请刷新后重试', 409)
        return apiResponse({ id, status: 'completed', skipped: true, nativeAudio: true, resultUrl: storyboard.videoUrl }, 200)
    }

    if (storyboard.dialogue?.trim() && !storyboard.audioUrl) {
        return apiError('当前视频不包含原生对白，也没有可用的历史外部音轨。请改用支持原生对白的视频模型重新生成。', 422)
    }

    // 一键合成的 missing 模式会先扫描已有成片；有效文件直接跳过，0:00/损坏文件才重新进入 FFmpeg。
    if (requestBody.validateExisting && storyboard.composeStatus === 'completed' && storyboard.composedVideoUrl) {
        const [validation] = await validateVideoSegments([storyboard.composedVideoUrl])
        if (validation?.valid) return apiResponse({ id, status: 'completed', skipped: true }, 200)
        await prisma.storyboard.updateMany({
            where: { id: idNum, deletedAt: null, operationVersion: storyboard.operationVersion, composedVideoUrl: storyboard.composedVideoUrl },
            data: { composeStatus: 'failed' }
        })
    }

    // 一键合成和分镜卡片可能在同一时间触发同一个镜头。
    // 复用已有后台任务，避免重复启动 ffmpeg、占满连接池后引发 503/504。
    const activeKey = `storyboard:${idNum}:compose`
    let active: { id: bigint } | null = null
    try {
        active = await prisma.generation.findFirst({
            where: { activeKey },
            orderBy: { createdAt: 'desc' },
            select: { id: true }
        })
    } catch (error) {
        console.error(`[Compose ${id}] active task lookup failed`, error)
        return handleApiError(error, '合成任务状态读取失败，请稍后重试', 503)
    }
    if (active) return apiResponse({ id, status: 'processing', generationId: active.id }, 202)

    try {
        await assertSufficientPoints(userId, quoteGenerationPoints('compose', 'ffmpeg', storyboard.duration ?? 0))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    try {
        let generation
        let lastError: unknown
        // 兼容旧容器仍使用固定 machine id 的情况：即使发生一次主键碰撞，
        // 也只重试任务记录创建，不重复启动 FFmpeg。
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                generation = await prisma.generation.create({
                    data: {
                        id: genId(),
                        storyboardId: idNum,
                        type: 'compose',
                        provider: 'ffmpeg',
                        status: 'processing',
                        activeKey,
                        resourceVersion: storyboard.operationVersion
                    }
                })
                break
            } catch (error) {
                lastError = error
                if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
                    const duplicate = await prisma.generation.findUnique({ where: { activeKey }, select: { id: true } })
                    if (duplicate) return apiResponse({ id, status: 'processing', generationId: duplicate.id }, 202)
                }
                if (!isPrimaryKeyConflict(error) || attempt === 3) throw error
            }
        }
        if (!generation) throw lastError ?? new Error('合成任务创建失败')
        const applied = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${storyboard.episodeId} FOR UPDATE`
            const updated = await tx.storyboard.updateMany({
                where: { id: idNum, deletedAt: null, operationVersion: storyboard.operationVersion },
                data: { composedVideoUrl: null, compositionMode: null, composeStatus: 'processing' }
            })
            if (updated.count === 1) await clearEpisodeMergedVideoInTransaction(tx, storyboard.episodeId)
            return updated.count === 1
        })
        if (!applied) {
            await prisma.generation.updateMany({ where: { id: generation.id }, data: { status: 'cancelled', activeKey: null } })
            return apiError('分镜已更新，请刷新后重新合成', 409)
        }

        kickDurableMediaWorker()

        return apiResponse({ id, status: 'processing', generationId: generation.id }, 202)
    } catch (error) {
        console.error(`[Compose ${id}] request failed`, error)
        return handleApiError(error, '合成任务创建失败，请稍后重试', 503)
    }
}
