import type { VisualStylePreset } from './novel'
import { getRegionalStoryPreset, regionalVisualDirection } from './regional-story-presets'

export type VisualStyleFamily = 'modern' | 'historical-fantasy' | 'other'

const MODERN_SIGNAL = /(?:modern|urban|contemporary|office|family drama|city|street|live.action|photoreal|现代|都市|职场|办公室|家庭伦理|写实)/i
const HISTORICAL_SIGNAL = /(?:xianxia|wuxia|hanfu|ancient|historical|cultivation|immortal|古风|古装|仙侠|武侠|修仙|玄幻)/i

export function getVisualStyleFamily(style: Pick<VisualStylePreset, 'key' | 'label' | 'hint' | 'imagePromptPrefix'>): VisualStyleFamily {
    const regional = getRegionalStoryPreset(style.key)
    if (regional) return regional.family
    const context = [style.key, style.label, style.hint, style.imagePromptPrefix].join(' ')
    if (HISTORICAL_SIGNAL.test(context) && !MODERN_SIGNAL.test(context)) return 'historical-fantasy'
    if (MODERN_SIGNAL.test(context)) return 'modern'
    return 'other'
}

const MODERN_CONFLICT_PATTERNS = [
    /\b(?:xianxia|wuxia|cultivation|immortal fantasy|fantasy costume drama)\b/gi,
    /\b(?:hanfu|ancient robes?|historical robes?|cultivation robes?|immortal robes?)\b/gi,
    /\b(?:cultivation sect|immortal sect|magical palace|celestial palace)\b/gi,
    /(?:仙侠|武侠|修仙|玄幻|古风|古装|汉服|仙袍|道袍|宗门|仙门|天宫|仙宫|灵力特效|御剑)/g
]

/** Remove inherited genre/art-direction tokens while retaining identity, action and location details. */
export function sanitizePromptForVisualStyle(prompt: string | null | undefined, style: Pick<VisualStylePreset, 'key' | 'label' | 'hint' | 'imagePromptPrefix'>): string {
    const source = prompt?.trim() ?? ''
    if (!source || getRegionalStoryPreset(style.key) || getVisualStyleFamily(style) !== 'modern') return source
    return MODERN_CONFLICT_PATTERNS.reduce((value, pattern) => value.replace(pattern, ' '), source)
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,，。;；])/g, '$1')
        .trim()
}

export function buildVisualStyleLock(style: Pick<VisualStylePreset, 'key' | 'label' | 'hint' | 'negativePrompt'>) {
    const family = getVisualStyleFamily({ ...style, imagePromptPrefix: '' })
    const regional = getRegionalStoryPreset(style.key)
    if (regional) {
        return {
            family,
            positive: `PROJECT REGIONAL ART DIRECTION: ${regionalVisualDirection(regional)} Preserve the established story bible and supernatural rules where applicable.`,
            negative: style.negativePrompt ?? ''
        }
    }
    if (family === 'modern') {
        return {
            family,
            positive:
                `AUTHORITATIVE PROJECT STYLE LOCK: ${style.label} (${style.hint}). The result MUST be contemporary and modern: present-day architecture, present-day wardrobe, realistic modern grooming and modern production design. ` +
                'Any historical, xianxia, wuxia, cultivation, immortal-fantasy or costume-drama wording inherited from character, scene or storyboard data is stale metadata and MUST be ignored. Subject identity, action and location function may be preserved, but conflicting era, wardrobe and art direction must not be preserved.',
            negative: [
                style.negativePrompt,
                'hanfu, ancient robes, historical costume, xianxia, wuxia, cultivation fantasy, immortal fantasy, cultivation sect, celestial palace, magical palace, flying swords, spiritual aura, period-drama hairstyle, jade crown, fantasy costume drama'
            ]
                .filter(Boolean)
                .join(', ')
        }
    }
    return {
        family,
        positive: `AUTHORITATIVE PROJECT STYLE LOCK: ${style.label} (${style.hint}). Preserve this exact project art direction; conflicting style wording from older character, scene or storyboard data is not authoritative.`,
        negative: style.negativePrompt ?? ''
    }
}
