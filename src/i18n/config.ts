import { LOCALE_COUNTRY, DEFAULT_LOCALE as defaultLocaleFromConfig } from '@/lib/country-config'

export type Locale = keyof typeof LOCALE_COUNTRY

export const locales = Object.keys(LOCALE_COUNTRY) as Locale[]
export const defaultLocale = defaultLocaleFromConfig as Locale
export const localizedLocales = locales.filter(locale => locale !== defaultLocale)
export const localeCookieName = 'NEXT_LOCALE'
export const localeStorageKey = 'studio-ui-locale'

const localeLabels: Record<string, string> = Object.fromEntries(Object.entries(LOCALE_COUNTRY).map(([code, cfg]) => [code, cfg.label]))

export function localeDisplayName(displayLocale: Locale, locale: string): string {
    try {
        return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(locale) ?? localeLabels[locale] ?? locale
    } catch {
        return localeLabels[locale] ?? locale
    }
}

export function isLocale(value: string | null | undefined): value is Locale {
    return !!value && locales.includes(value as Locale)
}

export function resolveRequestLocale(pathSegment: string | null | undefined, forwardedLocale: string | null, storedLocale: string | null | undefined): Locale {
    if (isLocale(pathSegment)) return pathSegment
    if (isLocale(forwardedLocale)) return forwardedLocale
    if (isLocale(storedLocale)) return storedLocale
    return defaultLocale
}

export function localeFromPathname(pathname: string): Locale {
    const segment = pathname.split('/').filter(Boolean)[0]
    return isLocale(segment) && segment !== defaultLocale ? segment : defaultLocale
}

export function storedLocaleForUnlocalizedPath(pathname: string, storedLocale: string | null | undefined): Locale | null {
    const segment = pathname.split('/').filter(Boolean)[0]
    if (isLocale(segment) || !isLocale(storedLocale) || storedLocale === defaultLocale) return null
    return storedLocale
}

export function stripLocale(pathname: string): string {
    const parts = pathname.split('/').filter(Boolean)
    if (parts.length > 0 && isLocale(parts[0])) parts.shift()
    return `/${parts.join('/')}`
}

export function localizePath(pathname: string, locale: Locale): string {
    const base = stripLocale(pathname)
    return locale === defaultLocale ? base : `/${locale}${base === '/' ? '' : base}`
}

export function localeDirection(locale: Locale): 'ltr' | 'rtl' {
    return locale === 'ar' ? 'rtl' : 'ltr'
}
