'use client'

import NextLink, { type LinkProps } from 'next/link'
import { useRouter as useNextRouter, useParams } from 'next/navigation'
import { forwardRef, useCallback, useMemo, type AnchorHTMLAttributes } from 'react'
import { useI18n } from './I18nProvider'

export { useParams }

export function useRouter() {
    const router = useNextRouter()
    const { href } = useI18n()
    const { push: nextPush, replace: nextReplace, prefetch: nextPrefetch } = router
    const push = useCallback((url: string, options?: Parameters<typeof nextPush>[1]) => nextPush(href(url), options), [href, nextPush])
    const replace = useCallback((url: string, options?: Parameters<typeof nextReplace>[1]) => nextReplace(href(url), options), [href, nextReplace])
    const prefetch = useCallback((url: string, options?: Parameters<typeof nextPrefetch>[1]) => nextPrefetch(href(url), options), [href, nextPrefetch])
    return useMemo(() => ({ ...router, push, replace, prefetch }), [prefetch, push, replace, router])
}

type LocalizedLinkProps = LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>

const Link = forwardRef<HTMLAnchorElement, LocalizedLinkProps>(function LocalizedLink({ href: target, ...props }, ref) {
    const { href } = useI18n()
    const localized = typeof target === 'string' && target.startsWith('/') ? href(target) : target
    return <NextLink ref={ref} href={localized} {...props} />
})

export default Link
