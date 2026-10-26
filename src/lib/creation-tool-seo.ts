import { creationTools, toolIndexCopy } from '@/i18n/creation-tools'
import { toolLocales, toolSlugs, type ToolLocale, type ToolSlug } from '@/i18n/creation-tool-config'
import { localizePath } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { getSiteUrl } from './seo'
import { buildPageJsonLd } from './structured-data'

export function buildToolJsonLd(locale: ToolLocale, slug: ToolSlug) {
    const tool = creationTools[locale][slug]
    const path = `/tools/${slug}`
    const url = new URL(localizePath(path, locale), getSiteUrl()).toString()
    const graph = buildPageJsonLd(locale, path, tool, {
        parents: [{ path: '/tools', name: toolIndexCopy[locale].label }],
        properties: { hasPart: { '@id': `${url}#faq` } }
    })
    graph['@graph'].push({
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: SEO_LOCALE[locale].html,
        mainEntity: tool.faqs.map(faq => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } }))
    })
    return graph
}

export function buildToolIndexJsonLd(locale: ToolLocale) {
    const url = new URL(localizePath('/tools', locale), getSiteUrl()).toString()
    const graph = buildPageJsonLd(locale, '/tools', toolIndexCopy[locale], { type: 'CollectionPage', properties: { mainEntity: { '@id': `${url}#tools` } } })
    graph['@graph'].push({
        '@type': 'ItemList',
        '@id': `${url}#tools`,
        numberOfItems: toolSlugs.length,
        itemListElement: toolSlugs.map((slug, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: creationTools[locale][slug].heading,
            url: new URL(localizePath(`/tools/${slug}`, locale), getSiteUrl()).toString()
        }))
    })
    return graph
}

export function creationToolSitemap() {
    return ['/tools', ...toolSlugs.map(slug => `/tools/${slug}`)].flatMap(path => {
        const languages = Object.fromEntries(toolLocales.map(locale => [SEO_LOCALE[locale].html, new URL(localizePath(path, locale), getSiteUrl()).toString()]))
        languages['x-default'] = new URL(path, getSiteUrl()).toString()
        return toolLocales.map(locale => ({
            url: new URL(localizePath(path, locale), getSiteUrl()).toString(),
            changeFrequency: 'monthly' as const,
            priority: path === '/tools' ? 0.7 : 0.8,
            alternates: { languages }
        }))
    })
}
