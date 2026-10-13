import { isLocale, type Locale } from '@/i18n/config'

const DEFAULT_CONTENT_LANGUAGE: Locale = 'zh'

const PROMPT_LANGUAGE_NAMES: Record<Locale, string> = {
    en: 'English',
    zh: 'Simplified Chinese',
    fr: 'French',
    ar: 'Arabic',
    id: 'Indonesian',
    hi: 'Hindi',
    fil: 'Filipino',
    ja: 'Japanese',
    ko: 'Korean'
}

export function normalizeContentLanguage(value: unknown, fallback: Locale = DEFAULT_CONTENT_LANGUAGE): Locale {
    return typeof value === 'string' && isLocale(value) ? value : fallback
}

function contentLanguageName(value: unknown): string {
    return PROMPT_LANGUAGE_NAMES[normalizeContentLanguage(value)]
}

export function contentLanguagePrompt(value: unknown): string {
    const language = contentLanguageName(value)
    return `# Mandatory output language\nAll newly generated user-facing creative content must be written in ${language}. This includes titles, outlines, prose, synopses, dialogue, action descriptions, character and scene descriptions, image prompts, and continuity notes. Preserve the language of quoted source text only when a faithful quotation is necessary. JSON keys, numeric values, IDs, and fixed technical enum values must remain exactly as specified. Do not switch to the UI language or translate existing project content.`
}

export function extractionLanguagePrompt(value: unknown): string {
    const language = contentLanguageName(value)
    return `# Mandatory extraction language\nScene descriptions, character personality descriptions, and newly authored display names must be written in ${language}. Preserve character and scene names and aliases exactly as written in the source scripts or existing entity lists; do not translate or transliterate them. Apply these rules during both extraction and merging. Keep appearancePrompt and locationPrompt in English for image generation. JSON keys, IDs, numeric values, and fixed enum values (role, gender, timeOfDay) must remain as specified. The language of instructions, examples, visual style references, or the UI must not override these rules.`
}

export function defaultEpisodeTitle(episodeNumber: number, value: unknown): string {
    const locale = normalizeContentLanguage(value)
    const formats: Record<Locale, string> = {
        en: `Episode ${episodeNumber}`,
        zh: `第${episodeNumber}集`,
        fr: `Épisode ${episodeNumber}`,
        ar: `الحلقة ${episodeNumber}`,
        id: `Episode ${episodeNumber}`,
        hi: `एपिसोड ${episodeNumber}`,
        fil: `Episode ${episodeNumber}`,
        ja: `第${episodeNumber}話`,
        ko: `${episodeNumber}화`
    }
    return formats[locale]
}
