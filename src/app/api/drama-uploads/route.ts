import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { DRAMA_MAX_EPISODES } from '@/lib/drama-upload'
import { genId } from '@/lib/id'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { isLocale } from '@/i18n/config'
import { createDramaUploadStore, DramaUploadError } from '@/services/drama-upload'
import { DRAMA_UPLOAD_SOURCE, isUploadedDrama, uploadedDramaCast, uploadedDramaSource } from '@/lib/uploaded-drama'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    try {
        const projects = await prisma.project.findMany({
            where: { userId, deletedAt: null },
            select: {
                id: true,
                title: true,
                description: true,
                genre: true,
                totalEpisodes: true,
                coverUrl: true,
                contentLanguage: true,
                subtitleLanguages: true,
                visibility: true,
                createdAt: true,
                sourceAnswers: true,
                _count: { select: { episodes: { where: { deletedAt: null } } } }
            },
            orderBy: { createdAt: 'desc' }
        })
        return apiResponse(
            projects
                .filter(project => isUploadedDrama(project.sourceAnswers))
                .map(project => {
                    const source = uploadedDramaSource(project.sourceAnswers)
                    return {
                        id: project.id,
                        title: project.title,
                        description: project.description,
                        genre: project.genre,
                        totalEpisodes: project.totalEpisodes,
                        episodeCount: project._count.episodes,
                        coverUrl: project.coverUrl,
                        contentLanguage: project.contentLanguage,
                        subtitleLanguages: project.subtitleLanguages,
                        visibility: project.visibility,
                        createdAt: project.createdAt,
                        year: typeof source.year === 'number' ? source.year : null,
                        cast: uploadedDramaCast(source.cast)
                    }
                })
        )
    } catch (error) {
        console.error('Failed to load uploaded dramas:', error)
        return apiError('上传作品暂时无法加载，请稍后重试', 503)
    }
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('上传内容无效')
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 255) return apiError('请填写标题，最多 255 字')
    if (typeof body.description !== 'string' || !body.description.trim() || body.description.trim().length > 20_000) return apiError('请填写简介，最多 20000 字')
    if (!body.cover || !Array.isArray(body.episodes) || !body.episodes.length || body.episodes.length > DRAMA_MAX_EPISODES) return apiError('请上传封面和至少一集视频')
    if (body.genre && (typeof body.genre !== 'string' || body.genre.length > 50)) return apiError('上传内容无效')
    if ((body.language && !isLocale(body.language)) || (body.subtitleLanguage && !isLocale(body.subtitleLanguage))) return apiError('上传内容无效')
    if (body.year && (!Number.isInteger(body.year) || body.year < 1888 || body.year > new Date().getFullYear() + 5)) return apiError('年份格式无效')
    if (body.cast !== undefined && (!Array.isArray(body.cast) || body.cast.length > 100)) return apiError('上传内容无效')
    try {
        const store = await createDramaUploadStore(userId)
        const cover = store.readReceipt(body.cover, 'cover')
        const projectId = BigInt(cover.id)
        const episodes = body.episodes.map((episode: { video?: unknown; title?: unknown; subtitle?: unknown }) => {
            if (!episode || typeof episode !== 'object' || (episode.title !== undefined && (typeof episode.title !== 'string' || episode.title.length > 255)))
                throw new DramaUploadError('上传内容无效')
            return {
                video: store.readReceipt(episode.video, 'video'),
                subtitle: episode.subtitle ? store.readReceipt(episode.subtitle, 'subtitle') : null,
                title: typeof episode.title === 'string' ? episode.title.trim() : ''
            }
        })
        if (new Set(episodes.map((episode: { video: { id: string } }) => episode.video.id)).size !== episodes.length) return apiError('剧集视频不能重复')
        const cast = (body.cast ?? []).map((person: { name?: unknown; role?: unknown; job?: unknown; portrait?: unknown }) => {
            if (!person || typeof person !== 'object') throw new DramaUploadError('上传内容无效')
            for (const value of [person.name, person.role, person.job]) if (value !== undefined && (typeof value !== 'string' || value.length > 100)) throw new DramaUploadError('上传内容无效')
            return {
                name: String(person.name ?? '').trim(),
                role: String(person.role ?? '').trim(),
                job: String(person.job ?? '').trim(),
                imageUrl: person.portrait ? store.readReceipt(person.portrait, 'portrait').url : null
            }
        })
        // The cover's signed Sonyflake ID makes retrying a save idempotent, including a lost response.
        const existing = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: { id: true } })
        if (existing) return apiResponse({ id: existing.id }, 200)
        await prisma.$transaction(
            async tx => {
                await tx.project.create({
                    data: {
                        id: projectId,
                        userId,
                        title: body.title.trim(),
                        description: body.description.trim(),
                        coverUrl: cover.url,
                        coverAlt: body.title.trim(),
                        genre: body.genre || null,
                        genreLabel: body.genre || null,
                        contentLanguage: body.language || null,
                        subtitleLanguages: body.subtitleLanguage ? [body.subtitleLanguage] : [],
                        totalEpisodes: episodes.length,
                        status: 'completed',
                        visibility: 'public',
                        publishedAt: new Date(),
                        sourceAnswers: { source: DRAMA_UPLOAD_SOURCE, year: body.year || null, cast, subtitleLanguage: body.subtitleLanguage || null }
                    }
                })
                const identifiedEpisodes = episodes.map((episode: (typeof episodes)[number]) => ({ ...episode, id: genId() }))
                await tx.episode.createMany({
                    data: identifiedEpisodes.map((episode: (typeof identifiedEpisodes)[number], index: number) => ({
                        id: episode.id,
                        projectId,
                        episodeNumber: index + 1,
                        title: episode.title || episode.video.name.replace(/\.[^.]+$/, ''),
                        videoUrl: episode.video.url,
                        status: 'completed',
                        finalizedAt: new Date()
                    }))
                })
                await tx.videoMerge.createMany({
                    data: identifiedEpisodes.map((episode: (typeof identifiedEpisodes)[number]) => ({
                        id: genId(),
                        episodeId: episode.id,
                        videoUrl: episode.video.url,
                        duration: episode.video.duration,
                        status: 'completed',
                        videoStatus: 'completed',
                        subtitleStatus: episode.subtitle ? 'completed' : 'pending',
                        subtitleUrls: episode.subtitle ? JSON.stringify({ [body.subtitleLanguage || body.language || 'und']: episode.subtitle.url }) : null
                    }))
                })
            },
            { timeout: 30_000 }
        )
        return apiResponse({ id: projectId }, 201)
    } catch (error) {
        if (error instanceof DramaUploadError) return apiError(error.message, error.status)
        // A concurrent retry may have committed the same signed cover ID already.
        return apiError('保存失败，请稍后重试', 503)
    }
}
