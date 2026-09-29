import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locales, localizePath } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'
import { SEO_FEATURE_LOCALE, SEO_LOCALE } from '@/i18n/seo'
import sitemap from '@/app/sitemap'
import robots from '@/app/robots'
import { getSiteUrl, SITE_NAME, SITE_ORIGIN, SITE_SOCIAL_IMAGE, withSiteName } from './seo'
import { buildHomeJsonLd, buildPublicMetadata } from './seo-metadata'
import { seoPageSlugs } from './seo-pages'

const SEO_IMAGE_URL = `${SITE_ORIGIN}/opengraph-image`

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_ORIGIN))
afterEach(() => vi.unstubAllEnvs())

describe('Local Drama Studio site identity', () => {
    it.each([undefined, '', 'not-a-url', 'ftp://example.com', 'https://user:password@example.com'])('uses the public origin for missing or unsafe site URL %s', value => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', value)
        expect(getSiteUrl().toString()).toBe('http://localhost:3000/')
    })

    it('honors an explicitly configured deployment origin without a path, query or fragment', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', ' https://preview.example.com/path?source=test#section ')
        expect(getSiteUrl().toString()).toBe('https://preview.example.com/')
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://127.0.0.1:3000')
        expect(getSiteUrl().toString()).toBe('http://127.0.0.1:3000/')
    })

    it('adds the brand exactly once to a page title', () => {
        expect(withSiteName('AI Video Generator')).toBe('AI Video Generator | Local Drama Studio')
        expect(withSiteName('Local Drama Studio — AI Video Generator')).toBe('Local Drama Studio — AI Video Generator')
    })

    it.each(locales)('preserves the brand in %s', locale => {
        expect(translateMessage(locale, SITE_NAME)).toBe('Local Drama Studio')
        expect(SEO_LOCALE[locale].title).toContain(SITE_NAME)
        expect(SEO_LOCALE[locale].description).toContain(SITE_NAME)
    })
})

describe('public SEO metadata', () => {
    it.each(locales)('provides branded and localized home metadata for %s', locale => {
        const copy = SEO_LOCALE[locale]
        const metadata = buildPublicMetadata(locale, '/', copy)
        expect(metadata.metadataBase?.origin).toBe(SITE_ORIGIN)
        expect(metadata.applicationName).toBe(SITE_NAME)
        expect(metadata.title).toEqual({ absolute: copy.title })
        expect(metadata.description).toBe(copy.description)
        expect(metadata.keywords).toContain(SITE_NAME)
        expect(new URL(SITE_SOCIAL_IMAGE.url, SITE_ORIGIN).toString()).toBe(SEO_IMAGE_URL)
        expect(metadata.alternates?.canonical).toBe(localizePath('/', locale))
        expect(metadata.alternates?.languages).toMatchObject({ 'en-US': '/', 'zh-CN': '/zh', 'x-default': '/' })
        expect(Object.keys(metadata.alternates?.languages ?? {})).toHaveLength(locales.length + 1)
        expect(metadata.openGraph).toMatchObject({ siteName: SITE_NAME, title: copy.title, locale: copy.openGraph, images: [SITE_SOCIAL_IMAGE] })
        expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: copy.title, images: [SITE_SOCIAL_IMAGE] })
        expect(metadata.robots).toMatchObject({ index: true, follow: true })
    })

    it.each(locales)('keeps feature-specific titles, sharing cards and reciprocal alternates in %s', locale => {
        for (const slug of seoPageSlugs) {
            const pathname = `/features/${slug}`
            const copy = SEO_FEATURE_LOCALE[locale][slug]
            const metadata = buildPublicMetadata(locale, localizePath(pathname, locale), copy)
            const title = `${copy.title} | ${SITE_NAME}`
            expect(metadata.title).toEqual({ absolute: title })
            expect(metadata.description).toBe(copy.description)
            expect(metadata.openGraph).toMatchObject({ title, description: copy.description, url: localizePath(pathname, locale), images: [SITE_SOCIAL_IMAGE] })
            expect(metadata.twitter).toMatchObject({ title, card: 'summary_large_image', images: [SITE_SOCIAL_IMAGE] })
            expect(metadata.alternates?.canonical).toBe(localizePath(pathname, locale))
            for (const alternative of locales) {
                expect(metadata.alternates?.languages?.[SEO_LOCALE[alternative].html]).toBe(localizePath(pathname, alternative))
            }
            expect(metadata.alternates?.languages?.['x-default']).toBe(pathname)
        }
    })

    it.each(locales)('does not advertise account credits in search, sharing or offers for %s', locale => {
        const amount = /3[,. ]?000/
        const home = buildPublicMetadata(locale, '/', SEO_LOCALE[locale])
        expect(home.description).not.toMatch(amount)
        expect(home.openGraph).toMatchObject({ description: home.description })
        expect(home.twitter).toMatchObject({ description: home.description })
        const application = buildHomeJsonLd(locale)['@graph'].find(item => item['@type'] === 'SoftwareApplication')
        expect(application?.offers?.description).not.toMatch(amount)
        for (const slug of seoPageSlugs) expect(SEO_FEATURE_LOCALE[locale][slug].description).not.toMatch(amount)
    })

    it('keeps English search titles concise while retaining product keywords', () => {
        expect(SEO_LOCALE.en.title.length).toBeLessThanOrEqual(60)
        expect(SEO_LOCALE.en.description.length).toBeLessThanOrEqual(165)
        for (const slug of seoPageSlugs) expect(withSiteName(SEO_FEATURE_LOCALE.en[slug].title).length).toBeLessThanOrEqual(60)
    })
})

describe('structured data and discovery', () => {
    it.each(locales)('describes model usage on Local Drama Studio without claiming model ownership in %s', locale => {
        const graph = buildHomeJsonLd(locale)['@graph']
        const page = graph.find(item => item['@type'] === 'WebPage')
        const application = graph.find(item => item['@type'] === 'SoftwareApplication')
        expect(page?.about).toEqual({ '@id': application?.['@id'] })
        expect(page?.mentions).toEqual(
            expect.arrayContaining([
                { '@type': 'Thing', name: 'Seedance 2.5' },
                { '@type': 'Thing', name: 'MiniMax H3' },
                { '@type': 'Thing', name: 'Nano Banana' },
                { '@type': 'Thing', name: 'Gemini 3.7 Flash' }
            ])
        )
        expect(page?.mentions?.every(model => !('sameAs' in model) && !('publisher' in model) && !('brand' in model))).toBe(true)
        expect(application?.featureList).toHaveLength(6)
        for (const feature of application?.featureList ?? []) {
            expect(feature).toContain(SITE_NAME)
            if (locale !== 'zh' && locale !== 'ja') expect(feature).not.toMatch(/\p{Script=Han}/u)
        }
    })

    it.each(locales)('links the brand, website and localized application in %s', locale => {
        const graph = buildHomeJsonLd(locale)['@graph']
        const organization = graph.find(item => item['@type'] === 'Organization')
        const website = graph.find(item => item['@type'] === 'WebSite')
        const application = graph.find(item => item['@type'] === 'SoftwareApplication')
        expect(organization).toMatchObject({ name: SITE_NAME, '@id': `${SITE_ORIGIN}/#organization`, logo: `${SITE_ORIGIN}/brand/logo.png` })
        expect(website).toMatchObject({ name: SITE_NAME, '@id': `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, image: SEO_IMAGE_URL, publisher: { '@id': organization?.['@id'] } })
        expect(organization).toMatchObject({ image: SEO_IMAGE_URL })
        expect(application).toMatchObject({
            name: SITE_NAME,
            description: SEO_LOCALE[locale].description,
            url: new URL(localizePath('/', locale), SITE_ORIGIN).toString(),
            image: SEO_IMAGE_URL,
            publisher: { '@id': organization?.['@id'] }
        })
        expect(JSON.stringify(graph)).not.toContain('aggregateRating')
    })

    it('publishes only public home and feature URLs on the same canonical origin', () => {
        const entries = sitemap()
        expect(entries).toHaveLength(locales.length * (seoPageSlugs.length + 2))
        for (const entry of entries) {
            expect(new URL(entry.url).origin).toBe(SITE_ORIGIN)
            expect(entry.url).not.toMatch(/\/(projects|wallet|settings|profile|create|legal)(\/|$)/)
            expect(Object.keys(entry.alternates?.languages ?? {})).toHaveLength(locales.length + 1)
        }
        expect(robots()).toMatchObject({ host: SITE_ORIGIN, sitemap: `${SITE_ORIGIN}/sitemap.xml` })
    })
})
