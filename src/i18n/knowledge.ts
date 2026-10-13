import { cache } from 'react'
import { localizePath, type Locale } from './config'
import { knowledgeCopy, knowledgeSections, knowledgeFaqs, knowledgeSources } from './knowledge.zh'

export type KnowledgeCopy = typeof knowledgeCopy

const dictionaries = {
    en: () => import('./knowledge/en.json').then(module => module.default),
    fr: () => import('./knowledge/fr.json').then(module => module.default),
    ar: () => import('./knowledge/ar.json').then(module => module.default),
    id: () => import('./knowledge/id.json').then(module => module.default),
    hi: () => import('./knowledge/hi.json').then(module => module.default),
    fil: () => import('./knowledge/fil.json').then(module => module.default),
    ja: () => import('./knowledge/ja.json').then(module => module.default),
    ko: () => import('./knowledge/ko.json').then(module => module.default)
}

// Translate editorial text, including multiline prompts, while retaining stable
// section IDs, citation references and media URLs in every language.
const structuralFields = new Set(['id', 'number', 'src', 'url', 'sources'])

export const getKnowledgeContent = cache(async (locale: Locale) => {
    const messages: Record<string, string> = locale === 'zh' ? {} : await dictionaries[locale]()

    function localize(value: unknown, key = ''): unknown {
        if (structuralFields.has(key)) return value
        if (typeof value === 'string') {
            if (key === 'href') return value.startsWith('/') ? localizePath(value, locale) : value
            if (locale === 'zh') return value
            const translated = messages[value]
            if (!translated) throw new Error(`Missing ${locale} how-to-use translation: ${key}`)
            return translated
        }
        if (Array.isArray(value)) return value.map(item => localize(item))
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, localize(item, name)]))
        return value
    }

    const content = { copy: knowledgeCopy, sections: knowledgeSections, faqs: knowledgeFaqs, references: knowledgeSources }
    return localize(content) as typeof content
})
