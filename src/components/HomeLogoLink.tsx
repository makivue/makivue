'use client'

import BrandLogo from '@/components/BrandLogo'
import { useI18n } from '@/i18n/I18nProvider'
import Link from '@/i18n/navigation'
import { SITE_NAME } from '@/lib/seo'

export default function HomeLogoLink({
    size,
    showName = false,
    compact = false,
    className = '',
    nameClassName = ''
}: {
    size?: number
    showName?: boolean
    compact?: boolean
    className?: string
    nameClassName?: string
}) {
    const { t } = useI18n()
    const label = t('返回首页')

    return (
        <Link
            href="/"
            aria-label={label}
            title={label}
            className={`${compact ? 'min-h-8 p-1' : 'min-h-10 p-1.5'} inline-flex shrink-0 items-center gap-2 rounded-lg transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-400 ${className}`.trim()}>
            <BrandLogo size={size ?? (compact ? 24 : 28)} />
            {showName ? (
                <span
                    dir="ltr"
                    translate="no"
                    className={`font-semibold tracking-tight text-white ${nameClassName}`.trim()}>
                    {SITE_NAME}
                </span>
            ) : null}
        </Link>
    )
}
