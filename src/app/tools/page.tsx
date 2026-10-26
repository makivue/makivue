import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import CreationToolShell from '@/components/CreationToolShell'
import JsonLd from '@/components/JsonLd'
import { creationTools, toolIndexCopy } from '@/i18n/creation-tools'
import { isToolLocale, toolLocales, toolSlugs } from '@/i18n/creation-tool-config'
import { toolNavigation } from '@/i18n/creation-tool-navigation'
import { localizePath } from '@/i18n/config'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import { buildToolIndexJsonLd } from '@/lib/creation-tool-seo'

export const dynamic = 'force-dynamic'

async function getLocale() {
    const locale = (await headers()).get('x-app-locale') || 'en'
    if (!isToolLocale(locale)) notFound()
    return locale
}

export async function generateMetadata(): Promise<Metadata> {
    const locale = await getLocale()
    return buildPublicMetadata(locale, '/tools', toolIndexCopy[locale], toolLocales)
}

export default async function ToolsPage() {
    const locale = await getLocale()
    const copy = toolIndexCopy[locale]
    const navigation = toolNavigation[locale]
    return (
        <CreationToolShell locale={locale}>
            <JsonLd data={buildToolIndexJsonLd(locale)} />
            <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
                <p className="text-sm font-semibold text-violet-300">{copy.label}</p>
                <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-5xl">{copy.heading}</h1>
                <p className="mt-6 max-w-3xl text-base leading-8 text-slate-300">{copy.intro}</p>
                <div className="mt-12 grid gap-5 md:grid-cols-2">
                    {toolSlugs.map(slug => {
                        const tool = creationTools[locale][slug]
                        return (
                            <article
                                key={slug}
                                className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
                                <h2 className="text-xl font-semibold leading-8 text-white">
                                    <Link
                                        href={localizePath(`/tools/${slug}`, locale)}
                                        className="underline-offset-4 hover:text-violet-200 hover:underline">
                                        {tool.heading}
                                    </Link>
                                </h2>
                                <p className="mt-4 text-sm leading-7 text-slate-300">{tool.intro}</p>
                                <Link
                                    href={localizePath(tool.action, locale)}
                                    className="mt-5 inline-flex text-sm font-semibold text-violet-200 underline-offset-4 hover:underline">
                                    {tool.actionLabel}
                                </Link>
                            </article>
                        )
                    })}
                </div>
                <section className="mt-12 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-6 sm:p-8">
                    <h2 className="text-2xl font-semibold text-white">{copy.compare}</h2>
                    <div className="mt-6 overflow-x-auto">
                        <table className="w-full min-w-[560px] border-collapse text-start text-sm leading-7 text-slate-300">
                            <thead>
                                <tr className="border-b border-white/10 text-white">
                                    <th
                                        scope="col"
                                        className="p-3 text-start font-semibold">
                                        {navigation.workflow}
                                    </th>
                                    <th
                                        scope="col"
                                        className="p-3 text-start font-semibold">
                                        {navigation.input}
                                    </th>
                                    <th
                                        scope="col"
                                        className="p-3 text-start font-semibold">
                                        {navigation.output}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {navigation.comparison.map(row => (
                                    <tr
                                        key={row.slug}
                                        className="border-b border-white/10">
                                        <th
                                            scope="row"
                                            className="p-3 text-start font-medium text-violet-200">
                                            <Link href={localizePath(`/tools/${row.slug}`, locale)}>{navigation.tools[row.slug]}</Link>
                                        </th>
                                        <td className="p-3">{row.input}</td>
                                        <td className="p-3">{row.output}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-slate-300">{copy.credits}</p>
                    <div className="mt-5 flex flex-wrap gap-5 text-sm text-violet-200">
                        <Link href={localizePath('/features/ai-video-generator', locale)}>{copy.videoTool}</Link>
                        <Link href={localizePath('/features/ai-short-drama-generator', locale)}>{copy.dramaTool}</Link>
                        <Link href={localizePath('/pricing', locale)}>{copy.pricing}</Link>
                        <Link href={localizePath('/guides', locale)}>{copy.guide}</Link>
                    </div>
                </section>
            </section>
        </CreationToolShell>
    )
}
