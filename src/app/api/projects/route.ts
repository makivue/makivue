import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { getVisualStyle, getVisualStyleProfile, parseNovelSetup, stringifyNovelSetup } from '@/lib/novel'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { defaultEpisodeTitle, normalizeContentLanguage } from '@/lib/content-language'
import { normalizeGenre } from '@/lib/project-metadata'
import { DEFAULT_SUBTITLE_LANGUAGES, isProjectEpisodeFormat, normalizeStringList, publicationFieldsFromSetup } from '@/lib/project-publication'
import { assertWalletHasCoins, BillingError } from '@/services/billing'
import { getProjectProductionProgress } from '@/lib/project-progress'

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    try {
        const projects = await prisma.project.findMany({
            where: { deletedAt: null, userId },
            select: {
                id: true,
                title: true,
                description: true,
                genre: true,
                totalEpisodes: true,
                coverUrl: true,
                videoAspectRatio: true,
                visualStyle: true,
                contentLanguage: true,
                visibility: true,
                publishedAt: true,
                status: true,
                createdAt: true,
                episodes: { where: { deletedAt: null }, select: { status: true, videoUrl: true } },
                _count: { select: { episodes: { where: { deletedAt: null } }, characters: { where: { deletedAt: null } } } }
            },
            orderBy: { createdAt: 'desc' }
        })
        const response = apiResponse(projects.map(({ episodes, ...project }) => ({ ...project, ...getProjectProductionProgress({ ...project, episodes }) })))
        response.headers.set('Cache-Control', 'private, no-store, max-age=0')
        return response
    } catch (error) {
        console.error('Failed to load projects:', error)
        return apiError('项目服务暂时无法连接，请稍后重试', 503)
    }
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)

    const body = await req.json()
    const { title, description, genre, totalEpisodes, videoAspectRatio, visualStyle, contentLanguage, episodeFormat, seoKeywords, sourceAnswers, directionCandidates, selectedDirectionId } = body
    if (!title) return apiError('title is required')
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 255) return apiError('项目标题长度应为 1-255 字')
    const safeTitle = title.trim()
    const safeDescription = typeof description === 'string' ? description.slice(0, 20_000) : null
    const safeTotalEpisodes = Math.max(1, Number(totalEpisodes) || 1)
    const setup = parseNovelSetup(null)
    const safeContentLanguage = normalizeContentLanguage(contentLanguage)
    const normalizedGenre = normalizeGenre(genre)
    const safeDirections = Array.isArray(directionCandidates) ? directionCandidates.slice(0, 10) : undefined
    const safeSelectedDirectionId = typeof selectedDirectionId === 'string' && safeDirections?.some(direction => direction?.mode === selectedDirectionId) ? selectedDirectionId : undefined
    const safeSourceAnswers = sourceAnswers && typeof sourceAnswers === 'object' && !Array.isArray(sourceAnswers) ? sourceAnswers : undefined
    const resolvedVisualStyle = getVisualStyle(typeof visualStyle === 'string' ? visualStyle : setup.visualStyle)
    const safeEpisodeFormat = isProjectEpisodeFormat(episodeFormat) ? episodeFormat : 'micro'
    const publicationFields = publicationFieldsFromSetup({
        ...setup,
        contentLanguage: safeContentLanguage,
        videoAspectRatio: videoAspectRatio === '16:9' || videoAspectRatio === '1:1' ? videoAspectRatio : '9:16',
        visualStyle: resolvedVisualStyle.key,
        episodeFormat: safeEpisodeFormat
    })
    const requestedSeoKeywords = normalizeStringList(seoKeywords)
    const safeSeoKeywords = requestedSeoKeywords.length > 0 ? requestedSeoKeywords : normalizeStringList([normalizedGenre.label, safeTitle])
    const projectId = genId()

    try {
        await assertWalletHasCoins(userId)
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '积分校验失败', error instanceof BillingError ? error.status : 500)
    }

    try {
        const project = await prisma.$transaction(async transaction => {
            const created = await transaction.project.create({
                data: {
                    id: projectId,
                    userId,
                    title: safeTitle,
                    description: safeDescription,
                    genre: normalizedGenre.label,
                    genreCode: normalizedGenre.code,
                    genreLabel: normalizedGenre.label,
                    sourceAnswers: safeSourceAnswers,
                    directionCandidates: safeDirections,
                    selectedDirectionId: safeSelectedDirectionId,
                    totalEpisodes: safeTotalEpisodes,
                    seoTitle: safeTitle.slice(0, 120),
                    seoDescription: safeDescription?.slice(0, 500) ?? null,
                    seoKeywords: safeSeoKeywords,
                    coverAlt: safeTitle,
                    subtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES,
                    ...publicationFields,
                    novelSetup: stringifyNovelSetup({
                        ...setup,
                        contentLanguage: safeContentLanguage,
                        primaryGenre: normalizedGenre.label,
                        videoAspectRatio: videoAspectRatio === '16:9' || videoAspectRatio === '1:1' ? videoAspectRatio : '9:16',
                        episodeFormat: safeEpisodeFormat,
                        visualStyle: resolvedVisualStyle.key,
                        visualStyleProfile: getVisualStyleProfile(resolvedVisualStyle.key),
                        fieldSources: { ...setup.fieldSources, visualStyle: 'user', visualStyleProfile: 'curated-preset' }
                    })
                }
            })
            await transaction.episode.createMany({
                data: Array.from({ length: safeTotalEpisodes }, (_, i) => ({
                    id: genId(),
                    projectId,
                    episodeNumber: i + 1,
                    title: defaultEpisodeTitle(i + 1, safeContentLanguage)
                }))
            })
            return created
        })

        return apiResponse(project, 201)
    } catch (error) {
        console.error('Failed to create project:', error)
        return apiError('项目创建服务暂时无法连接，请稍后重试', 503)
    }
}
