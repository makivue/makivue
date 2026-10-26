import { creationGuides, guideIndexCopy, guideLocales, guideSlugs, guidesUpdated, type GuideLocale, type GuideSlug } from '@/i18n/creation-guides'
import { localizePath } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { getSiteUrl } from './seo'
import { buildPageJsonLd } from './structured-data'

export function buildGuideJsonLd(locale: GuideLocale, slug: GuideSlug) {
    const guide = creationGuides[locale][slug]
    const path = `/guides/${slug}`
    const url = new URL(localizePath(path, locale), getSiteUrl()).toString()
    const organization = { '@id': new URL('/#organization', getSiteUrl()).toString() }
    const graph = buildPageJsonLd(locale, path, guide, {
        parents: [{ path: '/guides', name: guideIndexCopy[locale].label }],
        properties: { mainEntity: { '@id': `${url}#article` }, hasPart: { '@id': `${url}#faq` } }
    })
    graph['@graph'].push(
        {
            '@type': 'Article',
            '@id': `${url}#article`,
            url,
            headline: guide.heading,
            description: guide.description,
            inLanguage: SEO_LOCALE[locale].html,
            dateModified: guidesUpdated,
            author: organization,
            publisher: organization,
            mainEntityOfPage: { '@id': `${url}#webpage` },
            articleSection: guide.sections.map(section => section.heading),
            isAccessibleForFree: true
        },
        {
            '@type': 'FAQPage',
            '@id': `${url}#faq`,
            inLanguage: SEO_LOCALE[locale].html,
            mainEntity: guide.faqs.map(faq => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } }))
        }
    )
    return graph
}

export function buildGuideIndexJsonLd(locale: GuideLocale) {
    const url = new URL(localizePath('/guides', locale), getSiteUrl()).toString()
    const graph = buildPageJsonLd(locale, '/guides', guideIndexCopy[locale], { type: 'CollectionPage', properties: { mainEntity: { '@id': `${url}#guides` } } })
    graph['@graph'].push({
        '@type': 'ItemList',
        '@id': `${url}#guides`,
        numberOfItems: guideSlugs.length,
        itemListElement: guideSlugs.map((slug, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: creationGuides[locale][slug].heading,
            url: new URL(localizePath(`/guides/${slug}`, locale), getSiteUrl()).toString()
        }))
    })
    return graph
}

export function creationGuideSitemap() {
    return ['/guides', ...guideSlugs.map(slug => `/guides/${slug}`)].flatMap(path => {
        const languages = Object.fromEntries(guideLocales.map(locale => [SEO_LOCALE[locale].html, new URL(localizePath(path, locale), getSiteUrl()).toString()]))
        languages['x-default'] = new URL(path, getSiteUrl()).toString()
        return guideLocales.map(locale => ({
            url: new URL(localizePath(path, locale), getSiteUrl()).toString(),
            lastModified: guidesUpdated,
            changeFrequency: 'monthly' as const,
            priority: 0.7,
            alternates: { languages }
        }))
    })
}
