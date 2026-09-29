import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translateMessage } from '@/i18n/catalog'
import LocalizedContent from './LocalizedContent'

vi.mock('@/i18n/I18nProvider', () => ({ useI18n: () => ({ t: (source: string) => translateMessage('en', source) }) }))

describe('localized JSX content boundaries', () => {
    it('preserves authored content and explicitly untranslated elements', () => {
        const html = renderToStaticMarkup(
            <LocalizedContent>
                <div>
                    <p
                        data-i18n-skip
                        title="关闭">
                        开始创作
                    </p>
                    <p translate="no">开始创作</p>
                    <button data-i18n-skip={undefined}>关闭</button>
                </div>
            </LocalizedContent>
        )
        expect(html).toContain('title="关闭">开始创作</p>')
        expect(html).toContain('translate="no">开始创作</p>')
        expect(html).toContain('<button>Close</button>')
    })

    it('keeps protected attributes while translating the surrounding controls', () => {
        const html = renderToStaticMarkup(
            <LocalizedContent>
                <div
                    data-i18n-skip-attributes
                    title="开始创作">
                    <button>关闭</button>
                </div>
            </LocalizedContent>
        )
        expect(html).toContain('title="开始创作"')
        expect(html).toContain('<button>Close</button>')
    })

    it('never translates script, style or textarea values', () => {
        const html = renderToStaticMarkup(
            <LocalizedContent>
                <div>
                    <script type="application/json">{'开始创作'}</script>
                    <style>{'开始创作'}</style>
                    <textarea
                        placeholder="开始创作"
                        defaultValue="关闭"
                    />
                </div>
            </LocalizedContent>
        )
        expect(html).toContain('<script type="application/json">开始创作</script>')
        expect(html).toContain('<style>开始创作</style>')
        expect(html).toContain(`<textarea placeholder="${translateMessage('en', '开始创作')}">关闭</textarea>`)
    })
})
