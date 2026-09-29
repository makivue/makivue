'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, Ellipsis, RefreshCw } from 'lucide-react'
import WalletBalance from '@/components/WalletBalance'
import { useI18n } from '@/i18n/I18nProvider'

type Props = {
    title: string
    count: number
    backLabel: string
    onBack: () => void
    settings: ReactNode
    secondaryActions?: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }[]
    progress?: { done: number; total: number; failed: number } | null
    progressResolution?: string
    children: ReactNode
}

function ReferenceActionsMenu({ actions }: { actions: NonNullable<Props['secondaryActions']> }) {
    const { t } = useI18n()
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const menuId = useId()

    useEffect(() => {
        if (!open) return
        menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
        const closeOnOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
        }
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return
            setOpen(false)
            triggerRef.current?.focus()
        }
        document.addEventListener('pointerdown', closeOnOutside)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('pointerdown', closeOnOutside)
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [open])

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (!items.length) return
        const current = items.findIndex(item => item === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
        items[next]?.focus()
    }

    return (
        <div
            ref={rootRef}
            className="relative shrink-0"
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
            }}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={t('更多操作')}
                title={t('更多操作')}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                disabled={actions.every(action => action.disabled)}
                onClick={() => setOpen(value => !value)}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setOpen(true)
                    }
                }}
                className="studio-reference-icon rounded-lg border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white disabled:opacity-40">
                <Ellipsis className="h-4 w-4" />
            </button>
            {open && (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label={t('更多操作')}
                    onKeyDown={moveFocus}
                    className="absolute end-0 top-full z-80 mt-1.5 w-[min(16rem,calc(100vw-2rem))] rounded-xl border border-gray-700 bg-gray-900 p-1.5 shadow-xl shadow-black/40">
                    {actions.map(action => (
                        <button
                            key={action.label}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            disabled={action.disabled}
                            onClick={() => {
                                setOpen(false)
                                triggerRef.current?.focus()
                                action.onClick()
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-40">
                            {action.icon}
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function ReferenceLibraryHeader({ title, count, backLabel, onBack, settings, secondaryActions, progress, progressResolution, children }: Props) {
    const { t } = useI18n()
    const percent = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

    return (
        <header className="studio-reference-header mb-4 space-y-3 border-b border-white/[0.07] pb-3">
            <div className="studio-reference-toolbar">
                <div className="studio-reference-heading flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t(backLabel)}
                        title={t(backLabel)}
                        className="studio-reference-icon rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white">
                        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                    </button>
                    <h2 className="text-lg font-semibold text-white">{t(title)}</h2>
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-xs tabular-nums text-gray-500">{count}</span>
                </div>
                <div className="studio-reference-settings flex min-w-0 items-center gap-1.5">
                    {settings}
                    {!!secondaryActions?.length && <ReferenceActionsMenu actions={secondaryActions} />}
                </div>
                <WalletBalance
                    compact
                    className="studio-reference-wallet"
                />
                <div className="studio-reference-actions flex flex-wrap items-center gap-2">{children}</div>
            </div>
            {progress && (
                <div
                    className="flex items-center gap-3 text-xs"
                    role="status"
                    aria-live="polite">
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-300" />
                    <span className="shrink-0 text-gray-400">
                        {t('生成中')} {progress.done}/{progress.total}
                        {progressResolution && ` · ${progressResolution}`}
                    </span>
                    <div
                        role="progressbar"
                        aria-label={t('生成进度')}
                        aria-valuemin={0}
                        aria-valuemax={progress.total}
                        aria-valuenow={progress.done}
                        className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-gray-800">
                        <div
                            className="progress-flow h-full rounded-full bg-purple-400"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                    {progress.failed > 0 && (
                        <span className="shrink-0 text-red-300">
                            {t('失败')} {progress.failed}
                        </span>
                    )}
                </div>
            )}
        </header>
    )
}
