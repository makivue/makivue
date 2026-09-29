'use client'

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { translateMessage, type MessageValues } from './catalog'
import { defaultLocale, localeCookieName, localeStorageKey, localizePath, localeDirection, localeFromPathname, storedLocaleForUnlocalizedPath, type Locale } from './config'

type I18nValue = {
    locale: Locale
    t: (source: string, values?: MessageValues) => string
    setLocale: (locale: Locale) => void
    href: (path: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)
const translatedNodes = new WeakMap<Node, { source: string; translated: string }>()
const translatedAttributes = ['placeholder', 'title', 'aria-label', 'alt'] as const
const subscribeToPathLocale = () => () => undefined

function readStoredLocale(): string | null {
    try {
        return localStorage.getItem(localeStorageKey)
    } catch {
        return null
    }
}

function persistLocale(locale: Locale) {
    document.cookie = `${localeCookieName}=${locale};path=/;max-age=31536000;samesite=lax`
    try {
        localStorage.setItem(localeStorageKey, locale)
    } catch {
        // Cookie persistence still keeps the preference when storage is unavailable.
    }
}

function translateDom(root: ParentNode, locale: Locale) {
    const translateNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            // MutationObserver can start at a textarea/script/style or a skipped
            // element, bypassing the element branch below. Keep their contents
            // out of UI translation even when visiting a text node directly.
            if (node.parentElement?.closest('[data-i18n-skip], [translate="no"], textarea, script, style')) return
            const current = node.textContent ?? ''
            const previous = translatedNodes.get(node)
            // If React changed a previously translated node (for example a live
            // progress count), treat the new value as a fresh source message.
            const source = previous && current === previous.translated ? previous.source : current
            if (!source.trim()) return
            const next = translateMessage(locale, source)
            translatedNodes.set(node, { source, translated: next })
            if (node.textContent !== next) node.textContent = next
            return
        }
        if (!(node instanceof Element)) return
        if (node.closest('[data-i18n-skip], [translate="no"]')) return
        for (const name of node.hasAttribute('data-i18n-skip-attributes') ? [] : translatedAttributes) {
            const current = node.getAttribute(name)
            if (!current) continue
            const sourceName = `data-i18n-source-${name}`
            const translatedName = `data-i18n-translated-${name}`
            const previousSource = node.getAttribute(sourceName)
            const previousTranslation = node.getAttribute(translatedName)
            const source = previousSource && current === previousTranslation ? previousSource : current
            const next = translateMessage(locale, source)
            node.setAttribute(sourceName, source)
            node.setAttribute(translatedName, next)
            if (current !== next) node.setAttribute(name, next)
        }
        // Textarea values are user input, so their child text must never be
        // translated. Its user-facing attributes (especially placeholder)
        // still need to follow the active locale.
        if (['script', 'style', 'textarea'].includes(node.tagName.toLowerCase())) return
        for (const child of node.childNodes) translateNode(child)
    }
    for (const child of root.childNodes) translateNode(child)
}

export default function I18nProvider({ children, initialLocale = defaultLocale }: { children: ReactNode; initialLocale?: Locale }) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const router = useRouter()
    const metadataLocale = useRef(initialLocale)
    const restoringLocale = useRef<Locale | null>(null)
    const pathnameLocale = localeFromPathname(pathname)
    const locale = useSyncExternalStore(
        subscribeToPathLocale,
        () => pathnameLocale,
        () => initialLocale
    )

    useLayoutEffect(() => {
        const storedLocale = storedLocaleForUnlocalizedPath(pathname, readStoredLocale())
        if (!storedLocale || storedLocale === locale) {
            restoringLocale.current = null
            return
        }

        restoringLocale.current = storedLocale
        persistLocale(storedLocale)
        document.documentElement.classList.add('i18n-pending')
        const query = searchParams.toString()
        router.replace(`${localizePath(pathname, storedLocale)}${query ? `?${query}` : ''}${window.location.hash}`, { scroll: false })
    }, [locale, pathname, router, searchParams])

    useLayoutEffect(() => {
        if (restoringLocale.current && restoringLocale.current !== locale) return
        restoringLocale.current = null
        document.documentElement.lang = locale
        document.documentElement.dir = localeDirection(locale)
        persistLocale(locale)
        translateDom(document.body, locale)
        document.documentElement.classList.remove('i18n-pending')
        const observer = new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'characterData') translateDom(record.target.parentNode ?? document.body, locale)
                if (record.type === 'attributes') translateDom(record.target.parentNode ?? document.body, locale)
                for (const node of record.addedNodes) {
                    if (node.parentNode) translateDom(node.parentNode, locale)
                }
            }
        })
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] })
        return () => observer.disconnect()
    }, [locale])

    useLayoutEffect(() => {
        if (metadataLocale.current === locale) return
        metadataLocale.current = locale
        // Locale prefixes rewrite to shared routes. Refresh the retained server layouts
        // so their metadata is generated with the current locale headers as well.
        router.refresh()
    }, [locale, router])

    const t = useCallback((source: string, values?: MessageValues) => translateMessage(locale, source, values), [locale])
    const href = useCallback((path: string) => localizePath(path, locale), [locale])
    const setLocale = useCallback(
        (next: Locale) => {
            if (next === locale) return
            persistLocale(next)
            document.documentElement.classList.add('i18n-pending')
            const query = searchParams.toString()
            router.push(`${localizePath(pathname, next)}${query ? `?${query}` : ''}${window.location.hash}`)
        },
        [locale, pathname, router, searchParams]
    )
    const value = useMemo(() => ({ locale, t, setLocale, href }), [href, locale, setLocale, t])
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
    const value = useContext(I18nContext)
    if (!value) throw new Error('useI18n must be used inside I18nProvider')
    return value
}
