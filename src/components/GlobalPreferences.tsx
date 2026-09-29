'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Settings, X } from 'lucide-react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import GlobalThemeSettings from '@/components/GlobalThemeSettings'
import { useI18n } from '@/i18n/I18nProvider'

export default function GlobalPreferences({ className = '' }: { className?: string }) {
    const { t } = useI18n()
    const id = useId()
    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)

    const positionPanel = useCallback(() => {
        const trigger = triggerRef.current
        const panel = panelRef.current
        if (!trigger || !panel) return
        const rect = trigger.getBoundingClientRect()
        const width = Math.min(20 * parseFloat(getComputedStyle(document.documentElement).fontSize), window.innerWidth - 32)
        const left = document.documentElement.dir === 'rtl' ? rect.left : rect.right - width
        const top = Math.max(16, rect.bottom + 8)
        panel.style.left = `${Math.max(16, Math.min(left, window.innerWidth - width - 16))}px`
        panel.style.top = `${top}px`
        panel.style.maxHeight = `${Math.max(0, window.innerHeight - top - 16)}px`
    }, [])

    useEffect(() => {
        if (!open) return
        const closeOnScroll = (event: Event) => {
            if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
            panelRef.current?.hidePopover()
        }
        window.addEventListener('resize', positionPanel)
        document.addEventListener('scroll', closeOnScroll, true)
        return () => {
            window.removeEventListener('resize', positionPanel)
            document.removeEventListener('scroll', closeOnScroll, true)
        }
    }, [open, positionPanel])

    return (
        <div
            data-i18n-skip
            className={`global-preferences shrink-0 print:hidden ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                title={t('语言与外观')}
                aria-label={t('语言与外观')}
                aria-haspopup="dialog"
                aria-controls={id}
                aria-expanded={open}
                popoverTarget={id}
                className="global-preferences-trigger grid h-10 w-10 place-items-center rounded-xl border transition">
                <Settings
                    aria-hidden="true"
                    className="h-[18px] w-[18px]"
                />
            </button>
            <div
                ref={panelRef}
                id={id}
                popover="auto"
                role="dialog"
                aria-label={t('语言与外观')}
                onBeforeToggle={event => {
                    if (event.newState === 'open') positionPanel()
                }}
                onToggle={event => setOpen(event.newState === 'open')}
                className="global-preferences-panel fixed inset-auto m-0 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border p-3 text-start shadow-2xl">
                <button
                    type="button"
                    aria-label={t('关闭')}
                    popoverTarget={id}
                    popoverTargetAction="hide"
                    className="global-theme-close absolute end-3 top-3 grid h-7 w-7 place-items-center rounded-lg transition">
                    <X
                        aria-hidden="true"
                        className="h-4 w-4"
                    />
                </button>
                <LanguageSwitcher onChoose={() => panelRef.current?.hidePopover()} />
                <div className="global-preferences-divider my-2.5 border-t" />
                <GlobalThemeSettings />
            </div>
        </div>
    )
}
