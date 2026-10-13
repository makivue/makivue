import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, Clock3, Layers3 } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import JsonLd from '@/components/JsonLd'
import { knowledgeUpdated } from '@/i18n/knowledge.zh'
import { getKnowledgeContent } from '@/i18n/knowledge'
import { isLocale, defaultLocale, localeDirection, localizePath } from '@/i18n/config'
import { SEO_LOCALE } from '@/i18n/seo'
import { buildPublicMetadata } from '@/lib/seo-metadata'
import { SITE_NAME } from '@/lib/seo'
import { buildKnowledgeJsonLd } from '@/lib/knowledge-seo'
import { KnowledgeContents, ProductionChecklist, PromptBlock } from './KnowledgeTools'
import styles from './knowledge.module.css'

async function requestLocale() {
    const value = (await headers()).get('x-app-locale')
    return isLocale(value) ? value : defaultLocale
}

export async function generateMetadata(): Promise<Metadata> {
    const locale = await requestLocale()
    const { copy } = await getKnowledgeContent(locale)
    const pageMetadata = buildPublicMetadata(locale, '/how-to-use', copy)
    return {
        ...pageMetadata,
        authors: [{ name: copy.byline }],
        openGraph: { ...pageMetadata.openGraph, type: 'article', modifiedTime: knowledgeUpdated }
    }
}

function LabeledNote({ label, children, suggestion = false }: { label: string; children: ReactNode; suggestion?: boolean }) {
    return (
        <div className={`${styles.note} ${suggestion ? styles.suggestion : ''}`}>
            <h3>{label}</h3>
            <p>{children}</p>
        </div>
    )
}

export default async function KnowledgePage() {
    const locale = await requestLocale()
    const { copy, sections: knowledgeSections, faqs: knowledgeFaqs, references: knowledgeSources } = await getKnowledgeContent(locale)

    return (
        <div
            id="knowledge-top"
            lang={SEO_LOCALE[locale].html}
            dir={localeDirection(locale)}
            data-i18n-skip
            className={styles.page}>
            <JsonLd data={await buildKnowledgeJsonLd(locale)} />
            <SiteHeader contentClassName={styles.headerContent}>
                <Link
                    href={localizePath('/', locale)}
                    className={styles.brand}>
                    <BrandLogo />
                    <span translate="no">{SITE_NAME}</span>
                </Link>
                <nav
                    aria-label={copy.guide}
                    className={styles.headerNav}>
                    <Link href={localizePath('/', locale)}>{copy.home}</Link>
                    <span aria-current="page">{copy.guide}</span>
                </nav>
                <Link
                    className={styles.headerCta}
                    href={`${localizePath('/', locale)}#drama-description`}>
                    {copy.create}
                    <ArrowUpRight size={16} />
                </Link>
            </SiteHeader>

            <main>
                <section className={styles.hero}>
                    <div>
                        <p className={styles.eyebrow}>
                            <BookOpen size={15} />
                            {copy.eyebrow}
                        </p>
                        <h1>
                            {copy.heading[0]}
                            <br />
                            <span>{copy.heading[1]}</span>
                        </h1>
                        <p className={styles.heroIntro}>{copy.intro}</p>
                        <div className={styles.meta}>
                            <span>{copy.edition}</span>
                            <span>
                                <Clock3 size={14} />
                                {copy.readingTime}
                            </span>
                            <span>
                                <Layers3 size={14} />
                                {copy.chapterCount}
                            </span>
                        </div>
                        <p className={styles.byline}>
                            {copy.byline} · {copy.updated} <time dateTime={knowledgeUpdated}>{knowledgeUpdated}</time>
                        </p>
                        <div className={styles.heroActions}>
                            <a
                                className={styles.primaryLink}
                                href="#workflow">
                                {copy.startReading}
                                <ArrowDown size={16} />
                            </a>
                            <a
                                className={styles.secondaryLink}
                                href="#checklist">
                                {copy.jumpChecklist}
                                <ArrowUpRight size={16} />
                            </a>
                        </div>
                    </div>
                    <div className={styles.workflow}>
                        <div className={styles.workflowHeader}>
                            <span>{copy.workflowEyebrow}</span>
                            <span className={styles.statusDot} />
                        </div>
                        <h2>{copy.workflowTitle}</h2>
                        <ol>
                            {copy.workflow.map((item, index) => (
                                <li key={item.name}>
                                    <span className={styles.workflowNumber}>{String(index + 1).padStart(2, '0')}</span>
                                    <strong>{item.name}</strong>
                                    <span>{item.detail}</span>
                                </li>
                            ))}
                        </ol>
                        <p>
                            <Check size={15} />
                            {copy.workflowNote}
                        </p>
                    </div>
                </section>

                <div className={styles.contentLayout}>
                    <aside>
                        <KnowledgeContents
                            labels={{ toc: copy.toc, jumpChecklist: copy.jumpChecklist }}
                            sections={[
                                ...knowledgeSections.map(({ id, number, label }) => ({ id, number, label })),
                                { id: 'questions', number: 'FAQ', label: copy.faqTitle },
                                { id: 'sources', number: 'REF', label: copy.sourcesTitle }
                            ]}
                        />
                    </aside>
                    <article className={styles.article}>
                        <nav
                            className={styles.quickStart}
                            aria-label={copy.quickTitle}>
                            <h2>{copy.quickTitle}</h2>
                            <div className={styles.resourceGrid}>
                                {copy.quickLinks.map(item => (
                                    <a
                                        key={item.href}
                                        href={item.href}>
                                        <strong>
                                            {item.label}
                                            <ArrowDown size={14} />
                                        </strong>
                                        <span>{item.detail}</span>
                                    </a>
                                ))}
                            </div>
                        </nav>
                        <div className={styles.caseStudy}>
                            <span className={styles.caseMarker}>{copy.caseEyebrow}</span>
                            <h2>{copy.caseLabel}</h2>
                            <p>{copy.caseText}</p>
                            <p className={styles.caseNote}>{copy.caseNote}</p>
                        </div>

                        {knowledgeSections.map(section => (
                            <section
                                key={section.id}
                                id={section.id}
                                className={styles.chapter}>
                                <div className={styles.chapterEyebrow}>
                                    <span>{section.number}</span>
                                    {section.label}
                                </div>
                                <h2>{section.title}</h2>
                                <p className={styles.intro}>{section.intro}</p>
                                <p className={styles.principle}>{section.principle}</p>

                                <ol
                                    className={styles.steps}
                                    aria-label={copy.howTo}>
                                    {section.steps.map((step, index) => (
                                        <li key={step.title}>
                                            <span>{index + 1}</span>
                                            <div>
                                                <h3>{step.title}</h3>
                                                <p>{step.body}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ol>

                                {section.comparison && (
                                    <div className={styles.comparison}>
                                        <div>
                                            <span>{copy.before}</span>
                                            <p>{section.comparison.before}</p>
                                        </div>
                                        <div>
                                            <span>{copy.after}</span>
                                            <p>{section.comparison.after}</p>
                                        </div>
                                    </div>
                                )}

                                {section.table && (
                                    <div className={styles.tableBlock}>
                                        <div
                                            className={styles.tableScroll}
                                            tabIndex={0}
                                            role="region"
                                            aria-label={section.table.caption}>
                                            <table>
                                                <caption>{section.table.caption}</caption>
                                                <thead>
                                                    <tr>
                                                        {section.table.columns.map(column => (
                                                            <th
                                                                key={column}
                                                                scope="col">
                                                                {column}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {section.table.rows.map(row => (
                                                        <tr key={row[0]}>
                                                            {row.map((cell, index) =>
                                                                index === 0 ? (
                                                                    <th
                                                                        key={index}
                                                                        scope="row">
                                                                        {cell}
                                                                    </th>
                                                                ) : (
                                                                    <td key={index}>{cell}</td>
                                                                )
                                                            )}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <p className={styles.scrollHint}>{copy.tableScroll}</p>
                                    </div>
                                )}

                                {section.image && (
                                    <figure className={styles.figure}>
                                        <a
                                            href={section.image.src}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`${copy.enlarge}：${section.label}`}>
                                            <div className={styles.figureBar}>
                                                <span>{copy.figureEyebrow}</span>
                                                <ArrowUpRight size={15} />
                                            </div>
                                            <Image
                                                src={section.image.src}
                                                width={section.image.width}
                                                height={section.image.height}
                                                alt={section.image.alt}
                                                sizes="(max-width: 900px) calc(100vw - 40px), 860px"
                                                unoptimized
                                            />
                                        </a>
                                        <figcaption>{section.image.caption}</figcaption>
                                    </figure>
                                )}

                                {section.prompt && (
                                    <PromptBlock
                                        key={locale}
                                        text={section.prompt}
                                        labels={{ prompt: copy.prompt, copy: copy.copy, copied: copy.copied, copyFailed: copy.copyFailed }}
                                    />
                                )}
                                <div className={styles.notes}>
                                    <LabeledNote label={copy.current}>{section.current}</LabeledNote>
                                    <LabeledNote
                                        label={copy.advanced}
                                        suggestion>
                                        {section.advanced}
                                    </LabeledNote>
                                </div>
                                <div className={styles.checkpoint}>
                                    <Check size={18} />
                                    <p>
                                        <strong>{copy.checkpoint}</strong>
                                        {section.checkpoint}
                                    </p>
                                </div>
                                {section.related && (
                                    <Link
                                        className={styles.relatedLink}
                                        href={section.related.href}>
                                        {section.related.label}
                                        <ArrowRight size={14} />
                                    </Link>
                                )}
                                {section.sources && (
                                    <div className={styles.citations}>
                                        <span>{copy.sourceLabel}</span>
                                        {section.sources.map(id => {
                                            const source = knowledgeSources.find(item => item.id === id)!
                                            return (
                                                <a
                                                    key={id}
                                                    href={`#source-${id}`}>
                                                    {source.platform}
                                                </a>
                                            )
                                        })}
                                    </div>
                                )}
                            </section>
                        ))}

                        <section
                            id="checklist"
                            className={styles.checklistSection}>
                            <p className={styles.eyebrow}>{copy.checklistEyebrow}</p>
                            <h2>{copy.checklistTitle}</h2>
                            <p>{copy.checklistIntro}</p>
                            <ProductionChecklist
                                copy={{
                                    checklist: copy.checklist,
                                    checklistProgress: copy.checklistProgress,
                                    checklistLabel: copy.checklistLabel,
                                    checklistReady: copy.checklistReady,
                                    checklistPending: copy.checklistPending,
                                    reset: copy.reset
                                }}
                            />
                        </section>
                        <section
                            id="questions"
                            className={styles.chapter}>
                            <h2>{copy.faqTitle}</h2>
                            <p className={styles.intro}>{copy.faqIntro}</p>
                            <div className={styles.faqList}>
                                {knowledgeFaqs.map(item => (
                                    <details key={item.question}>
                                        <summary>{item.question}</summary>
                                        <p>{item.answer}</p>
                                        <a
                                            className={styles.relatedLink}
                                            href={item.href}>
                                            {item.label}
                                            <ArrowUpRight size={14} />
                                        </a>
                                    </details>
                                ))}
                            </div>
                        </section>
                        <section className={styles.chapter}>
                            <h2>{copy.resourcesTitle}</h2>
                            <div className={styles.resourceGrid}>
                                {copy.resources.map(item => (
                                    <Link
                                        key={item.href}
                                        href={item.href}>
                                        <strong>
                                            {item.label}
                                            <ArrowUpRight size={14} />
                                        </strong>
                                        <span>{item.body}</span>
                                    </Link>
                                ))}
                            </div>
                        </section>
                        <section
                            id="sources"
                            className={styles.chapter}>
                            <h2>{copy.sourcesTitle}</h2>
                            <p className={styles.intro}>{copy.sourcesIntro}</p>
                            <ol className={styles.sourceList}>
                                {knowledgeSources.map(source => (
                                    <li
                                        key={source.id}
                                        id={`source-${source.id}`}>
                                        <span>{source.platform}</span>
                                        <a
                                            href={source.url}
                                            target="_blank"
                                            rel="noopener noreferrer">
                                            {source.title}
                                            <ArrowUpRight size={14} />
                                        </a>
                                        <p>{source.note}</p>
                                    </li>
                                ))}
                            </ol>
                        </section>
                        <div className={styles.closing}>
                            <h2>{copy.footerTitle}</h2>
                            <p>{copy.footerText}</p>
                            <div className={styles.heroActions}>
                                <Link
                                    className={styles.primaryLink}
                                    href={`${localizePath('/', locale)}#drama-description`}>
                                    {copy.create}
                                    <ArrowRight size={16} />
                                </Link>
                                <Link
                                    className={styles.secondaryLink}
                                    href={localizePath('/faq', locale)}>
                                    {copy.faq}
                                    <ArrowUpRight size={16} />
                                </Link>
                            </div>
                            <p className={styles.scopeNote}>{copy.scopeNote}</p>
                            <a
                                href="#knowledge-top"
                                className={styles.backTop}>
                                {copy.backTop} ↑
                            </a>
                        </div>
                    </article>
                </div>
            </main>
            <SiteFooter />
        </div>
    )
}
