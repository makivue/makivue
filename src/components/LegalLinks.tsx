'use client'

import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { PRIVACY_COPY } from '@/i18n/privacy'
import ContactEmail from '@/components/ContactEmail'

export default function LegalLinks({ className = '' }: { className?: string }) {
    const { locale } = useI18n()
    const copy = PRIVACY_COPY[locale]
    const linkClass = 'rounded text-gray-400 transition-colors hover:text-purple-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-purple-400'
    return (
        <div
            data-i18n-skip
            className={`flex flex-col items-center gap-4 ${className}`}>
            <nav
                aria-label={copy.legal}
                className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-xs">
                <Link
                    href="/legal/privacy"
                    className={linkClass}>
                    {copy.privacy}
                </Link>
                <Link
                    href="/legal/terms"
                    className={linkClass}>
                    {copy.terms}
                </Link>
                <ContactEmail className={linkClass} />
            </nav>
        </div>
    )
}
