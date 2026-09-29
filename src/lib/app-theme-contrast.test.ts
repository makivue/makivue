import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_THEMES } from './app-theme'

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
type RGB = [number, number, number]
function rgb(hex: string): RGB {
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) as RGB
}
function mix(a: RGB, b: RGB, fraction: number): RGB {
    return a.map((channel, index) => channel * fraction + b[index] * (1 - fraction)) as RGB
}
function luminance(color: RGB) {
    const channels = color.map(channel => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function contrast(a: RGB, b: RGB) {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left)
    return (lighter + 0.05) / (darker + 0.05)
}

describe('all theme action and status contrast', () => {
    for (const theme of APP_THEMES) {
        const block = css.match(new RegExp(`html\\[data-app-theme='${theme.id}'\\]\\s*\\{([^}]+)\\}`))![1]
        const color = (name: string) => rgb(block.match(new RegExp(`--home-${name}:\\s*(#[a-fA-F0-9]{6})`))![1])

        it(`${theme.id}: action labels remain readable across the entire gradient and hover`, () => {
            const text = color('on-action')
            for (let step = 0; step <= 20; step++) {
                const fill = mix(color('action'), color('action-2'), step / 20)
                // Include the brightest hover treatment used by our play buttons.
                for (const brightness of [1, 1.1]) {
                    const hovered = fill.map(channel => Math.min(255, channel * brightness)) as RGB
                    expect(contrast(text, hovered)).toBeGreaterThanOrEqual(4.5)
                }
            }
        })

        it(`${theme.id}: busy labels and production/completed badges retain normal-text contrast`, () => {
            const surface = color('panel-solid')
            expect(contrast(color('text'), mix(color('accent'), surface, 0.12))).toBeGreaterThanOrEqual(4.5)
            expect(contrast(color('accent'), mix(color('accent'), surface, 0.1))).toBeGreaterThanOrEqual(4.5)
            expect(contrast(color('success'), mix(color('success'), surface, 0.12))).toBeGreaterThanOrEqual(4.5)
        })
    }

    it('semantic action labels retain contrast in every theme, including hover', () => {
        const text = rgb(css.match(/--app-on-semantic-action:\s*(#[a-fA-F0-9]{6})/)![1])
        for (const name of ['danger', 'warning', 'success']) {
            const fill = rgb(css.match(new RegExp(`--app-action-${name}:\\s*(#[a-fA-F0-9]{6})`))![1])
            const hovered = fill.map(channel => Math.min(255, channel * 1.08)) as RGB
            expect(contrast(text, hovered)).toBeGreaterThanOrEqual(4.5)
        }
    })

    it('text selection uses the theme foreground on its translucent surface', () => {
        const selection = css.match(/:is\(\.studio-theme, \.studio-workspace\) ::selection\s*\{([^}]+)\}/)![1]
        expect(selection).toContain('color: var(--app-text)')
    })
})
