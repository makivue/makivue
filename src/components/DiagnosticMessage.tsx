'use client'

import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { localizeDiagnostic } from '@/i18n/diagnostics'

export default function DiagnosticMessage({ message, kind = 'error' }: { message: string; kind?: 'error' | 'notice' }) {
    const { locale, t } = useI18n()
    const [expandedSource, setExpandedSource] = useState<string | null>(null)
    const diagnostic = localizeDiagnostic(locale, message, kind)
    const expanded = expandedSource === message
    return (
        <span data-i18n-skip>
            <span>{diagnostic.text}</span>
            {diagnostic.original && (
                <>
                    {' '}
                    <button
                        type="button"
                        className="text-[10px] underline opacity-70 hover:opacity-100"
                        aria-expanded={expanded}
                        onClick={() => setExpandedSource(expanded ? null : message)}>
                        {t('技术详情（提供给管理员）')}
                    </button>
                    <span
                        data-i18n-diagnostic-raw
                        hidden={!expanded}
                        className={`${expanded ? 'block' : 'hidden'} mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]`}>
                        {diagnostic.original}
                    </span>
                </>
            )}
        </span>
    )
}
