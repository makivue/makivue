import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ScriptRuntimeNotice from './ScriptRuntimeNotice'

vi.mock('@/i18n/I18nProvider', () => ({
    useI18n: () => ({ t: (source: string, values: Record<string, unknown> = {}) => source.replace(/\{(\w+)\}/g, (_, key) => String(values[key])) })
}))

describe('ScriptRuntimeNotice', () => {
    const script = (seconds: number) => `Amara: ${'word '.repeat(Math.round(seconds * 2.6))}`

    it.each([20, 194.5])('shows a non-blocking estimate for %s seconds', seconds => {
        const html = renderToStaticMarkup(
            <ScriptRuntimeNotice
                script={script(seconds)}
                episodeFormat="micro"
            />
        )
        expect(html).toContain('role="status"')
        expect(html).toContain('60–120')
        expect(html).toContain('不影响继续生成')
        expect(html).not.toContain('role="alert"')
    })

    it('hides the notice for empty or in-range scripts, including the existing tolerance', () => {
        for (const value of ['', '   ', script(45), script(90), script(144)]) {
            expect(
                renderToStaticMarkup(
                    <ScriptRuntimeNotice
                        script={value}
                        episodeFormat="micro"
                    />
                )
            ).toBe('')
        }
    })

    it('uses the selected episode format rather than always applying micro limits', () => {
        expect(
            renderToStaticMarkup(
                <ScriptRuntimeNotice
                    script={script(360)}
                    episodeFormat="short"
                />
            )
        ).toBe('')
        expect(
            renderToStaticMarkup(
                <ScriptRuntimeNotice
                    script={script(1200)}
                    episodeFormat="long"
                />
            )
        ).toBe('')
    })
})
