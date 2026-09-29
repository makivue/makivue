'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Coins, X } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { clientFetch } from '@/lib/client-fetch'
import { formatPointBalance } from '@/lib/points'
import { requiredWalletPointsFromMessage, WALLET_RECHARGE_REQUIRED_EVENT, type WalletRechargeRequiredDetail } from '@/lib/wallet-gate'

export default function WalletRechargePrompt() {
    const router = useRouter()
    const { locale, t } = useI18n()
    const [open, setOpen] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [balancePoints, setBalancePoints] = useState<number | null>(null)
    const balanceRequestVersion = useRef(0)
    const close = useCallback(() => {
        balanceRequestVersion.current += 1
        setOpen(false)
    }, [])

    useEffect(() => {
        const show = (event: Event) => {
            const detail = (event as CustomEvent<WalletRechargeRequiredDetail>).detail
            const nextMessage = detail?.message?.trim() || null
            const requiredPoints = requiredWalletPointsFromMessage(nextMessage)
            const requestVersion = ++balanceRequestVersion.current
            setMessage(nextMessage)
            setBalancePoints(null)
            // A stored task failure can arrive after its temporary reservation
            // has already been released. Verify the current spendable balance
            // before showing a recharge prompt with a known requirement.
            setOpen(requiredPoints === null)
            void clientFetch('/api/wallet/balance')
                .then(async response => {
                    const payload = (await response.json()) as { success?: boolean; data?: { balancePoints?: number } }
                    const balance = payload.data?.balancePoints
                    if (requestVersion !== balanceRequestVersion.current) return
                    if (response.ok && Number.isFinite(balance)) {
                        const currentBalance = balance ?? 0
                        if (requiredPoints !== null && currentBalance >= requiredPoints) {
                            setOpen(false)
                            return
                        }
                        setBalancePoints(currentBalance)
                    }
                    setOpen(true)
                })
                .catch(() => {
                    if (requestVersion === balanceRequestVersion.current) setOpen(true)
                })
        }
        window.addEventListener(WALLET_RECHARGE_REQUIRED_EVENT, show)
        return () => window.removeEventListener(WALLET_RECHARGE_REQUIRED_EVENT, show)
    }, [])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [close, open])

    if (!open) return null

    return (
        <div
            className="home-wallet-overlay fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/80 px-4 py-6 backdrop-blur-sm"
            onMouseDown={event => {
                if (event.target === event.currentTarget) close()
            }}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="wallet-recharge-title"
                className="home-wallet-dialog relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/25 bg-gray-950 shadow-2xl shadow-black/60">
                <div className="home-wallet-dialog-glow absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-amber-400/15 via-amber-400/5 to-transparent" />
                <div className="relative p-6">
                    <div className="flex items-start gap-3">
                        <div className="home-wallet-dialog-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-200 ring-1 ring-amber-400/25">
                            <Coins className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1 pt-1">
                            <h2
                                id="wallet-recharge-title"
                                className="home-wallet-dialog-title text-lg font-semibold text-white">
                                {t('金币不足')}
                            </h2>
                            {balancePoints !== null && (
                                <p className="home-wallet-dialog-balance mt-2 text-sm font-medium text-amber-200">
                                    {t('可用金币')}：{formatPointBalance(balancePoints, locale)}
                                </p>
                            )}
                            <p className="home-wallet-dialog-copy mt-2 text-sm leading-6 text-gray-400">{message ? t(message) : t('当前账户没有可用金币，请先充值后再继续。')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={close}
                            aria-label="关闭"
                            className="home-wallet-dialog-close rounded-lg p-1.5 text-gray-500 transition hover:bg-white/5 hover:text-white">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={close}
                            className="home-wallet-dialog-cancel rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:border-gray-600 hover:bg-gray-800 hover:text-white">
                            {t('取消')}
                        </button>
                        <button
                            type="button"
                            autoFocus
                            onClick={() => {
                                close()
                                router.push('/wallet')
                            }}
                            className="home-wallet-dialog-primary inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-gray-950 shadow-lg shadow-amber-950/30 transition hover:from-amber-400 hover:to-orange-400">
                            {t('立即充值')}
                            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
