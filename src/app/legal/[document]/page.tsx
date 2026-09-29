import type { Metadata } from 'next'
import { Fragment } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import ContactEmail from '@/components/ContactEmail'
import BrandLogo from '@/components/BrandLogo'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import { isLocale, localeDirection, localizePath } from '@/i18n/config'
import { PRIVACY_COPY } from '@/i18n/privacy'
import { LEGAL_CONTENT, type LegalDocument } from '@/i18n/legal'
import type { LegalSection } from '@/i18n/legal-en'
import { legalPageCopy } from '@/i18n/legal-ui'
import { SITE_CONTACT_EMAIL, SITE_NAME } from '@/lib/seo'
import PrintDocumentButton from '../PrintDocumentButton'
import styles from '../legal-document.module.css'

type Props = { params: Promise<{ document: string }> }
const documents: LegalDocument[] = ['privacy', 'terms', 'cookies']

async function documentContext(params: Props['params']) {
    const { document } = await params
    if (!documents.includes(document as LegalDocument)) notFound()
    const requestedLocale = (await headers()).get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : 'en'
    const contentLanguage = locale === 'zh' ? 'zh' : 'en'
    return { document: document as LegalDocument, locale, contentLanguage } as const
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { document, locale, contentLanguage } = await documentContext(params)
    const title = `${PRIVACY_COPY[locale][document]} | ${SITE_NAME}`
    const description = LEGAL_CONTENT[contentLanguage][document].intro
    return {
        title: { absolute: title },
        description,
        alternates: { canonical: localizePath(`/legal/${document}`, locale), languages: {} },
        openGraph: { title, description, url: localizePath(`/legal/${document}`, locale), locale: locale === 'zh' ? 'zh_CN' : 'en_US', alternateLocale: [] },
        twitter: { card: 'summary', title, description },
        robots: { index: false, follow: true, googleBot: { index: false, follow: true } }
    }
}

function LegalText({ text }: { text: string }) {
    if (!SITE_CONTACT_EMAIL) return text
    return text.split(SITE_CONTACT_EMAIL).map((part, index) => (
        <Fragment key={index}>
            {index > 0 && <ContactEmail />}
            {part}
        </Fragment>
    ))
}

function DocumentSection({ section, number }: { section: LegalSection; number: string }) {
    const nested = number.includes('.')
    const Heading = nested ? 'h3' : 'h2'
    return (
        <section
            id={section.id ?? `section-${number}`}
            className={nested ? styles.subsection : styles.section}>
            <Heading>
                {number}. {section.title}
            </Heading>
            {section.notice && (
                <aside
                    className={section.id === 'copyright-and-distribution' ? styles.copyrightNotice : styles.notice}
                    aria-label={section.notice.title}>
                    <p className={styles.noticeTitle}>{section.notice.title}</p>
                    {section.notice.paragraphs.map(paragraph => (
                        <p key={paragraph}>
                            <strong>{paragraph}</strong>
                        </p>
                    ))}
                </aside>
            )}
            <p>
                <LegalText text={section.body} />
            </p>
            {section.bullets && (
                <ul>
                    {section.bullets.map(item => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
            )}
            {section.paragraphs?.map(paragraph => (
                <p key={paragraph}>
                    <LegalText text={paragraph} />
                </p>
            ))}
            {section.subsections?.map((subsection, index) => (
                <DocumentSection
                    key={subsection.title}
                    section={subsection}
                    number={`${number}.${index + 1}`}
                />
            ))}
        </section>
    )
}

export default async function LegalPage({ params }: Props) {
    const { document, locale, contentLanguage } = await documentContext(params)
    const copy = PRIVACY_COPY[locale]
    const pageCopy = legalPageCopy(locale)
    const content = LEGAL_CONTENT[contentLanguage][document]

    return (
        <main
            data-i18n-skip
            lang={locale}
            dir={localeDirection(locale)}
            className={styles.page}>
            <SiteHeader contentClassName="flex items-center justify-between gap-4">
                <Link
                    href={localizePath('/', locale)}
                    className="flex items-center gap-2.5 text-sm font-semibold no-underline">
                    <BrandLogo />
                    <span
                        dir="ltr"
                        translate="no">
                        {SITE_NAME}
                    </span>
                </Link>
                <div className="flex items-center gap-3">
                    <Link href={localizePath('/', locale)}>{copy.back}</Link>
                    <PrintDocumentButton
                        className={styles.printButton}
                        label={pageCopy.print}
                    />
                </div>
            </SiteHeader>
            <div className={styles.pageContent}>
                <article
                    lang={contentLanguage}
                    dir="ltr"
                    className={styles.document}
                    aria-labelledby="document-title">
                    <header
                        lang={locale}
                        dir={localeDirection(locale)}
                        className={styles.header}>
                        <p className={styles.siteName}>{SITE_NAME}</p>
                        <h1 id="document-title">{copy[document]}</h1>

                        <nav
                            className={styles.documentNav}
                            aria-label={copy.legal}>
                            {documents.map(item => (
                                <Link
                                    key={item}
                                    href={localizePath(`/legal/${item}`, locale)}
                                    aria-current={item === document ? 'page' : undefined}>
                                    {copy[item]}
                                </Link>
                            ))}
                        </nav>
                    </header>

                    {contentLanguage !== locale && (
                        <p
                            lang={locale}
                            dir={localeDirection(locale)}
                            className={styles.languageNotice}>
                            {copy.languageNotice}
                        </p>
                    )}
                    <p className={styles.intro}>{content.intro}</p>

                    <nav
                        className={styles.contents}
                        aria-label={pageCopy.contentsLabel}>
                        <p className={styles.contentsTitle}>{pageCopy.contents}</p>
                        <ol>
                            {content.sections.map((section, index) => (
                                <li key={section.title}>
                                    <a href={`#${section.id ?? `section-${index + 1}`}`}>{section.title}</a>
                                </li>
                            ))}
                        </ol>
                    </nav>

                    {content.sections.map((section, index) => (
                        <DocumentSection
                            key={section.title}
                            section={section}
                            number={String(index + 1)}
                        />
                    ))}

                    <div className={styles.documentFooter}>
                        <p>
                            {SITE_NAME} · {copy[document]}
                        </p>
                        <p>
                            <ContactEmail />
                        </p>
                        <div className={styles.footerLinks}>
                            <Link href={localizePath(`/legal/${document === 'terms' ? 'privacy' : 'terms'}`, locale)}>{document === 'terms' ? copy.privacy : copy.terms}</Link>
                            <Link href={localizePath('/legal/cookies', locale)}>{copy.cookies}</Link>
                            <a href="#document-title">{pageCopy.top}</a>
                        </div>
                    </div>
                </article>
            </div>
            <SiteFooter />
        </main>
    )
}
