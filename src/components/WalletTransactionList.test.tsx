import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import WalletTransactionList, { type WalletTransactionItem } from './WalletTransactionList'
import { localizePath } from '@/i18n/config'

vi.mock('@/i18n/I18nProvider', () => ({ useI18n: () => ({ locale: 'zh', href: (path: string) => localizePath(path, 'zh') }) }))
const transaction: WalletTransactionItem = {
    id: '1',
    type: 'usage',
    sourceType: 'generation',
    sourceId: '50',
    amountPoints: -40,
    balanceAfterPoints: 100,
    status: 'completed',
    description: null,
    createdAt: '2026-09-18T00:00:00.000Z'
}

describe('wallet usage links', () => {
    it('links to the resolved destination with the current locale and shot anchor', () => {
        const html = renderToStaticMarkup(createElement(WalletTransactionList, { transactions: [{ ...transaction, destinationPath: '/projects/10/episodes/20#shot-30' }] }))
        expect(html).toContain('href="/zh/projects/10/episodes/20#shot-30"')
        expect(html).not.toContain('tab=storyboard')
    })
    it('keeps the ledger visible without an invented link when the source is unavailable', () => {
        const html = renderToStaticMarkup(createElement(WalletTransactionList, { transactions: [transaction] }))
        expect(html).toContain('-40')
        expect(html).not.toContain('href=')
    })
})
