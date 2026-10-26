import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creationTools, toolIndexCopy } from '@/i18n/creation-tools'
import { toolLocales, toolSlugs } from '@/i18n/creation-tool-config'
import { locales, localizePath } from '@/i18n/config'
import { toolNavigation } from '@/i18n/creation-tool-navigation'
import { SEO_LOCALE } from '@/i18n/seo'
import ToolPage, { generateMetadata } from '@/app/tools/[slug]/page'
import ToolsPage, { generateMetadata as indexMetadata } from '@/app/tools/page'
import { buildToolIndexJsonLd, buildToolJsonLd, creationToolSitemap } from './creation-tool-seo'
import publicPageSitemap from '@/app/sitemap'
import { SITE_NAME, SITE_ORIGIN, withSiteName } from './seo'

let activeLocale = 'en'
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-app-locale': activeLocale }) }))
vi.mock('@/components/CreationToolShell', () => ({ default: ({ children }: { children: ReactNode }) => createElement('main', null, children) }))

beforeEach(() => {
    activeLocale = 'en'
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_ORIGIN)
})
afterEach(() => vi.unstubAllEnvs())

const escaped = (value: string) => renderToStaticMarkup(createElement('span', null, value)).replace(/^<span>|<\/span>$/g, '')
const languagesFor = (path: string) => ({ ...Object.fromEntries(toolLocales.map(locale => [SEO_LOCALE[locale].html, localizePath(path, locale)])), 'x-default': path })

describe('image and video tool search discovery', () => {
    it('publishes complete localized editions for every project language', () => {
        expect(toolLocales).toEqual(locales)
        for (const locale of locales) {
            expect(Object.keys(creationTools[locale])).toEqual([...toolSlugs])
            const copy = toolIndexCopy[locale]
            for (const value of Object.values(copy).flat()) expect(value.trim().length).toBeGreaterThan(0)
            for (const slug of toolSlugs) {
                const tool = creationTools[locale][slug]
                expect(tool.features.length).toBeGreaterThanOrEqual(3)
                expect(tool.steps.length).toBeGreaterThanOrEqual(3)
                expect(tool.useCases.length).toBeGreaterThanOrEqual(2)
                expect(tool.faqs.length).toBeGreaterThanOrEqual(3)
                expect(tool.example.prompt.trim().length).toBeGreaterThan(0)
                if (locale !== 'en') {
                    const english = creationTools.en[slug]
                    for (const field of ['title', 'description', 'heading', 'intro', 'actionLabel'] as const) expect(tool[field]).not.toBe(english[field])
                    for (const [index, section] of tool.features.entries()) expect(section.text).not.toBe(english.features[index]?.text)
                    for (const [index, section] of tool.steps.entries()) expect(section.text).not.toBe(english.steps[index]?.text)
                    for (const [index, section] of tool.useCases.entries()) expect(section.text).not.toBe(english.useCases[index]?.text)
                    expect(tool.example.prompt).not.toBe(english.example.prompt)
                    for (const [index, faq] of tool.faqs.entries()) expect(faq.answer).not.toBe(english.faqs[index]?.answer)
                }
            }
        }
    })

    it.each(toolLocales)('renders distinct %s landing content with matching metadata and FAQ schema', async locale => {
        activeLocale = locale
        const titles = new Set<string>()
        const headings = new Set<string>()
        for (const slug of toolSlugs) {
            const props = { params: Promise.resolve({ slug }) }
            const tool = creationTools[locale][slug]
            const path = `/tools/${slug}`
            const html = renderToStaticMarkup(await ToolPage(props))
            const metadata = await generateMetadata(props)
            titles.add(tool.title)
            headings.add(tool.heading)
            expect(metadata.title).toEqual({ absolute: withSiteName(tool.title) })
            expect(metadata.description).toBe(tool.description)
            expect(metadata.keywords).toEqual([SITE_NAME, ...tool.keywords])
            expect(metadata.robots).toMatchObject({ index: true, follow: true })
            expect(metadata.alternates).toEqual({ canonical: localizePath(path, locale), languages: languagesFor(path) })
            expect(metadata.openGraph).toMatchObject({ url: localizePath(path, locale), title: withSiteName(tool.title), description: tool.description })
            expect(html.match(/<h1\b/g)).toHaveLength(1)
            expect(html).toContain(escaped(tool.heading))
            expect(html).toContain(escaped(tool.intro))
            for (const item of [...tool.features, ...tool.steps, ...tool.useCases]) {
                expect(html).toContain(escaped(item.heading))
                expect(html).toContain(escaped(item.text))
            }
            expect(html).toContain(escaped(tool.example.prompt))
            expect(html).toContain(escaped(tool.example.note))
            const graph = buildToolJsonLd(locale, slug)['@graph']
            expect(new Set(graph.map(node => node['@id'])).size).toBe(graph.length)
            const faq = graph.find(node => node['@type'] === 'FAQPage')
            const questions = faq?.mainEntity as { name: string; acceptedAnswer: { text: string } }[]
            expect(questions).toHaveLength(tool.faqs.length)
            for (const question of questions) {
                expect(html).toContain(escaped(question.name))
                expect(html).toContain(escaped(question.acceptedAnswer.text))
            }
            const workspace = slug.includes('video') ? '/aivideo' : '/aiimage'
            expect(tool.action).toBe(workspace)
            expect(html).toContain(`href="${localizePath(workspace, locale)}"`)
            expect(html).toContain(`href="${localizePath('/tools', locale)}"`)
            expect(html).toContain(`href="${localizePath('/pricing', locale)}"`)
            expect(html).toContain(`href="${localizePath(`/guides/${tool.guide}`, locale)}"`)
            expect(html).toContain(`href="${localizePath(`/features/${tool.feature}`, locale)}"`)
            for (const related of tool.related) expect(html).toContain(`href="${localizePath(`/tools/${related}`, locale)}"`)
            if (locale === 'en') expect(html).not.toMatch(/\p{Script=Han}/u)
        }
        expect(titles.size).toBe(toolSlugs.length)
        expect(headings.size).toBe(toolSlugs.length)
    })

    it.each(toolLocales)('makes the %s hub a discoverable collection of every published tool', async locale => {
        activeLocale = locale
        const html = renderToStaticMarkup(await ToolsPage())
        const metadata = await indexMetadata()
        expect(metadata.alternates?.canonical).toBe(localizePath('/tools', locale))
        expect(html.match(/<h1\b/g)).toHaveLength(1)
        expect(html).toContain(escaped(toolIndexCopy[locale].heading))
        const graph = buildToolIndexJsonLd(locale)['@graph']
        expect(new Set(graph.map(node => node['@id'])).size).toBe(graph.length)
        const list = graph.find(node => node['@type'] === 'ItemList')
        expect(list?.numberOfItems).toBe(toolSlugs.length)
        const items = list?.itemListElement as { url: string }[]
        for (const slug of toolSlugs) {
            const path = localizePath(`/tools/${slug}`, locale)
            expect(html).toContain(`href="${path}"`)
            expect(items.some(item => item.url === `${SITE_ORIGIN}${path}`)).toBe(true)
        }
        const navigation = toolNavigation[locale]
        expect(html).toContain(escaped(navigation.input))
        expect(html).toContain(escaped(navigation.output))
        for (const row of navigation.comparison) {
            expect(html).toContain(escaped(row.input))
            expect(html).toContain(escaped(row.output))
        }
        if (locale === 'en') expect(html).not.toMatch(/\p{Script=Han}/u)
    })

    it('includes every published tool edition in the public sitemap with reciprocal language URLs', () => {
        const entries = creationToolSitemap()
        expect(entries).toHaveLength((toolSlugs.length + 1) * toolLocales.length)
        const urls = new Set(entries.map(entry => entry.url))
        expect(urls.size).toBe(entries.length)
        const publicUrls = new Set(publicPageSitemap().map(entry => entry.url))
        for (const entry of entries) {
            expect(new URL(entry.url).origin).toBe(SITE_ORIGIN)
            expect(publicUrls.has(entry.url)).toBe(true)
            expect(Object.keys(entry.alternates.languages)).toEqual([...toolLocales.map(locale => SEO_LOCALE[locale].html), 'x-default'])
            for (const url of Object.values(entry.alternates.languages)) expect(urls.has(url)).toBe(true)
        }
    })

    it('rejects unknown tools and unpublished language editions', async () => {
        const unknown = { params: Promise.resolve({ slug: 'not-a-tool' }) }
        await expect(ToolPage(unknown)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        await expect(generateMetadata(unknown)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        activeLocale = 'not-a-locale'
        const unpublished = { params: Promise.resolve({ slug: toolSlugs[0] }) }
        await expect(ToolPage(unpublished)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        await expect(generateMetadata(unpublished)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        await expect(ToolsPage()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
        await expect(indexMetadata()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    })
})
