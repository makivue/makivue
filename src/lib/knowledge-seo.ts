import { knowledgeUpdated } from '@/i18n/knowledge.zh'
import { getKnowledgeContent } from '@/i18n/knowledge'
import { localizePath, type Locale } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { getSiteUrl } from '@/lib/seo'
import { buildPageJsonLd } from '@/lib/structured-data'

export async function buildKnowledgeJsonLd(locale: Locale) {
    const { copy, sections, references } = await getKnowledgeContent(locale)
    const baseUrl = getSiteUrl()
    const pageUrl = new URL(localizePath('/how-to-use', locale), baseUrl).toString()
    const organizationId = new URL('/#organization', baseUrl).toString()
    const articleId = `${pageUrl}#article`
    const graph = buildPageJsonLd(locale, '/how-to-use', copy, { properties: { mainEntity: { '@id': articleId } } })
    graph['@graph'].push({
        '@type': 'Article',
        '@id': articleId,
        url: pageUrl,
        headline: copy.title,
        description: copy.description,
        inLanguage: SEO_LOCALE[locale].html,
        dateModified: knowledgeUpdated,
        author: { '@id': organizationId },
        publisher: { '@id': organizationId },
        mainEntityOfPage: { '@id': `${pageUrl}#webpage` },
        articleSection: sections.map(section => section.label),
        image: sections.flatMap(section => (section.image ? [new URL(section.image.src, baseUrl).toString()] : [])),
        citation: references.map(source => source.url),
        isAccessibleForFree: true
    })
    return graph
}
