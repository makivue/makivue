import { PROJECT_GENRES } from './project-genres'

export const DEFAULT_VISUAL_STYLE_KEY = 'cinematic'
export const IMPORT_MAX_TEXT_LENGTH = 200_000
export const IMPORT_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

const GENRE_CODES: Record<string, string> = {
    ...Object.fromEntries(PROJECT_GENRES.map(genre => [genre.label, genre.code])),
    现代: 'modern',
    言情: 'romance',
    悬疑: 'suspense',
    推理: 'suspense',
    古装: 'historical',
    历史: 'historical',
    校园: 'campus'
}

export function normalizeGenre(value: unknown): { code: string; label: string } {
    const label = typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : '其他'
    const exact = GENRE_CODES[label]
    if (exact) return { code: exact, label }

    const lower = label.toLocaleLowerCase()
    if (/都市|现代|urban|modern|city/.test(lower)) return { code: 'modern', label }
    if (/剧情|drama/.test(lower)) return { code: 'drama', label }
    if (/言情|爱情|romance|love/.test(lower)) return { code: 'romance', label }
    if (/犯罪|crime/.test(lower)) return { code: 'crime', label }
    if (/惊悚|thriller/.test(lower)) return { code: 'thriller', label }
    if (/悬疑|推理|suspense|mystery/.test(lower)) return { code: 'suspense', label }
    if (/喜剧|comedy/.test(lower)) return { code: 'comedy', label }
    if (/动作|action/.test(lower)) return { code: 'action', label }
    if (/冒险|adventure/.test(lower)) return { code: 'adventure', label }
    if (/恐怖|horror/.test(lower)) return { code: 'horror', label }
    if (/古装|历史|historical|period/.test(lower)) return { code: 'historical', label }
    if (/科幻|sci[ -]?fi|science fiction/.test(lower)) return { code: 'sci_fi', label }
    if (/奇幻|玄幻|仙侠|fantasy/.test(lower)) return { code: 'fantasy', label }
    if (/家庭|family/.test(lower)) return { code: 'family', label }
    if (/青春成长|coming[ -]?of[ -]?age|young adult|\bteen\b/.test(lower)) return { code: 'coming_of_age', label }
    if (/校园|campus|school/.test(lower)) return { code: 'campus', label }
    if (/权谋|political|palace intrigue/.test(lower)) return { code: 'political', label }
    return { code: 'other', label }
}

export function normalizeCanonicalName(value: unknown): string {
    return String(value ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/[\s·•・]+/g, '')
        .replace(/[“”"'‘’]/g, '')
        .toLocaleLowerCase()
        .slice(0, 100)
}

export function clampIntensity(value: unknown): number | null {
    const number = Number(value)
    if (!Number.isFinite(number)) return null
    return Math.min(10, Math.max(1, Math.round(number)))
}
