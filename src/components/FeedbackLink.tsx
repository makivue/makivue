'use client'

import { MessageSquare } from 'lucide-react'
import { usePathname } from 'next/navigation'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { stripLocale } from '@/i18n/config'
import styles from './FeedbackLink.module.css'

export default function FeedbackLink({ compact = false, workspace = false }: { compact?: boolean; workspace?: boolean }) {
    const pathname = usePathname()
    const { t } = useI18n()
    return (
        <Link
            href={`/feedback?from=${encodeURIComponent(stripLocale(pathname))}`}
            title={t('意见反馈')}
            aria-label={t('意见反馈')}
            className={
                compact ? `site-header-feedback ${styles.headerLink}${workspace ? ` ${styles.workspace}` : ''}` : 'home-footer-link w-fit text-sm text-slate-300 transition hover:text-violet-200'
            }>
            {compact && (
                <MessageSquare
                    className="h-4 w-4 shrink-0"
                    aria-hidden
                />
            )}
            <span className={compact ? styles.label : undefined}>{t('意见反馈')}</span>
        </Link>
    )
}
