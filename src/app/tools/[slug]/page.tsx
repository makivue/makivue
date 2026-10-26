import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import CreationToolShell from '@/components/CreationToolShell'
import JsonLd from '@/components/JsonLd'
import { creationTools, toolIndexCopy } from '@/i18n/creation-tools'
import { isToolLocale, isToolSlug, toolLocales } from '@/i18n/creation-tool-config'
import { localizePath } from '@/i18n/config'
import { SEO_FEATURE_LOCALE } from '@/i18n/seo'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import { buildToolJsonLd } from '@/lib/creation-tool-seo'

type Props = { params: Promise<{ slug: string }> }
export const dynamic = 'force-dynamic'

async function getTool({ params }: Props) {
    const { slug } = await params
    const locale = (await headers()).get('x-app-locale') || 'en'
    if (!isToolSlug(slug) || !isToolLocale(locale)) notFound()
    return { slug, locale, tool: creationTools[locale][slug], copy: toolIndexCopy[locale] }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    const { slug, locale, tool } = await getTool(props)
    return buildPublicMetadata(locale, `/tools/${slug}`, tool, toolLocales)
}

export default async function ToolPage(props: Props) {
    const { slug, locale, tool, copy } = await getTool(props)
    const action = localizePath(tool.action, locale)
    return (
        <CreationToolShell locale={locale}>
            <JsonLd data={buildToolJsonLd(locale, slug)} />
            <article className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
                <header className="max-w-4xl">
                    <Link
                        href={localizePath('/tools', locale)}
                        className="text-sm font-semibold text-violet-300 underline-offset-4 hover:underline">
                        {copy.label}
                    </Link>
                    <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl">{tool.heading}</h1>
                    <p className="mt-6 text-base leading-8 text-slate-300 sm:text-lg">{tool.intro}</p>
                    <div className="mt-7 flex flex-wrap items-center gap-5">
                        <Link
                            href={action}
                            className="app-action app-action-primary inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500">
                            {tool.actionLabel}
                        </Link>
                        <Link
                            href={localizePath('/pricing', locale)}
                            className="text-sm text-violet-200 underline-offset-4 hover:underline">
                            {copy.pricing}
                        </Link>
                    </div>
                </header>
                <section className="mt-14">
                    <h2 className="text-2xl font-semibold text-white">{copy.features}</h2>
                    <div className="mt-6 grid gap-5 md:grid-cols-3">
                        {tool.features.map(item => (
                            <section
                                key={item.heading}
                                className="rounded-2xl border border-white/10 p-5 sm:p-6">
                                <h3 className="text-lg font-semibold text-white">{item.heading}</h3>
                                <p className="mt-3 text-sm leading-7 text-slate-300">{item.text}</p>
                            </section>
                        ))}
                    </div>
                </section>
                <section className="mt-14">
                    <h2 className="text-2xl font-semibold text-white">{copy.steps}</h2>
                    <ol className="mt-6 grid gap-5 md:grid-cols-3">
                        {tool.steps.map((item, index) => (
                            <li
                                key={item.heading}
                                className="rounded-2xl border border-white/10 p-5 sm:p-6">
                                <span className="text-sm font-semibold text-violet-300">{String(index + 1).padStart(2, '0')}</span>
                                <h3 className="mt-3 text-lg font-semibold text-white">{item.heading}</h3>
                                <p className="mt-3 text-sm leading-7 text-slate-300">{item.text}</p>
                            </li>
                        ))}
                    </ol>
                </section>
                <section className="mt-14 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-6 sm:p-8">
                    <h2 className="text-2xl font-semibold text-white">{tool.example.heading}</h2>
                    <figure className="mt-5">
                        <figcaption className="text-sm font-semibold text-violet-200">{copy.example}</figcaption>
                        <p className="mt-3 whitespace-pre-line text-base leading-8 text-slate-200">{tool.example.prompt}</p>
                    </figure>
                    <p className="mt-4 text-sm leading-7 text-slate-400">{tool.example.note}</p>
                </section>
                <section className="mt-14">
                    <h2 className="text-2xl font-semibold text-white">{copy.useCases}</h2>
                    <div className="mt-6 grid gap-5 md:grid-cols-3">
                        {tool.useCases.map(item => (
                            <section
                                key={item.heading}
                                className="rounded-2xl border border-white/10 p-5 sm:p-6">
                                <h3 className="text-lg font-semibold text-white">{item.heading}</h3>
                                <p className="mt-3 text-sm leading-7 text-slate-300">{item.text}</p>
                            </section>
                        ))}
                    </div>
                </section>
                <section className="mt-14">
                    <h2 className="text-2xl font-semibold text-white">{copy.faq}</h2>
                    <div className="mt-5 space-y-3">
                        {tool.faqs.map(faq => (
                            <details
                                key={faq.question}
                                className="rounded-2xl border border-white/10 p-5">
                                <summary className="cursor-pointer font-medium text-white">{faq.question}</summary>
                                <p className="mt-3 text-sm leading-7 text-slate-300">{faq.answer}</p>
                            </details>
                        ))}
                    </div>
                </section>
                <section className="mt-14 rounded-2xl border border-white/10 p-6 sm:p-8">
                    <h2 className="text-2xl font-semibold text-white">{copy.related}</h2>
                    <p className="mt-4 text-sm leading-7 text-slate-300">{copy.credits}</p>
                    <div className="mt-5 flex flex-wrap gap-5 text-sm text-violet-200">
                        <Link href={action}>{tool.actionLabel}</Link>
                        <Link href={localizePath(`/guides/${tool.guide}`, locale)}>{copy.guide}</Link>
                        <Link href={localizePath(`/features/${tool.feature}`, locale)}>{SEO_FEATURE_LOCALE[locale][tool.feature].title}</Link>
                    </div>
                    <nav
                        aria-label={copy.related}
                        className="mt-6 grid gap-4 sm:grid-cols-2">
                        {tool.related.map(related => (
                            <Link
                                key={related}
                                href={localizePath(`/tools/${related}`, locale)}
                                className="rounded-xl border border-white/10 p-4 text-sm leading-6 text-violet-200 transition hover:bg-white/5">
                                {creationTools[locale][related].heading}
                            </Link>
                        ))}
                    </nav>
                </section>
            </article>
        </CreationToolShell>
    )
}
