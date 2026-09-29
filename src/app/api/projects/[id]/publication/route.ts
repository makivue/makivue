import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import {
    COVER_ALT_MAX_LENGTH,
    isProjectVisibility,
    normalizeCoverAlt,
    normalizeSeoDescription,
    normalizeSeoTitle,
    normalizeStringList,
    normalizeSubtitleLanguages,
    projectPublicationIssues,
    SEO_DESCRIPTION_MAX_LENGTH,
    SEO_KEYWORD_MAX_ITEMS,
    SEO_KEYWORD_MAX_LENGTH,
    SEO_TITLE_MAX_LENGTH
} from '@/lib/project-publication'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { getProjectProductionProgress } from '@/lib/project-progress'
import { normalizeGenre } from '@/lib/project-metadata'
import { publicationCoverCandidates, publicationTrailerCandidates } from '@/lib/publication-media'

type Params = { params: Promise<{ id: string }> }

const PUBLICATION_SELECT = {
    id: true,
    userId: true,
    title: true,
    description: true,
    genreCode: true,
    genreLabel: true,
    seoTitle: true,
    seoDescription: true,
    seoKeywords: true,
    coverUrl: true,
    coverAlt: true,
    publicationCoverCandidates: true,
    trailerUrl: true,
    trailerDuration: true,
    publicationTrailerCandidates: true,
    videoAspectRatio: true,
    visualStyle: true,
    contentLanguage: true,
    subtitleLanguages: true,
    episodeFormat: true,
    totalEpisodes: true,
    status: true,
    visibility: true,
    publishedAt: true,
    createdAt: true,
    updatedAt: true,
    novelSetup: true,
    characters: { where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 8, select: { name: true, referenceImageUrl: true } },
    scenes: { where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 8, select: { name: true, referenceImageUrl: true } },
    episodes: {
        where: { deletedAt: null },
        orderBy: { episodeNumber: 'asc' },
        select: {
            id: true,
            episodeNumber: true,
            title: true,
            status: true,
            videoUrl: true,
            storyboards: { where: { deletedAt: null }, orderBy: { order: 'asc' }, take: 3, select: { order: true, firstFrameUrl: true, lastFrameUrl: true } }
        }
    }
} as const

function publicationIssues(project: Parameters<typeof projectPublicationIssues>[0] & Parameters<typeof getProjectProductionProgress>[0], author: Parameters<typeof projectPublicationIssues>[1]) {
    const issues = projectPublicationIssues(project, author)
    if (getProjectProductionProgress(project).status !== 'completed') issues.push('请先生成所有集的合成视频')
    return issues
}

async function projectAuthor(userId: bigint) {
    const [profile, identity] = await Promise.all([
        prisma.userProfile.findUnique({ where: { userId }, select: { displayName: true, avatarUrl: true } }),
        prisma.userIdentity.findUnique({ where: { userId_provider: { userId, provider: 'google' } }, select: { displayName: true, avatarUrl: true } })
    ])
    return {
        displayName: profile?.displayName ?? identity?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? identity?.avatarUrl ?? null
    }
}

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const project = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: PUBLICATION_SELECT })
    if (!project) return apiError('Project not found', 404)
    const author = await projectAuthor(userId)
    const { episodes, characters, scenes, novelSetup, publicationCoverCandidates: storedCovers, publicationTrailerCandidates: storedTrailers, ...metadata } = project
    const response = apiResponse({
        ...metadata,
        ...getProjectProductionProgress({ ...metadata, episodes }),
        author,
        coverCandidates: publicationCoverCandidates({ ...project, publicationCoverCandidates: storedCovers, novelSetup, characters, scenes, episodes }),
        trailerCandidates: publicationTrailerCandidates({ ...project, publicationTrailerCandidates: storedTrailers, episodes }),
        publicationIssues: publicationIssues(project, author)
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
}

export async function PATCH(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('请求内容不是有效 JSON')
    const allowed = new Set(['genre', 'seoTitle', 'seoDescription', 'seoKeywords', 'coverAlt', 'subtitleLanguages', 'visibility'])
    const unknown = Object.keys(body).filter(key => !allowed.has(key))
    if (unknown.length) return apiError(`不允许修改字段：${unknown.join('、')}`)

    const update: Prisma.ProjectUncheckedUpdateInput = {}
    let requestedGenre: ReturnType<typeof normalizeGenre> | null = null
    if ('genre' in body) {
        if (typeof body.genre !== 'string' || !body.genre.trim() || body.genre.trim().length > 50) return apiError('作品类型格式无效')
        requestedGenre = normalizeGenre(body.genre)
        update.genre = requestedGenre.label
        update.genreCode = requestedGenre.code
        update.genreLabel = requestedGenre.label
    }
    if ('seoTitle' in body) {
        if (body.seoTitle !== null && typeof body.seoTitle !== 'string') return apiError('SEO 标题格式无效')
        if (typeof body.seoTitle === 'string' && body.seoTitle.trim().length > SEO_TITLE_MAX_LENGTH) return apiError(`SEO 标题不能超过 ${SEO_TITLE_MAX_LENGTH} 个字符`)
        update.seoTitle = normalizeSeoTitle(body.seoTitle)
    }
    if ('seoDescription' in body) {
        if (body.seoDescription !== null && typeof body.seoDescription !== 'string') return apiError('SEO 描述格式无效')
        if (typeof body.seoDescription === 'string' && body.seoDescription.trim().length > SEO_DESCRIPTION_MAX_LENGTH) {
            return apiError(`SEO 描述不能超过 ${SEO_DESCRIPTION_MAX_LENGTH} 个字符`)
        }
        update.seoDescription = normalizeSeoDescription(body.seoDescription)
    }
    if ('seoKeywords' in body) {
        if (body.seoKeywords !== null && typeof body.seoKeywords !== 'string' && !Array.isArray(body.seoKeywords)) return apiError('SEO 关键词格式无效')
        const keywords = normalizeStringList(body.seoKeywords)
        const rawItems = Array.isArray(body.seoKeywords) ? body.seoKeywords : typeof body.seoKeywords === 'string' ? body.seoKeywords.split(/[\n,，;；]+/) : []
        if (rawItems.filter(item => typeof item === 'string' && item.trim()).length > SEO_KEYWORD_MAX_ITEMS) return apiError(`SEO 关键词最多 ${SEO_KEYWORD_MAX_ITEMS} 个`)
        if (rawItems.some(item => typeof item === 'string' && item.trim().length > SEO_KEYWORD_MAX_LENGTH)) return apiError(`每个 SEO 关键词不能超过 ${SEO_KEYWORD_MAX_LENGTH} 个字符`)
        update.seoKeywords = keywords
    }
    if ('coverAlt' in body) {
        if (body.coverAlt !== null && typeof body.coverAlt !== 'string') return apiError('封面替代文本格式无效')
        if (typeof body.coverAlt === 'string' && body.coverAlt.trim().length > COVER_ALT_MAX_LENGTH) return apiError(`封面替代文本不能超过 ${COVER_ALT_MAX_LENGTH} 个字符`)
        update.coverAlt = normalizeCoverAlt(body.coverAlt)
    }
    if ('subtitleLanguages' in body) {
        if (!Array.isArray(body.subtitleLanguages)) return apiError('字幕语言格式无效')
        const subtitleLanguages = normalizeSubtitleLanguages(body.subtitleLanguages)
        if (subtitleLanguages.length !== new Set(body.subtitleLanguages).size) return apiError('字幕语言包含不支持的值')
        update.subtitleLanguages = subtitleLanguages
    }
    if ('visibility' in body) {
        if (!isProjectVisibility(body.visibility)) return apiError('作品可见性格式无效')
        update.visibility = body.visibility
    }

    const current = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: PUBLICATION_SELECT })
    if (!current) return apiError('Project not found', 404)
    const author = await projectAuthor(userId)
    const requestedVisibility = isProjectVisibility(body.visibility) ? body.visibility : current.visibility
    const candidate = {
        ...current,
        genreLabel: requestedGenre?.label ?? current.genreLabel,
        seoTitle: 'seoTitle' in body ? normalizeSeoTitle(body.seoTitle) : current.seoTitle,
        seoDescription: 'seoDescription' in body ? normalizeSeoDescription(body.seoDescription) : current.seoDescription,
        seoKeywords: 'seoKeywords' in body ? normalizeStringList(body.seoKeywords) : current.seoKeywords,
        subtitleLanguages: 'subtitleLanguages' in body ? normalizeSubtitleLanguages(body.subtitleLanguages) : current.subtitleLanguages,
        visibility: requestedVisibility
    }
    const issues = publicationIssues(candidate, author)
    if (requestedVisibility === 'public' && issues.length > 0) return apiError(`发布前请完善：${issues.join('；')}`, 422)

    update.publishedAt = requestedVisibility === 'private' ? null : (current.publishedAt ?? new Date())
    const saved = await prisma.project.update({ where: { id: projectId }, data: update, select: PUBLICATION_SELECT })
    const { episodes, characters, scenes, novelSetup, publicationCoverCandidates: storedCovers, publicationTrailerCandidates: storedTrailers, ...metadata } = saved
    return apiResponse({
        ...metadata,
        ...getProjectProductionProgress({ ...metadata, episodes }),
        author,
        coverCandidates: publicationCoverCandidates({ ...saved, publicationCoverCandidates: storedCovers, novelSetup, characters, scenes, episodes }),
        trailerCandidates: publicationTrailerCandidates({ ...saved, publicationTrailerCandidates: storedTrailers, episodes }),
        publicationIssues: publicationIssues(saved, author)
    })
}
