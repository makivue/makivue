import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { locales, type Locale } from '@/i18n/config'
import { translateMessage } from '@/i18n/catalog'
import { APP_THEMES } from '@/lib/app-theme'
import GlobalPreferences from './GlobalPreferences'

let activeLocale: Locale = 'en'

vi.mock('@/i18n/I18nProvider', () => ({
    useI18n: () => ({ locale: activeLocale, t: (source: string) => translateMessage(activeLocale, source), setLocale: vi.fn() })
}))

describe('unified language and appearance panel', () => {
    it('keeps the panel and options compact without dropping either settings group', () => {
        const html = renderToStaticMarkup(createElement(GlobalPreferences))
        expect(html).toContain('w-[min(20rem,calc(100vw-2rem))]')
        expect(html).toContain('rounded-xl border p-3')
        expect(html.match(/global-preferences-language flex min-h-8/g)).toHaveLength(locales.length)
        expect(html.match(/global-theme-option flex min-h-11/g)).toHaveLength(APP_THEMES.length)
        expect(html).not.toContain('min-h-16')
        expect(html).not.toContain('<h2')
        expect(html).toContain('global-theme-close absolute end-3 top-3')
        expect(html).toContain('min-h-7 items-center gap-1.5 pe-9')
    })

    it.each(locales)('renders one localized entry and two keyboard-accessible groups in %s', locale => {
        activeLocale = locale
        const html = renderToStaticMarkup(createElement(GlobalPreferences))
        expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(1)
        expect(html.match(/role="dialog"/g)).toHaveLength(1)
        expect(html.match(/<fieldset/g)).toHaveLength(2)
        expect(html.match(/type="radio"/g)).toHaveLength(locales.length + APP_THEMES.length)
        expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(2)
        expect(html).toContain(`checked="" value="${locale}"`)
        expect(html).toContain('checked="" value="aurora"')
        expect(html).toContain('popover="auto"')
        expect(html).toContain('popoverTargetAction="hide"')
        for (const message of ['语言与外观', '选择语言', '主题设置']) {
            const escaped = renderToStaticMarkup(createElement('span', null, translateMessage(locale, message))).replace(/<[^>]*>/g, '')
            expect(html).toContain(escaped)
            if (message === '语言与外观') {
                expect(html).toContain(`role="dialog" aria-label="${escaped}"`)
                expect(html.replace(/<[^>]*>/g, '')).not.toContain(escaped)
            }
        }
        if (locale !== 'zh' && locale !== 'ja') expect(html).not.toMatch(/\p{Script=Han}/u)
    })
})
