'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { clientFetch } from '@/lib/client-fetch'
import { getWalletBalanceInvalidationVersion, WALLET_BALANCE_INVALIDATED_EVENT } from '@/lib/wallet-gate'
import { formatPointBalance } from '@/lib/points'

type WalletBalanceProps = {
    userId?: string
    compact?: boolean
    className?: string
}

type WalletBalanceState = {
    requestKey: string
    balancePoints: number | null
}

type CachedWalletBalance = {
    balancePoints: number
    fetchedAt: number
    invalidationVersion: number
}

const BALANCE_STALE_AFTER_MS = 60_000
const balanceCache = new Map<string, CachedWalletBalance>()
const balanceRequests = new Map<string, Promise<number>>()

function cachedBalance(requestKey: string): CachedWalletBalance | undefined {
    if (typeof window === 'undefined') return undefined
    return balanceCache.get(requestKey)
}

function loadBalance(requestKey: string): Promise<number> {
    const cached = cachedBalance(requestKey)
    if (cached && cached.invalidationVersion === getWalletBalanceInvalidationVersion() && Date.now() - cached.fetchedAt < BALANCE_STALE_AFTER_MS) {
        return Promise.resolve(cached.balancePoints)
    }

    const pending = balanceRequests.get(requestKey)
    if (pending) return pending

    const invalidationVersion = getWalletBalanceInvalidationVersion()
    const request = clientFetch('/api/wallet/balance')
        .then(async response => {
            const json = (await response.json()) as { success: boolean; data?: { balancePoints: number }; error?: string }
            if (!response.ok || !json.data) throw new Error(json.error ?? '账户余额加载失败')
            balanceCache.set(requestKey, { balancePoints: json.data.balancePoints, fetchedAt: Date.now(), invalidationVersion })
            return json.data.balancePoints
        })
        .finally(() => {
            if (balanceRequests.get(requestKey) === request) balanceRequests.delete(requestKey)
        })

    balanceRequests.set(requestKey, request)
    return request
}

export default function WalletBalance({ userId, compact = false, className = '' }: WalletBalanceProps) {
    const { locale, t } = useI18n()
    const requestKey = userId ?? 'current-user'
    const [walletState, setWalletState] = useState<WalletBalanceState | null>(() => {
        const cached = cachedBalance(requestKey)
        return cached ? { requestKey, balancePoints: cached.balancePoints } : null
    })
    const currentWalletState = walletState?.requestKey === requestKey ? walletState : null
    const balance = currentWalletState?.balancePoints
    const formattedBalance = typeof balance === 'number' ? formatPointBalance(balance, locale) : null

    useEffect(() => {
        let active = true

        const refresh = async () => {
            try {
                const balancePoints = await loadBalance(requestKey)
                if (active) setWalletState({ requestKey, balancePoints })
            } catch {
                if (active) {
                    setWalletState(current => (current?.requestKey === requestKey && typeof current.balancePoints === 'number' ? current : { requestKey, balancePoints: null }))
                }
            }
        }
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') void refresh()
        }
        const refreshAfterWalletChange = () => {
            const pending = balanceRequests.get(requestKey)
            balanceCache.delete(requestKey)
            if (!pending) {
                void refresh()
                return
            }
            void pending.finally(() => {
                if (!active) return
                balanceCache.delete(requestKey)
                void refresh()
            })
        }

        void refresh()
        window.addEventListener('focus', refreshWhenVisible)
        window.addEventListener(WALLET_BALANCE_INVALIDATED_EVENT, refreshAfterWalletChange)
        document.addEventListener('visibilitychange', refreshWhenVisible)

        return () => {
            active = false
            window.removeEventListener('focus', refreshWhenVisible)
            window.removeEventListener(WALLET_BALANCE_INVALIDATED_EVENT, refreshAfterWalletChange)
            document.removeEventListener('visibilitychange', refreshWhenVisible)
        }
    }, [requestKey])

    const accessibleLabel = balance === undefined ? t('正在加载账户余额...') : `${t('账户余额')}：${formattedBalance ?? '—'}。${t('立即充值')}`

    return (
        <Link
            href="/wallet"
            aria-label={accessibleLabel}
            title={`${t('账户余额')} · ${t('立即充值')}`}
            className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-amber-400/20 bg-amber-400/[0.07] font-medium text-amber-200 transition-all hover:border-amber-300/35 hover:bg-amber-400/[0.12] hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-300/60 ${
                compact ? 'h-9 min-w-[94px] px-2.5 text-xs' : 'h-10 min-w-[108px] px-3 text-sm'
            } ${className}`}>
            <Image
                src="/brand/coin.svg"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 shrink-0"
            />
            {balance === undefined ? (
                <span
                    className="h-4 w-10 animate-pulse rounded bg-amber-200/15"
                    aria-hidden
                />
            ) : (
                <span
                    data-i18n-skip
                    aria-live="polite"
                    className="tabular-nums">
                    {formattedBalance ?? '—'}
                </span>
            )}
            <span>{t('金币')}</span>
        </Link>
    )
}
