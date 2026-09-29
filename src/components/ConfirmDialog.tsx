'use client'

import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Info, ShieldAlert, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import styles from './ConfirmDialog.module.css'

interface ConfirmOptions {
    title: string
    message: ReactNode
    eyebrow?: string
    confirmText?: string
    cancelText?: string
    tone?: 'danger' | 'warning' | 'default'
}

interface PendingConfirm extends ConfirmOptions {
    resolve: (value: boolean) => void
}

export function useConfirmDialog() {
    const { t } = useI18n()
    const [pending, setPending] = useState<PendingConfirm | null>(null)
    const dialogRef = useRef<HTMLDivElement>(null)
    const cancelButtonRef = useRef<HTMLButtonElement>(null)
    const titleId = useId()
    const messageId = useId()

    const confirm = useCallback((options: ConfirmOptions) => {
        return new Promise<boolean>(resolve => {
            setPending({ ...options, resolve })
        })
    }, [])

    const close = useCallback(
        (value: boolean) => {
            pending?.resolve(value)
            setPending(null)
        },
        [pending]
    )

    useEffect(() => {
        if (!pending) return
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus())
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close(false)
            if (event.key !== 'Tab' || !dialogRef.current) return

            const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
            const first = focusable[0]
            const last = focusable.at(-1)
            if (!first || !last) return
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
            window.cancelAnimationFrame(focusFrame)
            document.removeEventListener('keydown', onKeyDown)
            document.body.style.overflow = previousOverflow
            previouslyFocused?.focus()
        }
    }, [pending, close])

    const tone = pending?.tone ?? 'default'
    const ToneIcon = tone === 'danger' ? ShieldAlert : tone === 'warning' ? AlertTriangle : Info
    const eyebrow = pending?.eyebrow ?? t(tone === 'danger' ? 'High Impact' : 'Please Confirm')

    const dialog = pending ? (
        <div
            className={`${styles.backdrop} fixed inset-0 z-50 flex items-center justify-center px-4 py-6 backdrop-blur-sm`}
            onMouseDown={event => {
                if (event.target === event.currentTarget) close(false)
            }}>
            <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
                data-tone={tone}
                className={`${styles.dialog} relative w-full max-w-[460px] overflow-y-auto rounded-2xl border`}>
                <div className="p-5 sm:p-6">
                    <div className="mb-4 flex items-center gap-3">
                        <div className={`${styles.icon} flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg`}>
                            <ToneIcon
                                className="h-5 w-5"
                                aria-hidden="true"
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className={`${styles.eyebrow} mb-1 text-xs font-medium`}>{eyebrow}</div>
                            <h2
                                id={titleId}
                                className="text-lg font-semibold leading-snug">
                                {pending.title}
                            </h2>
                        </div>
                        <button
                            type="button"
                            onClick={() => close(false)}
                            className={`${styles.close} rounded-lg p-2 transition-colors`}
                            aria-label={t('关闭')}>
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div
                        id={messageId}
                        className={`${styles.message} text-sm leading-7`}>
                        {pending.message}
                    </div>

                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                            ref={cancelButtonRef}
                            type="button"
                            onClick={() => close(false)}
                            className={`${styles.cancel} min-h-10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors`}>
                            {pending.cancelText ?? t('取消')}
                        </button>
                        <button
                            type="button"
                            onClick={() => close(true)}
                            className={`${styles.confirm} flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors`}>
                            {pending.confirmText ?? t('确认')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ) : null

    return { confirm, confirmDialog: dialog }
}
