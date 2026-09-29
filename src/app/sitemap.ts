import type { MetadataRoute } from 'next'
import { locales, localizePath } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { getSiteUrl } from '@/lib/seo'
import { seoPageSlugs } from '@/lib/seo-pages'

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = getSiteUrl()
    const languages = Object.fromEntries(locales.map(locale => [SEO_LOCALE[locale].html, new URL(localizePath('/', locale), baseUrl).toString()]))
    languages['x-default'] = new URL('/', baseUrl).toString()

    const homepageEntries: MetadataRoute.Sitemap = locales.map(locale => ({
        url: new URL(localizePath('/', locale), baseUrl).toString(),
        changeFrequency: 'weekly',
        priority: locale === 'en' ? 1 : 0.9,
        alternates: { languages }
    }))
    const featureEntries: MetadataRoute.Sitemap = seoPageSlugs.flatMap(slug => {
        const featureLanguages = Object.fromEntries(locales.map(locale => [SEO_LOCALE[locale].html, new URL(localizePath(`/features/${slug}`, locale), baseUrl).toString()]))
        featureLanguages['x-default'] = new URL(`/features/${slug}`, baseUrl).toString()
        return locales.map(locale => ({
            url: new URL(localizePath(`/features/${slug}`, locale), baseUrl).toString(),
            changeFrequency: 'monthly' as const,
            priority: 0.8,
            alternates: { languages: featureLanguages }
        }))
    })
    const faqLanguages = Object.fromEntries(locales.map(locale => [SEO_LOCALE[locale].html, new URL(localizePath('/faq', locale), baseUrl).toString()]))
    faqLanguages['x-default'] = new URL('/faq', baseUrl).toString()
    const faqEntries: MetadataRoute.Sitemap = locales.map(locale => ({
        url: new URL(localizePath('/faq', locale), baseUrl).toString(),
        changeFrequency: 'monthly' as const,
        priority: 0.8,
        alternates: { languages: faqLanguages }
    }))
    return [...homepageEntries, ...featureEntries, ...faqEntries]
}
