import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creationGuides, guideIndexCopy, guideLocales, guideSlugs } from '@/i18n/creation-guides'
import { locales, localizePath } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import GuidePage, { generateMetadata } from '@/app/guides/[slug]/page'
import GuidesPage, { generateMetadata as indexMetadata } from '@/app/guides/page'
import { buildGuideJsonLd, creationGuideSitemap } from './creation-guide-seo'
import { SITE_ORIGIN, withSiteName } from './seo'

let activeLocale = 'en'
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-app-locale': activeLocale }) }))
vi.mock('@/components/CreationGuideShell', () => ({ default: ({ children }: { children: ReactNode }) => createElement('main', null, children) }))

beforeEach(() => {
    activeLocale = 'en'
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_ORIGIN)
})
afterEach(() => vi.unstubAllEnvs())

const escaped = (value: string) => renderToStaticMarkup(createElement('span', null, value)).replace(/^<span>|<\/span>$/g, '')
const languagesFor = (path: string) => ({ ...Object.fromEntries(guideLocales.map(locale => [SEO_LOCALE[locale].html, localizePath(path, locale)])), 'x-default': path })

describe('creation guide search discovery', () => {
    it('publishes complete guide editions for every project language', () => {
        expect(guideLocales).toEqual(locales)
        for (const locale of locales) {
            expect(Object.keys(creationGuides[locale])).toEqual([...guideSlugs])
            for (const value of Object.values(guideIndexCopy[locale]).flat()) expect(value.trim().length).toBeGreaterThan(0)
            for (const slug of guideSlugs) {
                const guide = creationGuides[locale][slug]
                expect(guide.sections.length).toBeGreaterThanOrEqual(3)
                expect(guide.faqs.length).toBeGreaterThanOrEqual(3)
                if (locale !== 'en') {
                    const english = creationGuides.en[slug]
                    for (const field of ['title', 'description', 'heading', 'intro'] as const) expect(guide[field]).not.toBe(english[field])
                    for (const [index, section] of guide.sections.entries()) expect(section.paragraphs).not.toEqual(english.sections[index]?.paragraphs)
                    for (const [index, faq] of guide.faqs.entries()) expect(faq.answer).not.toBe(english.faqs[index]?.answer)
                }
            }
        }
    })

    it.each(guideLocales)('publishes real %s page content, FAQs and reciprocal alternates', async locale => {
        activeLocale = locale
        for (const slug of guideSlugs) {
            const props = { params: Promise.resolve({ slug }) }
            const metadata = await generateMetadata(props)
            const guide = creationGuides[locale][slug]
            const path = `/guides/${slug}`
            const html = renderToStaticMarkup(await GuidePage(props))
            expect(metadata.title).toEqual({ absolute: withSiteName(guide.title) })
            expect(metadata.robots).toMatchObject({ index: true, follow: true })
            expect(metadata.keywords).toEqual(['makivue', ...guide.keywords])
            expect(metadata.alternates).toEqual({ canonical: localizePath(path, locale), languages: languagesFor(path) })
            expect(metadata.openGraph).toMatchObject({ url: localizePath(path, locale), title: withSiteName(guide.title), description: guide.description })
            expect(html).toContain(escaped(guide.heading))
            expect(html.match(/<h1\b/g)).toHaveLength(1)
            for (const section of guide.sections) {
                expect(html).toContain(`id="${section.id}"`)
                expect(html).toContain(`href="#${section.id}"`)
                for (const paragraph of section.paragraphs) expect(html).toContain(escaped(paragraph))
                if (section.example) expect(html).toContain(escaped(section.example))
            }
            const graph = buildGuideJsonLd(locale, slug)['@graph']
            expect(new Set(graph.map(node => node['@id'])).size).toBe(graph.length)
            const faq = graph.find(node => node['@type'] === 'FAQPage')
            const questions = faq?.mainEntity as { name: string; acceptedAnswer: { text: string } }[]
            expect(questions).toHaveLength(guide.faqs.length)
            for (const question of questions) {
                expect(html).toContain(escaped(question.name))
                expect(html).toContain(escaped(question.acceptedAnswer.text))
            }
            expect(html).toContain(`href="${localizePath(`/features/${guide.feature}`, locale)}"`)
            expect(html).toContain(`href="${localizePath('/pricing', locale)}"`)
            expect(html).toContain(`href="${localizePath('/guides', locale)}"`)
            if (locale === 'en') {
                expect(withSiteName(guide.title).length).toBeLessThanOrEqual(60)
                // Detailed editorial descriptions may exceed the displayed snippet width.
                expect(guide.description.length).toBeGreaterThanOrEqual(150)
                expect(guide.description.length).toBeLessThanOrEqual(220)
                expect(html).not.toMatch(/\p{Script=Han}/u)
            }
        }
    })

    it.each(guideLocales)('makes the %s hub link to every published guide', async locale => {
        activeLocale = locale
        const html = renderToStaticMarkup(await GuidesPage())
        const metadata = await indexMetadata()
        expect(metadata.alternates?.canonical).toBe(localizePath('/guides', locale))
        expect(html).toContain(escaped(guideIndexCopy[locale].heading))
        for (const slug of guideSlugs) expect(html).toContain(`href="${localizePath(`/guides/${slug}`, locale)}"`)
    })

    it('lists only published language editions in the sitemap', () => {
        const entries = creationGuideSitemap()
        expect(entries).toHaveLength((guideSlugs.length + 1) * guideLocales.length)
        expect(new Set(entries.map(entry => entry.url)).size).toBe(entries.length)
        const urls = new Set(entries.map(entry => entry.url))
        for (const entry of entries) {
            expect(new URL(entry.url).origin).toBe(SITE_ORIGIN)
            expect(Object.keys(entry.alternates.languages)).toEqual([...guideLocales.map(locale => SEO_LOCALE[locale].html), 'x-default'])
            for (const url of Object.values(entry.alternates.languages)) expect(urls.has(url)).toBe(true)
        }
    })

    it('rejects unknown slugs and unpublished translations', async () => {
        await expect(GuidePage({ params: Promise.resolve({ slug: 'not-a-guide' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        await expect(generateMetadata({ params: Promise.resolve({ slug: 'not-a-guide' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        activeLocale = 'not-a-locale'
        await expect(GuidePage({ params: Promise.resolve({ slug: guideSlugs[0] }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        await expect(GuidesPage()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    })
})
