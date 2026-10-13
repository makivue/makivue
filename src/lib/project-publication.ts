import { isLocale, locales, type Locale } from '@/i18n/config'
import type { EpisodeFormat, NovelSetup } from '@/lib/novel'
import { hasMergedEpisodeVideo } from '@/lib/project-progress'

export const SEO_TITLE_MAX_LENGTH = 120
export const SEO_DESCRIPTION_MAX_LENGTH = 500
export const SEO_KEYWORD_MAX_ITEMS = 20
export const SEO_KEYWORD_MAX_LENGTH = 60
export const COVER_ALT_MAX_LENGTH = 255

const PROJECT_VISIBILITIES = ['private', 'unlisted', 'public'] as const
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number]

const PROJECT_VIDEO_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
export type ProjectVideoAspectRatio = (typeof PROJECT_VIDEO_ASPECT_RATIOS)[number]

const PROJECT_EPISODE_FORMATS = ['micro', 'short', 'long'] as const satisfies readonly EpisodeFormat[]
export const DEFAULT_SUBTITLE_LANGUAGES: Locale[] = [...locales]

function normalizeSingleLine(value: unknown, maxLength: number) {
    if (typeof value !== 'string') return null
    const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    return normalized ? normalized.slice(0, maxLength) : null
}

export function normalizeSeoTitle(value: unknown) {
    return normalizeSingleLine(value, SEO_TITLE_MAX_LENGTH)
}

export function normalizeSeoDescription(value: unknown) {
    return normalizeSingleLine(value, SEO_DESCRIPTION_MAX_LENGTH)
}

export function normalizeCoverAlt(value: unknown) {
    return normalizeSingleLine(value, COVER_ALT_MAX_LENGTH)
}

export function normalizeStringList(value: unknown, maxItems = SEO_KEYWORD_MAX_ITEMS, maxItemLength = SEO_KEYWORD_MAX_LENGTH): string[] {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,，;；]+/) : []
    const unique = new Map<string, string>()
    for (const item of values) {
        if (typeof item !== 'string') continue
        const normalized = item.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxItemLength)
        const key = normalized.toLocaleLowerCase()
        if (normalized && !unique.has(key)) unique.set(key, normalized)
        if (unique.size >= maxItems) break
    }
    return [...unique.values()]
}

export function readStringList(value: unknown): string[] {
    if (typeof value === 'string') {
        try {
            return normalizeStringList(JSON.parse(value))
        } catch {
            return normalizeStringList(value)
        }
    }
    return normalizeStringList(value)
}

export function normalizeSubtitleLanguages(value: unknown): Locale[] {
    return normalizeStringList(value, locales.length, 10).filter(isLocale)
}

export function isProjectVisibility(value: unknown): value is ProjectVisibility {
    return typeof value === 'string' && PROJECT_VISIBILITIES.includes(value as ProjectVisibility)
}

function isProjectVideoAspectRatio(value: unknown): value is ProjectVideoAspectRatio {
    return typeof value === 'string' && PROJECT_VIDEO_ASPECT_RATIOS.includes(value as ProjectVideoAspectRatio)
}

export function isProjectEpisodeFormat(value: unknown): value is EpisodeFormat {
    return typeof value === 'string' && PROJECT_EPISODE_FORMATS.includes(value as EpisodeFormat)
}

export function publicationFieldsFromSetup(setup: NovelSetup) {
    return {
        videoAspectRatio: isProjectVideoAspectRatio(setup.videoAspectRatio) ? setup.videoAspectRatio : '9:16',
        visualStyle: typeof setup.visualStyle === 'string' && setup.visualStyle.trim() ? setup.visualStyle.trim().slice(0, 100) : null,
        contentLanguage: isLocale(setup.contentLanguage) ? setup.contentLanguage : 'zh',
        episodeFormat: isProjectEpisodeFormat(setup.episodeFormat) ? setup.episodeFormat : 'micro'
    }
}

type PublishableProject = {
    genreLabel: string | null
    seoTitle: string | null
    seoDescription: string | null
    seoKeywords: unknown
    coverUrl: string | null
    trailerUrl: string | null
    videoAspectRatio: string | null
    visualStyle: string | null
    contentLanguage: string | null
    subtitleLanguages: unknown
    episodeFormat: string | null
    totalEpisodes: number | null
}

type PublishableAuthor = { displayName: string | null; avatarUrl: string | null }

export type PublicationField = keyof PublishableProject | 'authorDisplayName' | 'authorAvatarUrl'

export function projectPublicationFieldIssues(project: PublishableProject, author: PublishableAuthor): Partial<Record<PublicationField, string>> {
    const issues: Partial<Record<PublicationField, string>> = {}
    if (!project.genreLabel?.trim()) issues.genreLabel = '请选择作品类型'
    if (!normalizeSeoTitle(project.seoTitle)) issues.seoTitle = '请填写作品标题'
    if (!normalizeSeoDescription(project.seoDescription)) issues.seoDescription = '请填写作品简介'
    if (readStringList(project.seoKeywords).length === 0) issues.seoKeywords = '请至少填写一个关键词'
    if (!project.coverUrl) issues.coverUrl = '请上传作品封面'
    if (!project.trailerUrl) issues.trailerUrl = '请上传作品预告片'
    if (!isProjectVideoAspectRatio(project.videoAspectRatio)) issues.videoAspectRatio = '请确认作品画幅比例'
    if (!project.visualStyle) issues.visualStyle = '请确认作品视觉风格'
    if (!isLocale(project.contentLanguage)) issues.contentLanguage = '请确认作品内容语言'
    if (normalizeSubtitleLanguages(project.subtitleLanguages).length === 0) issues.subtitleLanguages = '请至少选择一种字幕语言'
    if (!isProjectEpisodeFormat(project.episodeFormat)) issues.episodeFormat = '请确认剧集形态'
    if (!project.totalEpisodes || project.totalEpisodes < 1) issues.totalEpisodes = '请确认作品集数'
    if (!author.displayName) issues.authorDisplayName = '请先完善作者昵称'
    if (!author.avatarUrl) issues.authorAvatarUrl = '请先完善作者头像'
    return issues
}

export function projectPublicationIssues(project: PublishableProject, author: PublishableAuthor): string[] {
    return Object.values(projectPublicationFieldIssues(project, author))
}

export type PublicationEpisodeCheck = {
    id: string | null
    episodeNumber: number
    title: string | null
    hasMergedVideo: boolean
}

/** Include planned episodes that do not exist yet, without exposing video URLs. */
export function projectPublicationEpisodeChecks(project: {
    totalEpisodes: number | null
    episodes: readonly { id: bigint; episodeNumber: number; title: string | null; videoUrl: string | null }[]
}): PublicationEpisodeCheck[] {
    const checks = project.episodes.map(episode => ({
        id: String(episode.id),
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        hasMergedVideo: hasMergedEpisodeVideo(episode.videoUrl)
    }))
    const existingNumbers = new Set(checks.map(episode => episode.episodeNumber))
    const missing: PublicationEpisodeCheck[] = []
    for (let episodeNumber = 1; episodeNumber <= (project.totalEpisodes ?? 0); episodeNumber++) {
        if (!existingNumbers.has(episodeNumber)) missing.push({ id: null, episodeNumber, title: null, hasMergedVideo: false })
    }
    return [...checks, ...missing].sort((a, b) => a.episodeNumber - b.episodeNumber)
}
