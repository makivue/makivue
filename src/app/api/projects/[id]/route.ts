import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { cancelProjectOperations } from '@/lib/operation-cancellation'
import { markProjectDownstreamStaleInTransaction } from '@/services/content-lineage'
import { normalizeGenre } from '@/lib/project-metadata'
import { parseNovelSetup, stringifyNovelSetup } from '@/lib/novel'
import { syncSetupCharactersInTransaction } from '@/services/setup-characters'
import { publicationFieldsFromSetup } from '@/lib/project-publication'
import { isChapterFinalized, isScriptGenerated } from '@/lib/chapter-progress'
import { getProjectProductionProgress, hasMergedEpisodeVideo } from '@/lib/project-progress'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const project = await prisma.project.findFirst({
        where: { id: idNum, userId, deletedAt: null },
        select: {
            id: true,
            title: true,
            description: true,
            genre: true,
            totalEpisodes: true,
            seoTitle: true,
            seoDescription: true,
            seoKeywords: true,
            coverUrl: true,
            coverAlt: true,
            trailerUrl: true,
            trailerDuration: true,
            videoAspectRatio: true,
            visualStyle: true,
            contentLanguage: true,
            subtitleLanguages: true,
            episodeFormat: true,
            visibility: true,
            publishedAt: true,
            createdAt: true,
            updatedAt: true,
            novelSetup: true,
            novelStage: true,
            status: true,
            sourceVersion: true,
            staleScopes: true,
            operationVersion: true,
            characters: {
                where: { deletedAt: null },
                omit: { stateTimeline: true },
                include: {
                    referenceAssetRows: {
                        where: { deletedAt: null, role: 'turnaround_sheet' },
                        orderBy: { updatedAt: 'desc' }
                    },
                    seedancePortraitAssets: {
                        select: { id: true, role: true, sourceUrl: true, status: true, errorMsg: true, createdAt: true },
                        orderBy: { createdAt: 'desc' }
                    }
                }
            },
            scenes: { where: { deletedAt: null } },
            episodes: {
                where: { deletedAt: null },
                orderBy: { episodeNumber: 'asc' },
                select: {
                    id: true,
                    episodeNumber: true,
                    title: true,
                    synopsis: true,
                    videoUrl: true,
                    intensity: true,
                    status: true,
                    finalizedAt: true,
                    sourceVersion: true,
                    staleReason: true,
                    _count: { select: { storyboards: { where: { deletedAt: null } } } }
                }
            }
        }
    })
    if (!project) return apiError('Project not found', 404)
    const response = apiResponse({
        ...project,
        ...getProjectProductionProgress(project),
        // 长文本只在用户打开具体章节时由 /api/episodes/:id/content 返回。
        novel: null,
        episodes: project.episodes.map(episode => ({
            ...episode,
            // 列表页只需要完成状态，不下发成片地址；容器本地旧路径也不算
            // 可交付成片，避免展示一个实际无法播放的完成状态。
            hasMergedVideo: hasMergedEpisodeVideo(episode.videoUrl),
            videoUrl: undefined,
            chapterContent: null,
            script: null,
            hasChapterContent: ['drafting', 'drafted'].includes(episode.status ?? '') || isChapterFinalized(episode.status),
            hasScript: isScriptGenerated(episode.status)
        }))
    })
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return response
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(idNum, userId)
    if (guard) return guard
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('请求内容不是有效 JSON')
    const allowed = new Set(['title', 'description', 'genre', 'totalEpisodes', 'novel', 'novelSetup'])
    const unknown = Object.keys(body).filter(key => !allowed.has(key))
    if (unknown.length) return apiError(`不允许修改字段：${unknown.join('、')}`)
    const updateData: Record<string, unknown> = {}
    const episodesToCreate: { id: bigint; projectId: bigint; episodeNumber: number; title: string }[] = []
    let episodeIdsToRemove: bigint[] = []
    if ('title' in body) {
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 255) return apiError('项目标题长度应为 1-255 字')
        updateData.title = body.title.trim()
    }
    if ('description' in body) {
        if (body.description !== null && typeof body.description !== 'string') return apiError('项目简介格式无效')
        updateData.description = typeof body.description === 'string' ? body.description.slice(0, 20_000) : null
    }
    if ('genre' in body) {
        if (body.genre !== null && (typeof body.genre !== 'string' || body.genre.length > 50)) return apiError('题材格式无效')
        const genre = normalizeGenre(typeof body.genre === 'string' ? body.genre : null)
        updateData.genre = genre.label
        updateData.genreCode = genre.code
        updateData.genreLabel = genre.label
    }
    if ('novel' in body) {
        if (body.novel !== null && typeof body.novel !== 'string') return apiError('小说正文格式无效')
        updateData.novel = body.novel
    }
    if ('novelSetup' in body) {
        if (body.novelSetup !== null && (typeof body.novelSetup !== 'string' || body.novelSetup.length > 200_000)) return apiError('项目设定格式无效')
        const parsedSetup = parseNovelSetup(typeof body.novelSetup === 'string' ? body.novelSetup : null)
        updateData.novelSetup = body.novelSetup === null ? null : stringifyNovelSetup(parsedSetup)
        Object.assign(updateData, publicationFieldsFromSetup(parsedSetup))
    }

    if ('totalEpisodes' in body) {
        if (typeof body.totalEpisodes !== 'number' || !Number.isInteger(body.totalEpisodes) || body.totalEpisodes > 500) return apiError('章节数必须是 1-500 的整数')
        const nextTotal = body.totalEpisodes
        if (nextTotal < 1) return apiError('章节数至少 1')
        const current = await prisma.project.findFirst({
            where: { id: idNum, deletedAt: null },
            include: { episodes: { where: { deletedAt: null }, orderBy: { episodeNumber: 'asc' } } }
        })
        if (!current) return apiError('Project not found', 404)
        const currentTotal = current.totalEpisodes ?? 1

        if (nextTotal > currentTotal) {
            for (let n = currentTotal + 1; n <= nextTotal; n++) {
                if (!current.episodes.some(e => e.episodeNumber === n)) {
                    episodesToCreate.push({ id: genId(), projectId: idNum, episodeNumber: n, title: `第${n}章` })
                }
            }
        } else if (nextTotal < currentTotal) {
            const toRemove = current.episodes.filter(e => e.episodeNumber > nextTotal)
            const protectedStatuses = new Set(['finalized', 'scripted', 'storyboarded'])
            const blocking = toRemove.filter(e => protectedStatuses.has(e.status ?? '') || !!e.chapterContent || !!e.script)
            if (blocking.length > 0) {
                return apiError(`无法减少章节数：第 ${blocking.map(e => e.episodeNumber).join('、')} 章已有正文或已定稿，请先清空/解除定稿`)
            }
            episodeIdsToRemove = toRemove.map(e => e.id)
        }
        updateData.totalEpisodes = nextTotal
    }

    const hasLineageChange = Object.keys(updateData).some(key => ['description', 'genre', 'genreCode', 'genreLabel', 'totalEpisodes', 'novel', 'novelSetup'].includes(key))
    const project = await prisma.$transaction(async tx => {
        if (hasLineageChange) {
            const reason = '项目设定已修改，旧任务作废'
            await tx.projectAiJob.updateMany({
                where: { projectId: idNum, phase: { in: ['queued', 'running', 'generating', 'analyzing', 'writing_db', 'processing'] } },
                data: { phase: 'cancelled', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
            })
            await tx.extractJob.updateMany({
                where: { projectId: idNum, phase: { in: ['queued', 'running', 'generating', 'analyzing', 'filling', 'merging', 'writing_db', 'processing'] } },
                data: { phase: 'cancelled', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
            })
            await tx.outlineJob.updateMany({
                where: { projectId: idNum, phase: { in: ['queued', 'running', 'generating', 'filling', 'writing_db', 'processing'] } },
                data: { phase: 'cancelled', error: reason, activeKey: null, leaseOwner: null, leaseExpiresAt: null }
            })
            await markProjectDownstreamStaleInTransaction(tx, idNum, '项目上游内容或制作设定已修改，请重新生成受影响资产')
        }
        // Episode rows and totalEpisodes must commit together. Previously the
        // rows were changed before this transaction, so a later project update
        // failure could leave the saved count and actual chapters inconsistent.
        if (episodesToCreate.length > 0) await tx.episode.createMany({ data: episodesToCreate })
        if (episodeIdsToRemove.length > 0) {
            await tx.episode.updateMany({
                where: { id: { in: episodeIdsToRemove } },
                data: { deletedAt: new Date() }
            })
        }
        const updated = await tx.project.update({
            where: { id: idNum },
            data: {
                ...updateData,
                ...(hasLineageChange ? { operationVersion: { increment: 1 }, sourceVersion: { increment: 1 } } : {})
            }
        })
        if (typeof updateData.novelSetup === 'string') await syncSetupCharactersInTransaction(tx, idNum, parseNovelSetup(updateData.novelSetup))
        return updated
    })
    return apiResponse(project)
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(idNum, userId)
    if (guard) return guard
    await cancelProjectOperations(idNum, '项目已删除，旧任务作废', { deleteProject: true })
    return apiResponse({ id })
}
