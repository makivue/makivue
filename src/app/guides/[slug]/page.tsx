import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import CreationGuideShell from '@/components/CreationGuideShell'
import CreationToolLinks from '@/components/CreationToolLinks'
import JsonLd from '@/components/JsonLd'
import { creationGuides, guideIndexCopy, guideLocales, guideSlugs, guidesUpdated, isGuideLocale, isGuideSlug } from '@/i18n/creation-guides'
import { localizePath } from '@/i18n/config'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import { buildGuideJsonLd } from '@/lib/creation-guide-seo'

type Props = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

async function getGuide({ params }: Props) {
    const { slug } = await params
    const locale = (await headers()).get('x-app-locale') || 'en'
    if (!isGuideSlug(slug) || !isGuideLocale(locale)) notFound()
    return { slug, locale, guide: creationGuides[locale][slug], copy: guideIndexCopy[locale] }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    const { slug, locale, guide } = await getGuide(props)
    return buildPublicMetadata(locale, `/guides/${slug}`, guide, guideLocales)
}

export default async function CreationGuidePage(props: Props) {
    const { slug, locale, guide, copy } = await getGuide(props)
    const action = `${localizePath(guide.action, locale)}${guide.action === '/' ? '?create=story' : ''}`
    return (
        <CreationGuideShell locale={locale}>
            <JsonLd data={buildGuideJsonLd(locale, slug)} />
            <article className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
                <header className="max-w-4xl">
                    <Link
                        href={localizePath('/guides', locale)}
                        className="text-sm font-semibold text-violet-300 underline-offset-4 hover:underline">
                        {copy.label}
                    </Link>
                    <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl">{guide.heading}</h1>
                    <p className="mt-6 text-base leading-8 text-slate-300 sm:text-lg">{guide.intro}</p>
                    <p className="mt-5 text-sm text-slate-400">
                        {copy.byline} · {copy.updated} <time dateTime={guidesUpdated}>{guidesUpdated}</time>
                    </p>
                    <Link
                        href={action}
                        className="app-action app-action-primary mt-7 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500">
                        {copy.action}
                    </Link>
                </header>
                <div className="mt-12 grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <nav
                        aria-label={copy.contents}
                        className="h-fit rounded-2xl border border-white/10 p-5 lg:sticky lg:top-24">
                        <h2 className="font-semibold text-white">{copy.contents}</h2>
                        <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                            {guide.sections.map(section => (
                                <li key={section.id}>
                                    <a
                                        href={`#${section.id}`}
                                        className="underline-offset-4 hover:text-violet-200 hover:underline">
                                        {section.heading}
                                    </a>
                                </li>
                            ))}
                        </ol>
                    </nav>
                    <div className="min-w-0 space-y-12">
                        {guide.sections.map(section => (
                            <section
                                key={section.id}
                                id={section.id}
                                className="scroll-mt-24">
                                <h2 className="text-2xl font-semibold leading-snug text-white">{section.heading}</h2>
                                {section.paragraphs.map(paragraph => (
                                    <p
                                        key={paragraph}
                                        className="mt-4 text-base leading-8 text-slate-300">
                                        {paragraph}
                                    </p>
                                ))}
                                {section.example && (
                                    <figure className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-5 sm:p-6">
                                        <figcaption className="text-sm font-semibold text-violet-200">{copy.example}</figcaption>
                                        <p className="mt-3 whitespace-pre-line text-sm leading-8 text-slate-200">{section.example}</p>
                                    </figure>
                                )}
                                {section.checklist && (
                                    <ul className="mt-5 list-disc space-y-2 ps-5 text-sm leading-7 text-slate-300">
                                        {section.checklist.map(item => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        ))}
                        <section>
                            <h2 className="text-2xl font-semibold text-white">{copy.faq}</h2>
                            <div className="mt-5 space-y-3">
                                {guide.faqs.map(faq => (
                                    <details
                                        key={faq.question}
                                        className="rounded-2xl border border-white/10 p-5">
                                        <summary className="cursor-pointer font-medium text-white">{faq.question}</summary>
                                        <p className="mt-3 text-sm leading-7 text-slate-300">{faq.answer}</p>
                                    </details>
                                ))}
                            </div>
                        </section>
                        <section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-6">
                            <h2 className="text-2xl font-semibold text-white">{copy.related}</h2>
                            <p className="mt-4 text-sm leading-7 text-slate-300">{copy.credits}</p>
                            <div className="mt-5 flex flex-wrap gap-5 text-sm text-violet-200">
                                <Link href={action}>{copy.action}</Link>
                                <Link href={localizePath(`/features/${guide.feature}`, locale)}>{copy.feature}</Link>
                                <Link href={localizePath('/pricing', locale)}>{copy.pricing}</Link>
                                <Link href={localizePath('/how-to-use', locale)}>{copy.walkthrough}</Link>
                            </div>
                            <CreationToolLinks
                                locale={locale}
                                kind={guide.action === '/aivideo' ? 'video' : 'all'}
                            />
                        </section>
                        <nav
                            aria-label={copy.label}
                            className="grid gap-4 sm:grid-cols-2">
                            {guideSlugs
                                .filter(item => item !== slug)
                                .map(item => (
                                    <Link
                                        key={item}
                                        href={localizePath(`/guides/${item}`, locale)}
                                        className="rounded-xl border border-white/10 p-4 text-sm leading-6 text-violet-200 transition hover:bg-white/5">
                                        {creationGuides[locale][item].heading}
                                    </Link>
                                ))}
                        </nav>
                    </div>
                </div>
            </article>
        </CreationGuideShell>
    )
}
