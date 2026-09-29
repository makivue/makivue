import { jsonrepair } from 'jsonrepair'
import { canonicalProjectGenreLabel, DEFAULT_PROJECT_GENRE, PROJECT_GENRE_LABELS } from '@/lib/project-genres'

export interface PersonalStoryDirection {
    title: string
    mode: string
    logline: string
    protagonistDesire: string
    coreConflict: string
    emotionalTone: string
    ending: string
    genre: string
}

const PERSONAL_STORY_MODES = ['真实克制', '强冲突短剧', '平行人生幻想'] as const

const REALITY_MODE_DISTRIBUTIONS: Record<string, readonly [string, string, string]> = {
    纪实改编: ['真实克制', '纪实成长', '纪实治愈'],
    戏剧增强: ['强冲突短剧', '反转成长', '情感悬疑'],
    平行人生: ['平行人生幻想', '选择重启', '命运镜像'],
    完全幻想: ['都市奇幻', '高概念幻想', '异世界寓言'],
    隐私改编: ['隐私现实改编', '隐私冲突改编', '隐私幻想改编']
}

const PERSONAL_STORY_GENRES = new Set<string>(PROJECT_GENRE_LABELS)

const REQUIRED_FIELDS: Array<keyof PersonalStoryDirection> = ['title', 'mode', 'logline', 'protagonistDesire', 'coreConflict', 'emotionalTone', 'ending', 'genre']

export function resolvePersonalStoryModes(realityLevel: unknown): readonly [string, string, string] {
    return REALITY_MODE_DISTRIBUTIONS[String(realityLevel ?? '')] ?? PERSONAL_STORY_MODES
}

function validatePersonalStoryDirection(direction: PersonalStoryDirection): string[] {
    const issues: string[] = []
    const titleLength = Array.from(direction.title.trim()).length
    const loglineLength = Array.from(direction.logline.trim()).length
    if (titleLength < 4 || titleLength > 10) issues.push('title_length')
    if (loglineLength < 45 || loglineLength > 90) issues.push('logline_length')
    if (!PERSONAL_STORY_GENRES.has(direction.genre.trim())) issues.push('genre')
    return issues
}

export function parsePersonalStoryDirections(raw: string, expectedModes: readonly string[] = PERSONAL_STORY_MODES): PersonalStoryDirection[] | null {
    try {
        const parsed = JSON.parse(jsonrepair(raw)) as { directions?: unknown }
        if (!Array.isArray(parsed.directions) || parsed.directions.length < expectedModes.length) return null

        const directions = parsed.directions.slice(0, expectedModes.length)
        for (const direction of directions) {
            if (!direction || typeof direction !== 'object') return null
            const candidate = direction as Record<string, unknown>
            if (REQUIRED_FIELDS.some(field => typeof candidate[field] !== 'string' || !(candidate[field] as string).trim())) {
                return null
            }
        }

        const typedDirections = directions.map(direction => ({ ...(direction as PersonalStoryDirection) }))
        const directionsByMode = new Map(typedDirections.map(direction => [direction.mode.trim(), direction]))
        const normalizedDirections = expectedModes.every(mode => directionsByMode.has(mode))
            ? expectedModes.map(mode => directionsByMode.get(mode)!)
            : typedDirections.map((direction, index) => ({ ...direction, mode: expectedModes[index] }))

        for (const direction of normalizedDirections) {
            direction.mode = direction.mode.trim()
            direction.genre = canonicalProjectGenreLabel(direction.genre) ?? DEFAULT_PROJECT_GENRE
            if (validatePersonalStoryDirection(direction).some(issue => issue !== 'genre')) return null
        }

        if (new Set(normalizedDirections.map(direction => direction.title.trim())).size !== normalizedDirections.length) return null
        if (new Set(normalizedDirections.map(direction => direction.logline.trim())).size !== normalizedDirections.length) return null
        return normalizedDirections
    } catch {
        return null
    }
}
