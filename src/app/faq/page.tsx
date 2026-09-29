import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowRight, ChevronDown, Sparkles } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import { faqCopy, FAQ_SEO_LOCALE } from '@/i18n/faq'
import { isLocale, localizePath, type Locale } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { translateMessage } from '@/i18n/catalog'
import { getSiteUrl, SITE_NAME, SITE_SOCIAL_IMAGE, withSiteName } from '@/lib/seo'
import { buildPublicMetadata } from '@/lib/seo-metadata'

function requestLocale(value: string | null): Locale {
    return isLocale(value) ? value : 'en'
}

function faqPath(locale: Locale) {
    return localizePath('/faq', locale)
}

export async function generateMetadata(): Promise<Metadata> {
    const locale = requestLocale((await headers()).get('x-app-locale'))
    return buildPublicMetadata(locale, faqPath(locale), FAQ_SEO_LOCALE[locale])
}

export default async function FaqPage() {
    const locale = requestLocale((await headers()).get('x-app-locale'))
    const copy = faqCopy(locale)
    const metadata = FAQ_SEO_LOCALE[locale]
    const siteUrl = getSiteUrl()
    const canonicalUrl = new URL(faqPath(locale), siteUrl).toString()
    const socialImageUrl = new URL(SITE_SOCIAL_IMAGE.url, siteUrl).toString()
    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebPage',
                '@id': `${canonicalUrl}#webpage`,
                name: withSiteName(metadata.title),
                description: metadata.description,
                url: canonicalUrl,
                image: socialImageUrl,
                inLanguage: SEO_LOCALE[locale].html,
                isPartOf: { '@id': new URL('/#website', siteUrl).toString() },
                about: { '@type': 'SoftwareApplication', name: SITE_NAME, url: new URL(localizePath('/', locale), siteUrl).toString(), image: socialImageUrl }
            },
            {
                '@type': 'FAQPage',
                mainEntity: copy.categories.flatMap(category =>
                    category.items.map(item => ({
                        '@type': 'Question',
                        name: item.question,
                        acceptedAnswer: { '@type': 'Answer', text: item.answer }
                    }))
                )
            }
        ]
    }

    return (
        <main
            data-i18n-skip
            className="app-page min-h-screen text-slate-100">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
            />
            <SiteHeader contentClassName="flex items-center justify-between gap-4">
                <Link
                    href={localizePath('/', locale)}
                    className="flex items-center gap-2.5 text-sm font-semibold text-white">
                    <BrandLogo />
                    <span
                        dir="ltr"
                        translate="no">
                        {SITE_NAME}
                    </span>
                </Link>
                <nav
                    aria-label={copy.browseAll}
                    className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
                    <Link
                        href={localizePath('/', locale)}
                        className="transition hover:text-violet-200">
                        {copy.homeLink}
                    </Link>
                    <Link
                        href={localizePath('/features/ai-short-drama-generator', locale)}
                        className="transition hover:text-violet-200">
                        {copy.shortDramaLink}
                    </Link>
                    <span className="text-violet-200">{translateMessage(locale, '常见问题')}</span>
                </nav>
                <Link
                    href={`${localizePath('/', locale)}?create=story`}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500">
                    {copy.cta}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Link>
            </SiteHeader>

            <section
                aria-labelledby="faq-heading"
                className="mx-auto max-w-6xl px-4 pb-6 pt-8 sm:px-6 sm:pt-10">
                <h1
                    id="faq-heading"
                    className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    {copy.heading}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">{copy.intro}</p>
            </section>

            <section
                id="faq-content"
                className="border-b border-white/[0.06] bg-[#080a11]">
                <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 pb-12 pt-2 sm:px-6 sm:pb-16 sm:pt-4 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-16">
                    <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.quickBrowse}</p>
                        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                            {copy.categories.map((category, index) => (
                                <a
                                    key={category.title}
                                    href={`#faq-category-${index}`}
                                    className="inline-flex shrink-0 items-center rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-slate-400 transition hover:border-violet-300/25 hover:bg-violet-400/[0.06] hover:text-violet-200 lg:border-0 lg:px-2">
                                    <span className="me-2 font-mono text-[10px] text-violet-300/70">0{index + 1}</span>
                                    {category.title}
                                </a>
                            ))}
                        </nav>
                    </aside>

                    <div className="min-w-0 space-y-12">
                        {copy.categories.map((category, categoryIndex) => (
                            <section
                                key={category.title}
                                id={`faq-category-${categoryIndex}`}
                                className="scroll-mt-6">
                                <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] pb-4">
                                    <div>
                                        <p className="font-mono text-xs text-violet-300/70">{String(categoryIndex + 1).padStart(2, '0')}</p>
                                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{category.title}</h2>
                                    </div>
                                    <Sparkles className="mb-1 hidden h-5 w-5 text-violet-300/50 sm:block" />
                                </div>
                                <div className="mt-4 grid gap-3">
                                    {category.items.map(item => (
                                        <details
                                            key={item.question}
                                            className="group rounded-2xl border border-white/[0.08] bg-white/[0.025] transition-colors hover:border-violet-300/25 hover:bg-white/[0.04] open:border-violet-300/25 open:bg-violet-400/[0.045]">
                                            <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 font-medium text-slate-200 marker:hidden sm:px-6">
                                                <span>{item.question}</span>
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.1] text-slate-500 transition group-open:rotate-180 group-open:border-violet-300/30 group-open:text-violet-200">
                                                    <ChevronDown className="h-4 w-4" />
                                                </span>
                                            </summary>
                                            <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                                                <p className="border-t border-white/[0.08] pt-4 text-sm leading-7 text-slate-400">{item.answer}</p>
                                            </div>
                                        </details>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
            </section>

            <SiteFooter />
        </main>
    )
}
