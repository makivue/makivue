'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import styles from './DramaCreator.module.css'

export default function DramaSettingsDialog({
    children,
    onClose,
    id = 'drama-settings',
    title = '剧集设定',
    className = ''
}: {
    children: ReactNode
    onClose: () => void
    id?: string
    title?: string
    className?: string
}) {
    const { t } = useI18n()
    const dialogRef = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        const dialog = dialogRef.current
        const trigger = document.activeElement
        const overflow = document.body.style.overflow
        const padding = document.body.style.paddingInlineEnd
        const scrollbar = window.innerWidth - document.documentElement.clientWidth
        document.body.style.paddingInlineEnd = `${parseFloat(getComputedStyle(document.body).paddingInlineEnd) + scrollbar}px`
        document.body.style.overflow = 'hidden'
        dialog?.showModal()
        return () => {
            dialog?.close()
            document.body.style.overflow = overflow
            document.body.style.paddingInlineEnd = padding
            if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
        }
    }, [])

    if (typeof document === 'undefined') return null
    return createPortal(
        <dialog
            ref={dialogRef}
            id={id}
            aria-labelledby={`${id}-heading`}
            className={`${styles.settingsDialog} ${className}`}
            onCancel={event => {
                event.preventDefault()
                onClose()
            }}
            onClose={event => {
                // Ignore the queued close from Strict Mode's setup/cleanup cycle.
                if (!event.currentTarget.open) onClose()
            }}
            onClick={event => {
                if (event.target === event.currentTarget) onClose()
            }}
            onKeyDown={event => {
                // Escape first dismisses an open select; the next Escape closes the dialog.
                if (event.key === 'Escape' && event.currentTarget.querySelector('[role="listbox"]')) event.preventDefault()
                if (event.key === 'Tab') {
                    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(
                        element => element.getClientRects().length > 0
                    )
                    const first = controls[0]
                    const last = controls.at(-1)
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault()
                        last?.focus()
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault()
                        first?.focus()
                    }
                }
            }}>
            <form
                className={styles.settingsDialogForm}
                onSubmit={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    onClose()
                }}>
                <div className={styles.settingsDialogHeader}>
                    <h2 id={`${id}-heading`}>
                        <SlidersHorizontal size={18} />
                        {t(title)}
                    </h2>
                    <button
                        type="button"
                        className={styles.settingsClose}
                        aria-label={t('关闭')}
                        onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
                {children}
                <div className={styles.settingsDialogFooter}>
                    <button
                        type="submit"
                        className={styles.submit}>
                        {t('完成')}
                    </button>
                </div>
            </form>
        </dialog>,
        document.body
    )
}
