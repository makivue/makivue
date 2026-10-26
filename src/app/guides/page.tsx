import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import CreationGuideShell from '@/components/CreationGuideShell'
import CreationToolLinks from '@/components/CreationToolLinks'
import JsonLd from '@/components/JsonLd'
import { creationGuides, guideIndexCopy, guideLocales, guideSlugs, isGuideLocale } from '@/i18n/creation-guides'
import { localizePath } from '@/i18n/config'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import { buildGuideIndexJsonLd } from '@/lib/creation-guide-seo'

export const dynamic = 'force-dynamic'

async function getLocale() {
    const locale = (await headers()).get('x-app-locale') || 'en'
    if (!isGuideLocale(locale)) notFound()
    return locale
}

export async function generateMetadata(): Promise<Metadata> {
    const locale = await getLocale()
    return buildPublicMetadata(locale, '/guides', guideIndexCopy[locale], guideLocales)
}

export default async function GuidesPage() {
    const locale = await getLocale()
    const copy = guideIndexCopy[locale]
    return (
        <CreationGuideShell locale={locale}>
            <JsonLd data={buildGuideIndexJsonLd(locale)} />
            <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
                <p className="text-sm font-semibold text-violet-300">{copy.label}</p>
                <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-5xl">{copy.heading}</h1>
                <p className="mt-6 max-w-3xl text-base leading-8 text-slate-300">{copy.intro}</p>
                <CreationToolLinks locale={locale} />
                <div className="mt-12 grid gap-5 md:grid-cols-2">
                    {guideSlugs.map(slug => {
                        const guide = creationGuides[locale][slug]
                        return (
                            <article
                                key={slug}
                                className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
                                <h2 className="text-xl font-semibold text-white">
                                    <Link
                                        href={localizePath(`/guides/${slug}`, locale)}
                                        className="underline-offset-4 hover:text-violet-200 hover:underline">
                                        {guide.heading}
                                    </Link>
                                </h2>
                                <p className="mt-4 text-sm leading-7 text-slate-300">{guide.description}</p>
                            </article>
                        )
                    })}
                </div>
                <Link
                    href={localizePath('/how-to-use', locale)}
                    className="mt-10 inline-block text-violet-200 underline underline-offset-4">
                    {copy.walkthrough}
                </Link>
            </section>
        </CreationGuideShell>
    )
}
