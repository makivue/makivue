import { locales, type Locale } from './config'

export const toolLocales = locales
export type ToolLocale = Locale

export const toolSlugs = ['ai-image-generator', 'text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'] as const
export type ToolSlug = (typeof toolSlugs)[number]

export function isToolLocale(value: string): value is ToolLocale {
    return toolLocales.includes(value as ToolLocale)
}

export function isToolSlug(value: string): value is ToolSlug {
    return toolSlugs.includes(value as ToolSlug)
}
