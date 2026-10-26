import type { Locale } from '@/i18n/config'
import { localizePath } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { getSiteUrl } from '@/lib/seo'

export function buildPageJsonLd(locale: Locale, path: string, copy: { title: string; description: string }, options: { type?: string; parents?: Array<{ path: string; name: string }>; properties?: Record<string, unknown> } = {}) {
    const origin = getSiteUrl()
    const url = new URL(localizePath(path, locale), origin).toString()
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': options.type || 'WebPage',
                '@id': `${url}#webpage`,
                url,
                name: copy.title,
                description: copy.description,
                inLanguage: SEO_LOCALE[locale].html,
                ...options.properties
            },
            {
                '@type': 'BreadcrumbList',
                '@id': `${url}#breadcrumbs`,
                itemListElement: [{ path: '/', name: 'MakiVue' }, ...(options.parents || []), { path, name: copy.title }].map((item, index) => ({
                    '@type': 'ListItem', position: index + 1, name: item.name, item: new URL(localizePath(item.path, locale), origin).toString()
                }))
            }
        ] as Record<string, unknown>[]
    }
}
