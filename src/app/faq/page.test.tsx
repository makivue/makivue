import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { locales, type Locale } from '@/i18n/config'
import { faqCopy } from '@/i18n/faq'
import FaqPage from './page'

let activeLocale: Locale = 'en'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-app-locale': activeLocale }) }))
vi.mock('@/components/BrandLogo', () => ({ default: () => null }))
vi.mock('@/components/SiteHeader', () => ({ default: ({ children }: { children: ReactNode }) => createElement('header', null, children) }))
vi.mock('@/components/SiteFooter', () => ({ default: () => null }))

function escapedText(value: string) {
    return renderToStaticMarkup(createElement('span', null, value)).replace(/<[^>]*>/g, '')
}

describe('compact FAQ introduction', () => {
    it.each(locales)('keeps a short introduction and every question in %s', async locale => {
        activeLocale = locale
        const copy = faqCopy(locale)
        const html = renderToStaticMarkup(await FaqPage())
        const intro = html.match(/<section[^>]*aria-labelledby="faq-heading"[\s\S]*?<\/section>/)?.[0]

        expect(intro).toBeDefined()
        expect(intro).toContain(escapedText(copy.heading))
        expect(intro).toContain(escapedText(copy.intro))
        expect(intro?.match(/<h1\b/g)).toHaveLength(1)
        expect(intro?.match(/<p\b/g)).toHaveLength(1)
        expect(intro).not.toMatch(/<(?:a|button|nav|aside)\b/)
        expect(intro).not.toMatch(/rounded-|shadow-|border|grid-cols|text-6xl/)
        expect(html).not.toContain('Local Drama Studio / FAQ')
        expect(html.match(/\?create=story/g)).toHaveLength(1)
        expect(copy.categories).toHaveLength(6)
        expect(html.match(/<details\b/g)).toHaveLength(30)

        for (const [index, category] of copy.categories.entries()) {
            expect(html).toContain(`href="#faq-category-${index}"`)
            expect(html).toContain(`id="faq-category-${index}"`)
            for (const item of category.items) {
                expect(html).toContain(escapedText(item.question))
                expect(html).toContain(escapedText(item.answer))
            }
        }

        const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '{}')
        const faqSchema = jsonLd['@graph'].find((item: { '@type': string }) => item['@type'] === 'FAQPage')
        expect(faqSchema.mainEntity).toEqual(
            copy.categories.flatMap(category => category.items.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })))
        )
        if (locale !== 'zh' && locale !== 'ja') expect(html).not.toMatch(/\p{Script=Han}/u)
    })
})
