import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { validateVideoSegments } from '@/services/ffmpeg'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { parseApiId } from '@/lib/api-id'
import { kickDurableMediaWorker } from '@/services/durable-media-worker'
import { assessEpisodeMergeReadiness, effectiveEpisodeMergeVideoPath, type EpisodeMergeStoryboard } from '@/lib/episode-merge-readiness'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard
    const merge = await prisma.videoMerge.findFirst({
        where: { episodeId: idNum },
        orderBy: { createdAt: 'desc' }
    })
    return apiResponse(merge)
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(idNum, userId)
    if (guard) return guard

    // Reuse an in-flight merge instead of creating another expensive FFmpeg job
    // when the client retries, double-clicks, or reconnects after a timeout.
    const activeKey = `episode:${idNum}:merge`
    const activeMerge = await prisma.videoMerge.findFirst({
        where: { activeKey },
        orderBy: { createdAt: 'desc' }
    })
    if (activeMerge) return apiResponse(activeMerge, 202)

    const storyboards = await prisma.storyboard.findMany({
        where: { episodeId: idNum, deletedAt: null },
        orderBy: { order: 'asc' },
        include: {
            generations: {
                where: { type: 'video' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { provider: true, status: true }
            }
        }
    })

    const readiness = assessEpisodeMergeReadiness(storyboards as EpisodeMergeStoryboard[])
    if (!readiness.ready) {
        if (readiness.stage === 'video') return apiError(`还有 ${readiness.count} 个分镜视频未完成，完成后才能合并`, 422)
        if (readiness.stage === 'video_audio') {
            return apiError(`${readiness.count} 个有对白镜头需要重新生成带原声的视频，完成后再合并`, 422)
        }
        return apiError(`${readiness.count} 个镜头缺少可合并的视频，请重新生成对应镜头`, 422)
    }

    const videoPaths = storyboards.map(storyboard => effectiveEpisodeMergeVideoPath(storyboard as EpisodeMergeStoryboard)!)
    // local storage 远程视频的 ffprobe/下载可能耗时很久，不要在 HTTP 请求内逐个探测，
    // 否则几十个镜头会触发 upstream timeout。远程视频交给后台合并任务校验。
    const localVideoPaths = videoPaths.filter(path => !/^https?:\/\//i.test(path))
    const validation = localVideoPaths.length > 0 ? await validateVideoSegments(localVideoPaths) : []
    const invalid = validation.filter(item => !item.valid)
    if (invalid.length > 0) {
        const details = invalid.map(item => `本地视频 ${item.path}：${item.reason}`).join('；')
        return apiError(`无法合并：存在无效分镜视频（${details}）。请重新合成对应镜头。`, 422)
    }

    const quotedPoints = quoteGenerationPoints('merge', 'ffmpeg')
    try {
        await assertSufficientPoints(userId, quotedPoints)
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const episode = await prisma.episode.findUnique({ where: { id: idNum }, select: { operationVersion: true } })
    if (!episode) return apiError('Episode not found', 404)
    let merge
    try {
        merge = await prisma.videoMerge.create({
            data: {
                id: genId(),
                episodeId: idNum,
                status: 'processing',
                videoStatus: 'processing',
                subtitleStatus: 'pending',
                activeKey,
                resourceVersion: episode.operationVersion
            }
        })
    } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
            const duplicate = await prisma.videoMerge.findUnique({ where: { activeKey } })
            if (duplicate) return apiResponse(duplicate, 202)
        }
        throw error
    }

    kickDurableMediaWorker()

    return apiResponse(merge, 202)
}
