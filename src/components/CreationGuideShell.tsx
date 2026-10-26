import type { ReactNode } from 'react'
import Link from 'next/link'
import BrandLogo from './BrandLogo'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'
import { localizePath } from '@/i18n/config'
import { guideIndexCopy, type GuideLocale } from '@/i18n/creation-guides'
import { SITE_NAME } from '@/lib/seo'

export default function CreationGuideShell({ locale, children }: { locale: GuideLocale; children: ReactNode }) {
    return (
        <main
            data-i18n-skip
            className="app-page min-h-screen text-slate-100">
            <SiteHeader contentClassName="flex items-center justify-between gap-4">
                <Link
                    href={localizePath('/', locale)}
                    title={SITE_NAME}
                    className="flex items-center gap-2.5 text-sm font-semibold text-white">
                    <BrandLogo />
                    <span
                        dir="ltr"
                        translate="no">
                        {SITE_NAME}
                    </span>
                </Link>
                <Link
                    href={localizePath('/guides', locale)}
                    title={guideIndexCopy[locale].label}
                    className="text-sm text-violet-200 underline-offset-4 hover:underline">
                    {guideIndexCopy[locale].label}
                </Link>
            </SiteHeader>
            {children}
            <SiteFooter />
        </main>
    )
}
