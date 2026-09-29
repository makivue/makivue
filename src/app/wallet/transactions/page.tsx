'use client'

import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, History, Loader2, WalletCards } from 'lucide-react'
import AuthBar from '@/components/AuthBar'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import HomeLogoLink from '@/components/HomeLogoLink'
import WalletTransactionList, { type WalletTransactionItem } from '@/components/WalletTransactionList'
import { getAuthSessionSnapshot, getAuthUser, isLoggedIn, onAuthChange } from '@/lib/auth'
import { clientFetch } from '@/lib/client-fetch'
import { useI18n } from '@/i18n/I18nProvider'

type TransactionPage = {
    transactions: WalletTransactionItem[]
    nextCursor: string | null
}

function TransactionHistory({ userId }: { userId: string }) {
    const { t } = useI18n()
    const [transactions, setTransactions] = useState<WalletTransactionItem[]>([])
    const [cursors, setCursors] = useState<Array<string | null>>([null])
    const [pageIndex, setPageIndex] = useState(0)
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [retryKey, setRetryKey] = useState(0)
    const cursor = cursors[pageIndex] ?? null

    useEffect(() => {
        let cancelled = false
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
        clientFetch(`/api/wallet/transactions${query}`)
            .then(async response => {
                const json = (await response.json()) as { success: boolean; data?: TransactionPage; error?: string }
                if (!response.ok || !json.data) throw new Error(json.error ?? '账户流水加载失败')
                return json.data
            })
            .then(data => {
                if (cancelled) return
                setTransactions(data.transactions)
                setNextCursor(data.nextCursor)
                setError(null)
            })
            .catch(loadError => {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : '账户流水加载失败')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [cursor, retryKey, userId])

    const goToNextPage = () => {
        if (!nextCursor || loading) return
        setLoading(true)
        setError(null)
        setCursors(current => [...current.slice(0, pageIndex + 1), nextCursor])
        setPageIndex(current => current + 1)
    }

    const goToPreviousPage = () => {
        if (pageIndex === 0 || loading) return
        setLoading(true)
        setError(null)
        setPageIndex(current => Math.max(0, current - 1))
    }

    const retry = () => {
        setLoading(true)
        setError(null)
        setRetryKey(current => current + 1)
    }

    return (
        <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.02]">
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
                <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-violet-300" />
                    <h2 className="font-semibold text-white">{t('全部账户流水')}</h2>
                </div>
                <span className="text-xs text-slate-600">{t('第 {page} 页').replace('{page}', String(pageIndex + 1))}</span>
            </div>

            {error ? (
                <div className="px-5 py-12 text-center">
                    <p className="text-sm text-red-300">{error}</p>
                    <button
                        type="button"
                        onClick={retry}
                        className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">
                        {t('重试')}
                    </button>
                </div>
            ) : loading ? (
                <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t('正在加载账户流水...')}
                </div>
            ) : (
                <WalletTransactionList transactions={transactions} />
            )}

            {!error && !loading && (pageIndex > 0 || nextCursor) ? (
                <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4">
                    <button
                        type="button"
                        onClick={goToPreviousPage}
                        disabled={pageIndex === 0}
                        className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-35">
                        <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                        {t('上一页')}
                    </button>
                    <button
                        type="button"
                        onClick={goToNextPage}
                        disabled={!nextCursor}
                        className="inline-flex items-center gap-1 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-500/15 hover:text-white disabled:pointer-events-none disabled:opacity-35">
                        {t('下一页')}
                        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                    </button>
                </div>
            ) : null}
        </section>
    )
}

export default function WalletTransactionsPage() {
    const { href, t } = useI18n()
    const authSnapshot = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    const user = authSnapshot && isLoggedIn() ? getAuthUser() : null

    return (
        <div className="app-page flex min-h-screen flex-col text-slate-100">
            <SiteHeader contentClassName="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                    <HomeLogoLink />
                    <Link
                        href={href('/wallet')}
                        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-slate-400 transition hover:border-violet-400/30 hover:text-white"
                        aria-label={t('返回积分与充值')}>
                        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                    </Link>
                    <div className="min-w-0">
                        <h1 className="truncate text-base font-semibold text-white sm:text-lg">{t('账户流水')}</h1>
                        <p className="hidden text-xs text-slate-600 sm:block">{t('每页显示 30 条，完整记录长期保存')}</p>
                    </div>
                </div>
                <AuthBar variant="compact" />
            </SiteHeader>

            <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
                {!authSnapshot ? (
                    <div className="flex min-h-[360px] items-center justify-center text-slate-500">
                        <Loader2 className="me-2 h-5 w-5 animate-spin" />
                        {t('正在加载账户流水...')}
                    </div>
                ) : !user ? (
                    <section className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-8 text-center">
                        <WalletCards className="mx-auto h-10 w-10 text-violet-300" />
                        <h2 className="mt-5 text-xl font-semibold text-white">{t('登录后查看账户流水')}</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500">{t('登录后可以查看全部充值、消费和退款记录。')}</p>
                    </section>
                ) : (
                    <TransactionHistory
                        key={user.userId}
                        userId={user.userId}
                    />
                )}
            </main>
            <SiteFooter />
        </div>
    )
}
