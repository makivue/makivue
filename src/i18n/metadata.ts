import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { translateMessage } from './catalog'
import { defaultLocale, isLocale } from './config'

export async function localizedPrivateMetadata(title: string, description: string): Promise<Metadata> {
    const requestedLocale = (await headers()).get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale

    return {
        title: translateMessage(locale, title),
        description: translateMessage(locale, description),
        robots: { index: false, follow: false }
    }
}
