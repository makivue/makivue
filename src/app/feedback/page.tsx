import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { isLocale } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'
import BrandLogo from '@/components/BrandLogo'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from '@/i18n/navigation'
import FeedbackForm from './FeedbackForm'

export async function generateMetadata(): Promise<Metadata> {
    const requestedLocale = (await headers()).get('x-app-locale')
    const locale = isLocale(requestedLocale) ? requestedLocale : 'en'
    return { title: translateMessage(locale, '意见反馈'), robots: { index: false, follow: true } }
}

export default function FeedbackPage() {
    return (
        <main className="app-page flex min-h-screen flex-col text-slate-100">
            <SiteHeader contentClassName="flex items-center gap-3">
                <Link
                    href="/"
                    className="flex items-center gap-2.5 font-semibold text-white"
                    aria-label="makivue">
                    <BrandLogo />
                    <span translate="no">makivue</span>
                </Link>
            </SiteHeader>
            <FeedbackForm />
            <SiteFooter />
        </main>
    )
}
