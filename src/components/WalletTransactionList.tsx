'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { formatPointAmount } from '@/lib/points'

export type WalletTransactionItem = {
    id: string
    type: string
    amountPoints: number
    balanceAfterPoints: number
    status: string
    sourceType: string | null
    sourceId: string | null
    destinationPath?: string | null
    description: string | null
    createdAt: string
}

function transactionLabel(type: string) {
    if (type === 'recharge') return '积分充值'
    if (type === 'usage') return '内容生成消费'
    if (type === 'refund') return '费用退回'
    return '账户调整'
}

export default function WalletTransactionList({ transactions, emptyMessage = '暂无账户流水' }: { transactions: WalletTransactionItem[]; emptyMessage?: string }) {
    const { href, locale } = useI18n()

    if (!transactions.length) return <div className="px-5 py-12 text-center text-sm text-slate-600">{emptyMessage}</div>

    return (
        <div className="divide-y divide-white/[0.05]">
            {transactions.map(transaction => (
                <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-slate-200">
                                {transaction.type === 'recharge' ? transactionLabel(transaction.type) : transaction.description || transactionLabel(transaction.type)}
                            </span>
                            {transaction.type === 'usage' && transaction.destinationPath ? (
                                <Link
                                    href={href(transaction.destinationPath)}
                                    className="shrink-0 text-xs text-violet-400 hover:text-violet-300">
                                    <ExternalLink className="inline h-3 w-3" /> 查看
                                </Link>
                            ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-600">
                            <span data-i18n-skip>{new Date(transaction.createdAt).toLocaleString(locale)}</span>
                            <span>·</span>
                            <span>剩余积分</span>
                            <span data-i18n-skip>{formatPointAmount(transaction.balanceAfterPoints, locale)}</span>
                        </div>
                    </div>
                    <div className={`flex shrink-0 items-baseline gap-1 text-sm font-semibold ${transaction.amountPoints >= 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                        <span data-i18n-skip>
                            {transaction.amountPoints >= 0 ? '+' : ''}
                            {formatPointAmount(transaction.amountPoints, locale)}
                        </span>
                        <span className="text-xs">积分</span>
                    </div>
                </div>
            ))}
        </div>
    )
}
