'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { getAuthSessionSnapshot, isLoggedIn, onAuthChange } from '@/lib/auth'
import { getCookieConsentSnapshot, subscribeToCookieConsent } from '@/lib/cookie-consent'
import { stripLocale } from '@/i18n/config'
import { deferSignInReminder, startSignInReminder } from '@/lib/sign-in-reminder'
import SignInDialog from './SignInDialog'

type SignInRequest = { promise: Promise<boolean>; resolve: (authenticated: boolean) => void }
const SignInContext = createContext<(() => Promise<boolean>) | null>(null)

export default function SignInProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const snapshot = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    const consent = useSyncExternalStore(subscribeToCookieConsent, getCookieConsentSnapshot, () => 'pending')
    const [request, setRequest] = useState<SignInRequest | null>(null)
    const pending = useRef<SignInRequest | null>(null)

    const requestSignIn = useCallback(() => {
        if (isLoggedIn()) return Promise.resolve(true)
        if (pending.current) return pending.current.promise
        deferSignInReminder()
        let resolve!: SignInRequest['resolve']
        const promise = new Promise<boolean>(done => {
            resolve = done
        })
        const next = { promise, resolve }
        pending.current = next
        setRequest(next)
        return promise
    }, [])

    const settle = useCallback((current: SignInRequest, authenticated: boolean) => {
        if (pending.current !== current) return
        pending.current = null
        deferSignInReminder()
        setRequest(null)
        current.resolve(authenticated)
        if (authenticated) {
            requestAnimationFrame(() => document.getElementById('drama-description')?.focus({ preventScroll: true }))
        }
    }, [])

    useEffect(() => {
        return onAuthChange(() => {
            if (pending.current && isLoggedIn()) settle(pending.current, true)
        })
    }, [settle])

    useEffect(() => {
        // Navigation or unmount cancels the waiting action, preserving guest drafts.
        return () => {
            if (pending.current) settle(pending.current, false)
        }
    }, [pathname, settle])

    useEffect(() => {
        if (!snapshot || isLoggedIn() || request || consent === 'pending' || /^\/legal(?:\/|$)/.test(stripLocale(pathname))) return
        return startSignInReminder({
            canPrompt: () =>
                !isLoggedIn() &&
                !pending.current &&
                document.visibilityState === 'visible' &&
                !document.getElementById('cookie-banner-title') &&
                !document.querySelector('dialog[open], [aria-modal="true"], [popover]:popover-open') &&
                !document.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
            onPrompt: () => {
                void requestSignIn()
            }
        })
    }, [consent, pathname, request, requestSignIn, snapshot])

    return (
        <SignInContext.Provider value={requestSignIn}>
            {children}
            {request && Boolean(snapshot) && !isLoggedIn() && (
                <SignInDialog
                    onClose={() => settle(request, false)}
                    onSuccess={() => settle(request, true)}
                />
            )}
        </SignInContext.Provider>
    )
}

export function useSignIn() {
    const requestSignIn = useContext(SignInContext)
    if (!requestSignIn) throw new Error('MISSING_SIGN_IN_PROVIDER')
    return requestSignIn
}
