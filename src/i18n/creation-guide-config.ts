import { locales, type Locale } from './config'

export const guideLocales = locales
export type GuideLocale = Locale
export const guideSlugs = ['script-to-video', 'manga-storyboard', 'consistent-ai-characters', 'image-to-video', 'ai-anime-video'] as const
export type GuideSlug = (typeof guideSlugs)[number]

export function isGuideLocale(locale: string | null): locale is GuideLocale {
    return guideLocales.some(item => item === locale)
}

export function isGuideSlug(slug: string): slug is GuideSlug {
    return guideSlugs.some(item => item === slug)
}
