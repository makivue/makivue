'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { calculateFloatingMenuPosition } from '@/lib/floating-menu-position'
import { useI18n } from '@/i18n/I18nProvider'
import { GENERATION_MODEL_SOURCES, GENERATION_MODEL_SOURCE_LABELS, generationModelSource, isGenerationModelVisible } from '@/lib/model-display'

export interface CustomSelectOption {
    value: string
    label: ReactNode
    searchText?: string
    description?: ReactNode
    group?: string
    disabled?: boolean
}

export default function CustomSelect({
    value,
    options,
    onChange,
    placeholder = '请选择',
    ariaLabel,
    disabled = false,
    searchable = false,
    className = '',
    buttonClassName = '',
    menuClassName = ''
}: {
    value: string
    options: readonly CustomSelectOption[]
    onChange: (value: string) => void
    placeholder?: string
    ariaLabel: string
    disabled?: boolean
    searchable?: boolean
    className?: string
    buttonClassName?: string
    menuClassName?: string
}) {
    const { t } = useI18n()
    const id = useId()
    const buttonRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
    const [positioned, setPositioned] = useState(false)
    const [query, setQuery] = useState('')
    const [menuStyle, setMenuStyle] = useState({ left: 0, top: 0, width: 240, maxHeight: 420 })
    const visibleOptions = useMemo(() => options.filter(option => isGenerationModelVisible(option.value)), [options])
    const selected = visibleOptions.find(option => option.value === value)
    const filtered = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase()
        if (!keyword) return visibleOptions
        return visibleOptions.filter(option => (option.searchText ?? (typeof option.label === 'string' ? option.label : option.value)).toLocaleLowerCase().includes(keyword))
    }, [visibleOptions, query])

    useEffect(() => {
        if (!open) return
        const positionMenu = () => {
            const rect = buttonRef.current?.getBoundingClientRect()
            if (!rect) return
            setMenuStyle(
                calculateFloatingMenuPosition({
                    trigger: rect,
                    menuHeight: menuRef.current?.getBoundingClientRect().height ?? 0,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                })
            )
            setPositioned(true)
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        positionMenu()
        window.addEventListener('resize', positionMenu)
        window.addEventListener('scroll', positionMenu, true)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
            window.removeEventListener('resize', positionMenu)
            window.removeEventListener('scroll', positionMenu, true)
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [filtered.length, open])

    const groups = useMemo(() => {
        const hasModelOptions = filtered.some(option => generationModelSource(option.value))
        if (hasModelOptions) {
            const modelGroups = GENERATION_MODEL_SOURCES.map(source => ({
                name: t(GENERATION_MODEL_SOURCE_LABELS[source]),
                options: filtered.filter(option => generationModelSource(option.value) === source)
            })).filter(group => group.options.length > 0)
            const unclassified = filtered.filter(option => !generationModelSource(option.value))
            return unclassified.length > 0 ? [...modelGroups, { name: undefined, options: unclassified }] : modelGroups
        }
        const result: Array<{ name?: string; options: readonly CustomSelectOption[] }> = []
        for (const option of filtered) {
            const current = result.at(-1)
            if (current && current.name === option.group) current.options = [...current.options, option]
            else result.push({ name: option.group, options: [option] })
        }
        return result
    }, [filtered, t])

    return (
        <div className={`relative ${className}`}>
            <button
                ref={buttonRef}
                type="button"
                disabled={disabled}
                aria-label={t(ariaLabel)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={`${id}-listbox`}
                onClick={event => {
                    // Keep menus inside a native dialog's interactive top layer.
                    setPortalContainer(event.currentTarget.closest('dialog') ?? document.body)
                    setQuery('')
                    if (!open) setPositioned(false)
                    setOpen(!open)
                }}
                className={`flex w-full items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-start text-sm text-white transition-colors hover:border-gray-600 hover:bg-gray-700 focus:border-purple-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}>
                <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-gray-500'}`}>
                    <span className="min-w-0 flex-1 truncate">{selected?.label ?? t(placeholder)}</span>
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open &&
                typeof document !== 'undefined' &&
                createPortal(
                    <>
                        <button
                            type="button"
                            aria-label={t('关闭选择框')}
                            className="fixed inset-0 z-[90] cursor-default"
                            onClick={() => setOpen(false)}
                        />
                        <div
                            ref={menuRef}
                            id={`${id}-listbox`}
                            role="listbox"
                            aria-label={t(ariaLabel)}
                            style={menuStyle}
                            className={`fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 p-1.5 shadow-2xl shadow-black/60 ${positioned ? 'visible' : 'invisible'} ${menuClassName}`}>
                            {searchable && (
                                <div className="relative mb-1.5">
                                    <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                                    <input
                                        autoFocus
                                        value={query}
                                        onChange={event => setQuery(event.target.value)}
                                        placeholder={t('搜索选项')}
                                        className="w-full rounded-lg border border-gray-700 bg-gray-950 py-2 ps-9 pe-3 text-xs text-white outline-none placeholder:text-gray-600 focus:border-purple-500"
                                    />
                                </div>
                            )}
                            <div className="custom-select-scroll min-h-0 overflow-y-auto overscroll-contain pe-0.5">
                                {groups.map((group, groupIndex) => (
                                    <div key={`${group.name ?? 'default'}-${groupIndex}`}>
                                        {group.name && (
                                            <div className="sticky top-0 z-10 bg-gray-900/95 px-2.5 py-1.5 text-[10px] font-medium tracking-wider text-gray-500 backdrop-blur">{group.name}</div>
                                        )}
                                        {group.options.map(option => {
                                            const active = option.value === value
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={active}
                                                    disabled={option.disabled}
                                                    onClick={() => {
                                                        onChange(option.value)
                                                        setOpen(false)
                                                    }}
                                                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors disabled:opacity-40 ${active ? 'bg-purple-500/15 text-purple-100' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium">{option.label}</span>
                                                        {!generationModelSource(option.value) && option.description && (
                                                            <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{option.description}</span>
                                                        )}
                                                    </span>
                                                    {active && <Check className="h-3.5 w-3.5 flex-shrink-0 text-purple-400" />}
                                                </button>
                                            )
                                        })}
                                    </div>
                                ))}
                                {filtered.length === 0 && <div className="px-3 py-8 text-center text-xs text-gray-500">{t('没有匹配的选项')}</div>}
                            </div>
                        </div>
                    </>,
                    portalContainer ?? document.body
                )}
        </div>
    )
}
