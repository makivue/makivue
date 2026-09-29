'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'

/** Keep batch controls available without crowding the mobile writing surface. */
export default function StudioSidebarActions({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
    const [expanded, setExpanded] = useState(false)
    const id = useId()
    const { t } = useI18n()
    const visible = expanded || busy
    return (
        <div className="studio-sidebar-actions border-t border-gray-800 p-2">
            <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-slate-300 md:hidden"
                aria-expanded={visible}
                aria-controls={id}
                onClick={() => setExpanded(value => !value)}>
                <SlidersHorizontal className="h-4 w-4" />
                {t('批量操作')}
                <ChevronDown className={`ms-auto h-4 w-4 transition-transform ${visible ? 'rotate-180' : ''}`} />
            </button>
            <div
                id={id}
                className={`space-y-2 md:block ${visible ? 'block' : 'hidden'}`}>
                {children}
            </div>
        </div>
    )
}
