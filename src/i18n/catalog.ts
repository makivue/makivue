import type { Locale } from './config'
import en from './catalogs/en.json'
import zh from './catalogs/zh.json'
import fr from './catalogs/fr.json'
import ar from './catalogs/ar.json'
import id from './catalogs/id.json'
import hi from './catalogs/hi.json'
import fil from './catalogs/fil.json'
import ja from './catalogs/ja.json'
import ko from './catalogs/ko.json'

type Catalog = Record<string, string>
export type MessageValues = Record<string, string | number>
const catalogs: Record<Locale, Catalog> = { en, zh, fr, ar, id, hi, fil, ja, ko }

const orderedKeys = new Map<Locale, string[]>()

// Product and model names are trademarks/identifiers, not UI copy. Catalogs may
// still contain legacy machine translations for them, so restore the source
// spelling after translating both standalone and embedded messages.
const protectedModelNames = [
    'Nano Banana',
    'Gemini',
    'GPT 5.6',
    'GPT-4o',
    'OpenAI',
    'Himodels',
    'Google Veo 3',
    'Veo 3',
    'veo-3.1-generate-001',
    'veo-3.1-fast-generate-001',
    'veo-3.1-lite-generate-001',
    'seedance-2.0-global',
    'Seedance',
    'MiniMax H3',
    'Happy Horse',
    'seedream-5-0-lite',
    'gemini-3.1-flash-image',
    'gemini-3.7-flash',
    'Wan 2.7'
] as const

const protectedModelAliases: Partial<Record<Locale, readonly string[]>> = {
    ar: ['الحصان السعيد', 'حصان سعيد'],
    id: ['Kuda Bahagia'],
    hi: ['हैप्पी हॉर्स', 'खुश घोड़ा'],
    fil: ['Masayang Kabayo', 'Maligayang Kabayo'],
    ja: ['ハッピーホース'],
    ko: ['해피 호스', '행복한 말']
}

function restoreModelNames(locale: Locale, source: string, translated: string) {
    const catalog = catalogs[locale]
    let result = translated
    for (const name of protectedModelNames) {
        if (!source.includes(name)) continue
        const legacyTranslation = catalog[name]
        if (legacyTranslation && legacyTranslation !== name) result = result.replaceAll(legacyTranslation, name)
        if (name === 'Happy Horse') {
            for (const alias of protectedModelAliases[locale] ?? []) result = result.replaceAll(alias, name)
        }
    }
    return result
}

function normalizeMessage(source: string) {
    return source.replace(/\s+/g, ' ').trim()
}

function translateCoveredFragments(locale: Locale, source: string, keys: string[]) {
    if (!/\p{Script=Han}/u.test(source)) return source

    const catalog = catalogs[locale]
    const candidates = keys.filter(key => source.includes(key))
    const choices = new Map<number, { next: number; text: string }>()
    const isCovered = (offset: number) => offset === source.length || choices.has(offset)

    // Work backwards so each suffix is already resolved. Recursive descent used
    // one stack frame per character and overflowed on chapter-length text.
    for (let offset = source.length - 1; offset >= 0; offset -= 1) {
        for (const key of candidates) {
            const next = offset + key.length
            if (isCovered(next) && source.startsWith(key, offset)) {
                choices.set(offset, { next, text: catalog[key] })
                break
            }
        }
        if (choices.has(offset)) continue

        const codePoint = String.fromCodePoint(source.codePointAt(offset)!)
        const next = offset + codePoint.length
        if (!/\p{Script=Han}/u.test(codePoint) && isCovered(next)) {
            choices.set(offset, { next, text: codePoint })
        }
    }

    if (!choices.has(0)) return null
    const parts: string[] = []
    for (let offset = 0; offset < source.length;) {
        const choice = choices.get(offset)!
        parts.push(choice.text)
        offset = choice.next
    }
    return parts.join('')
}

function interpolateMessage(message: string, values?: MessageValues): string {
    if (!values) return message
    return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : placeholder))
}

export function translateMessage(locale: Locale, source: string, values?: MessageValues): string {
    if (!source) return source
    const catalog = catalogs[locale]
    const normalized = normalizeMessage(source)
    if (!normalized) return source
    if (catalog[normalized]) {
        const leading = source.match(/^\s*/)?.[0] ?? ''
        const trailing = source.match(/\s*$/)?.[0] ?? ''
        return interpolateMessage(restoreModelNames(locale, source, `${leading}${catalog[normalized]}${trailing}`), values)
    }

    // Dynamic UI messages can combine translated labels with an id/count. Only
    // use fragment translation when every source-language fragment is covered;
    // otherwise keep the source intact instead of producing mixed-language UI.
    let keys = orderedKeys.get(locale)
    if (!keys) {
        keys = Object.keys(catalog)
            .filter(key => key.length > 1 && key.length <= 200 && /\p{Script=Han}/u.test(key))
            .sort((a, b) => b.length - a.length)
        orderedKeys.set(locale, keys)
    }
    const translated = translateCoveredFragments(locale, source, keys)
    return interpolateMessage(translated === null ? source : restoreModelNames(locale, source, translated), values)
}
