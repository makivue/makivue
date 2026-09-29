import { WALLET_BALANCE_INVALIDATED_EVENT } from './wallet-gate'

// Serialize refreshes and discard a response if the wallet changed while it was loading.
export function watchWalletRefresh(load: (isCurrent: () => boolean) => Promise<void>) {
    let active = true
    let running = false
    let version = 0

    const refresh = async () => {
        version += 1
        if (running) return
        running = true
        try {
            while (active) {
                const started = version
                await load(() => active && started === version)
                if (started === version) break
            }
        } finally {
            running = false
        }
    }
    const refreshWhenVisible = () => {
        if (document.visibilityState === 'visible') void refresh()
    }

    void refresh()
    const timer = window.setInterval(refreshWhenVisible, 30_000)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener(WALLET_BALANCE_INVALIDATED_EVENT, refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
        active = false
        window.clearInterval(timer)
        window.removeEventListener('focus', refreshWhenVisible)
        window.removeEventListener(WALLET_BALANCE_INVALIDATED_EVENT, refresh)
        document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
}
