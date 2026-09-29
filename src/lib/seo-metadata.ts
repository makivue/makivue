import type { Metadata } from 'next'
import { locales, localizePath, stripLocale, type Locale } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { translateMessage } from '@/i18n/catalog'
import { CREATION_MODELS } from './creation-model-overview'
import { getSiteUrl, SITE_NAME, SITE_SOCIAL_IMAGE, withSiteName } from './seo'

type PageCopy = { title: string; description: string; keywords?: string[] }

export function buildPublicMetadata(locale: Locale, pathname: string, copy: PageCopy): Metadata {
    const title = withSiteName(copy.title)
    const unlocalizedPathname = stripLocale(pathname)
    const canonical = localizePath(unlocalizedPathname, locale)
    const languages = Object.fromEntries(locales.map(item => [SEO_LOCALE[item].html, localizePath(unlocalizedPathname, item)]))

    return {
        metadataBase: getSiteUrl(),
        applicationName: SITE_NAME,
        title: { absolute: title },
        description: copy.description,
        keywords: copy.keywords ? [SITE_NAME, ...copy.keywords] : undefined,
        alternates: { canonical, languages: { ...languages, 'x-default': unlocalizedPathname } },
        openGraph: {
            type: 'website',
            siteName: SITE_NAME,
            locale: SEO_LOCALE[locale].openGraph,
            alternateLocale: locales.filter(item => item !== locale).map(item => SEO_LOCALE[item].openGraph),
            url: canonical,
            title,
            description: copy.description,
            images: [{ ...SITE_SOCIAL_IMAGE }]
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description: copy.description,
            images: [{ ...SITE_SOCIAL_IMAGE }]
        },
        robots: {
            index: true,
            follow: true,
            googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-video-preview': -1, 'max-snippet': -1 }
        }
    }
}

export function buildHomeJsonLd(locale: Locale) {
    const baseUrl = getSiteUrl()
    const homeUrl = new URL('/', baseUrl).toString()
    const localizedUrl = new URL(localizePath('/', locale), baseUrl).toString()
    const socialImageUrl = new URL(SITE_SOCIAL_IMAGE.url, baseUrl).toString()
    const copy = SEO_LOCALE[locale]

    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Organization',
                '@id': `${homeUrl}#organization`,
                name: SITE_NAME,
                url: homeUrl,
                logo: new URL('/brand/logo.png', baseUrl).toString(),
                image: socialImageUrl
            },
            {
                '@type': 'WebSite',
                '@id': `${homeUrl}#website`,
                name: SITE_NAME,
                url: homeUrl,
                image: socialImageUrl,
                inLanguage: locales.map(item => SEO_LOCALE[item].html),
                publisher: { '@id': `${homeUrl}#organization` }
            },
            {
                '@type': 'WebPage',
                '@id': `${localizedUrl}#webpage`,
                name: copy.title,
                description: copy.description,
                url: localizedUrl,
                inLanguage: copy.html,
                isPartOf: { '@id': `${homeUrl}#website` },
                about: { '@id': `${localizedUrl}#application` },
                // These are third-party models mentioned on the page, not Local Drama Studio identities.
                mentions: CREATION_MODELS.flatMap(model => model.names.map(name => ({ '@type': 'Thing', name })))
            },
            {
                '@type': 'SoftwareApplication',
                '@id': `${localizedUrl}#application`,
                name: SITE_NAME,
                description: copy.description,
                url: localizedUrl,
                image: socialImageUrl,
                applicationCategory: 'MultimediaApplication',
                operatingSystem: 'Web',
                inLanguage: copy.html,
                publisher: { '@id': `${homeUrl}#organization` },
                featureList: CREATION_MODELS.map(model => translateMessage(locale, model.description)),
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: copy.offerDescription }
            }
        ]
    }
}
