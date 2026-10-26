'use client'

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

interface InstallPromptEvent extends Event {
    prompt(): Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const PwaContext = createContext<{ canInstall: boolean; isIOS: boolean; installed: boolean; installing: boolean; install: () => Promise<void> } | null>(null)
const serverSnapshot = () => false
const subscribeToPlatform = () => () => undefined

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function subscribeToDisplayMode(listener: () => void) {
    const query = window.matchMedia('(display-mode: standalone)')
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
}

export function usePwa() {
    return useContext(PwaContext)
}

export default function PwaProvider({ children }: { children: ReactNode }) {
    const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
    const [installing, setInstalling] = useState(false)
    const [wasInstalled, setWasInstalled] = useState(false)
    const standalone = useSyncExternalStore(subscribeToDisplayMode, isStandalone, serverSnapshot)
    const ios = useSyncExternalStore(subscribeToPlatform, isIOS, serverSnapshot)

    useEffect(() => {
        const beforeInstall = (event: Event) => {
            event.preventDefault()
            setInstallPrompt(event as InstallPromptEvent)
        }
        const installed = () => {
            setWasInstalled(true)
            setInstallPrompt(null)
        }
        window.addEventListener('beforeinstallprompt', beforeInstall)
        window.addEventListener('appinstalled', installed)
        return () => {
            window.removeEventListener('beforeinstallprompt', beforeInstall)
            window.removeEventListener('appinstalled', installed)
        }
    }, [])

    useEffect(() => {
        // Keep HMR and local API proxying outside service-worker control.
        if (process.env.NODE_ENV !== 'production' || !window.isSecureContext || !('serviceWorker' in navigator)) return
        const register = () => {
            void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(error => {
                console.warn('[PWA] Service worker registration failed', error)
            })
        }
        if (document.readyState === 'complete') register()
        else window.addEventListener('load', register, { once: true })
        window.addEventListener('online', register)
        return () => {
            window.removeEventListener('load', register)
            window.removeEventListener('online', register)
        }
    }, [])

    const install = async () => {
        if (!installPrompt || installing) return
        setInstalling(true)
        try {
            await installPrompt.prompt()
            const choice = await installPrompt.userChoice
            if (choice.outcome === 'accepted') setWasInstalled(true)
        } finally {
            // Each browser prompt can only be used once, including dismissal.
            setInstallPrompt(null)
            setInstalling(false)
        }
    }

    return <PwaContext value={{ canInstall: installPrompt !== null, isIOS: ios, installed: wasInstalled || standalone, installing, install }}>{children}</PwaContext>
}
