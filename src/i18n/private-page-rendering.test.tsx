import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { locales, localizePath, type Locale } from './config'
import { translateMessage } from './catalog'
import ProfilePage from '@/app/profile/page'
import SettingsPage from '@/app/settings/page'
import WalletPage from '@/app/wallet/page'
import WalletTransactionsPage from '@/app/wallet/transactions/page'
import CustomSelect from '@/components/CustomSelect'

let activeLocale: Locale = 'en'

vi.mock('@/i18n/I18nProvider', () => ({
    useI18n: () => ({ locale: activeLocale, t: (source: string) => translateMessage(activeLocale, source), href: (path: string) => localizePath(path, activeLocale) })
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/AuthBar', () => ({ default: () => null }))
vi.mock('@/components/SiteFooter', () => ({ default: () => null }))

const pages = [
    { name: 'profile', component: ProfilePage, title: '个人中心' },
    { name: 'settings', component: SettingsPage, title: '生成设置' },
    { name: 'wallet', component: WalletPage, title: '积分与充值' },
    { name: 'transactions', component: WalletTransactionsPage, title: '账户流水' }
]

describe('private page first-render localization', () => {
    it.each(locales)('renders localized page shells before browser hydration in %s', locale => {
        activeLocale = locale
        for (const page of pages) {
            const html = renderToStaticMarkup(createElement(page.component))
            const text = html.replace(/<[^>]*>/g, ' ')
            const expectedTitle = renderToStaticMarkup(createElement('span', null, translateMessage(locale, page.title))).replace(/<[^>]*>/g, '')
            expect(text, page.name).toContain(expectedTitle)
            if (locale !== 'zh' && locale !== 'ja') expect(html, page.name).not.toMatch(/\p{Script=Han}/u)
        }
    })

    it.each(locales)('localizes an empty selector and its accessible label in %s', locale => {
        activeLocale = locale
        const html = renderToStaticMarkup(createElement(CustomSelect, { value: '', options: [], onChange: () => {}, ariaLabel: '国家或地区' }))
        expect(html).toContain(translateMessage(locale, '请选择'))
        expect(html).toContain(translateMessage(locale, '国家或地区'))
    })
})
