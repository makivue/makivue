import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import SignupBonus from '@/components/SignupBonus'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import { isLocale, localizePath, type Locale } from '@/i18n/config'
import { SEO_FEATURE_LOCALE, SEO_LOCALE } from '@/i18n/seo'
import { translateMessage } from '@/i18n/catalog'
import { getSiteUrl, SITE_NAME, SITE_SOCIAL_IMAGE, withSiteName } from '@/lib/seo'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import { isSeoPageSlug, seoPages, seoPageSlugs, type SeoPageSlug } from '@/lib/seo-pages'

type Props = { params: Promise<{ slug: string }> }

function requestLocale(value: string | null): Locale {
    return isLocale(value) ? value : 'en'
}

function featurePath(slug: SeoPageSlug, locale: Locale) {
    return localizePath(`/features/${slug}`, locale)
}

export function generateStaticParams() {
    return seoPageSlugs.map(slug => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params
    if (!isSeoPageSlug(slug)) return {}
    const locale = requestLocale((await headers()).get('x-app-locale'))
    return buildPublicMetadata(locale, featurePath(slug, locale), SEO_FEATURE_LOCALE[locale][slug])
}

export default async function FeaturePage({ params }: Props) {
    const { slug } = await params
    if (!isSeoPageSlug(slug)) notFound()
    const locale = requestLocale((await headers()).get('x-app-locale'))
    const page = seoPages[slug]
    const metadata = SEO_FEATURE_LOCALE[locale][slug]
    const t = (source: string) => translateMessage(locale, source)
    const siteUrl = getSiteUrl()
    const canonicalUrl = new URL(featurePath(slug, locale), siteUrl).toString()
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
            { '@type': 'FAQPage', mainEntity: page.faqs.map(faq => ({ '@type': 'Question', name: t(faq.question), acceptedAnswer: { '@type': 'Answer', text: t(faq.answer) } })) }
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
                <div className="flex items-center gap-2">
                    <Link
                        href={`${localizePath('/', locale)}?create=story`}
                        className="hidden items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 sm:inline-flex">
                        {t('免费开始创作')}
                        <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                    </Link>
                </div>
            </SiteHeader>

            <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
                <div className="max-w-4xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.08] px-3 py-1.5 text-xs font-medium text-violet-200">
                        <Sparkles className="h-3.5 w-3.5" />
                        {t(page.eyebrow)}
                    </div>
                    <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl">{t(page.heading)}</h1>
                    <p className="mt-6 max-w-3xl text-base leading-8 text-slate-400 sm:text-lg">{t(page.intro)}</p>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Link
                            href={`${localizePath('/', locale)}?create=story`}
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white">
                            {t('免费注册，领取金币')}
                            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                        </Link>
                        <Link
                            href={localizePath('/wallet', locale)}
                            className="rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/5">
                            {t('查看充值与费用')}
                        </Link>
                        <Link
                            href={localizePath('/faq', locale)}
                            className="rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/5">
                            {t('常见问题')}
                        </Link>
                    </div>
                    <div className="mt-8 max-w-2xl">
                        <SignupBonus
                            locale={locale}
                            compact
                        />
                    </div>
                </div>
            </section>

            <section className="border-y border-white/[0.06] bg-white/[0.018]">
                <div className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:px-6 lg:grid-cols-3">
                    {page.benefits.map(item => (
                        <article
                            key={item.title}
                            className="rounded-2xl border border-white/[0.07] bg-black/20 p-6">
                            <CheckCircle2 className="h-5 w-5 text-violet-300" />
                            <h2 className="mt-4 font-semibold text-white">{t(item.title)}</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500">{t(item.description)}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
                <h2 className="text-2xl font-semibold text-white sm:text-3xl">{t('三个步骤完成创作')}</h2>
                <div className="mt-8 grid gap-5 lg:grid-cols-3">
                    {page.steps.map((step, index) => (
                        <article
                            key={step.title}
                            className="rounded-2xl border border-white/[0.07] p-6">
                            <div className="text-sm font-bold text-violet-300">0{index + 1}</div>
                            <h3 className="mt-4 font-semibold text-white">{t(step.title)}</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-500">{t(step.description)}</p>
                        </article>
                    ))}
                </div>

                <div className="mt-16 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
                    <div>
                        <h2 className="text-2xl font-semibold text-white">{t('适合这些创作场景')}</h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            {page.useCases.map(item => (
                                <span
                                    key={item}
                                    className="rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-sm text-slate-400">
                                    {t(item)}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h2 className="text-2xl font-semibold text-white">{t('常见问题')}</h2>
                        <div className="mt-5 space-y-3">
                            {page.faqs.map(faq => (
                                <details
                                    key={faq.question}
                                    className="group rounded-2xl border border-white/[0.07] bg-white/[0.018] p-5">
                                    <summary className="cursor-pointer list-none font-medium text-slate-200">{t(faq.question)}</summary>
                                    <p className="mt-3 text-sm leading-6 text-slate-500">{t(faq.answer)}</p>
                                </details>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <SiteFooter />
        </main>
    )
}
