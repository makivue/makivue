'use client'

import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'

const translatedProps = ['placeholder', 'title', 'aria-label', 'alt'] as const

function localizeNode(node: ReactNode, t: (source: string) => string): ReactNode {
    if (typeof node === 'string') return t(node)
    // Children.map assigns stable traversal keys to static JSX child arrays.
    // A plain Array.map turns those children into a dynamic unkeyed list and
    // makes React warn on every localized server render.
    if (Array.isArray(node)) return Children.map(node, child => localizeNode(child, t))
    if (!isValidElement(node)) return node

    const element = node as ReactElement<Record<string, unknown>>
    const props = element.props
    if (props['data-i18n-skip'] != null || props.translate === 'no') return element
    const tag = typeof element.type === 'string' ? element.type.toLowerCase() : null
    if (tag === 'script' || tag === 'style') return element
    const localized: Record<string, unknown> = {}
    if ('children' in props && tag !== 'textarea') localized.children = localizeNode(props.children as ReactNode, t)
    for (const name of props['data-i18n-skip-attributes'] != null ? [] : translatedProps) {
        if (typeof props[name] === 'string') localized[name] = t(props[name])
    }
    return cloneElement(element, localized)
}

/**
 * Localizes an already-built JSX tree during React's server render as well as
 * in the browser. The root is excluded from the legacy DOM observer so the
 * same text cannot be translated a second time after hydration.
 */
export default function LocalizedContent({ children }: { children: ReactElement<Record<string, unknown>> }) {
    const { t } = useI18n()
    const localized = localizeNode(children, t) as ReactElement<Record<string, unknown>>
    return cloneElement(localized, { 'data-i18n-skip': true })
}
