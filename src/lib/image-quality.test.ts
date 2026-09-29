import { describe, expect, it } from 'vitest'
import { getImageResolutionDetail, getImageResolutionLabel, getQwenImageSize } from './image-quality'

describe('image quality resolution labels', () => {
    it('maps Nano Banana quality levels to requested image sizes', () => {
        expect(getImageResolutionLabel('banana', 'standard')).toBe('1K')
        expect(getImageResolutionLabel('banana', 'clear')).toBe('2K')
        expect(getImageResolutionLabel('banana', 'ultra')).toBe('4K')
    })

    it('maps Qwen quality levels to distinct dimensions within the official pixel-area limits', () => {
        expect(getImageResolutionLabel('qwen-image-3.0-pro', 'standard')).toBe('1K')
        expect(getImageResolutionLabel('qwen-image-3.0-pro', 'clear')).toBe('1.5K')
        expect(getImageResolutionLabel('qwen-image-3.0-pro', 'ultra')).toBe('2K')
        expect(getQwenImageSize('standard', '16:9')).toBe('1344*768')
        expect(getQwenImageSize('clear', '16:9')).toBe('2048*1152')
        expect(getQwenImageSize('ultra', '16:9')).toBe('2688*1536')
        expect(getImageResolutionDetail('qwen-image-3.0-pro', 'clear')).toContain('9:16 1152×2048')
        expect(getImageResolutionDetail('qwen-image-3.0-pro', 'ultra')).toContain('1:1 2048×2048')
    })

    it('keeps every Qwen size inside the official area and aspect-ratio limits', () => {
        const ratios = {
            '1:1': 1,
            '16:9': 16 / 9,
            '9:16': 9 / 16,
            '4:3': 4 / 3,
            '3:4': 3 / 4
        } as const

        for (const quality of ['standard', 'clear', 'ultra'] as const) {
            for (const [ratio, expectedRatio] of Object.entries(ratios)) {
                const [width, height] = getQwenImageSize(quality, ratio as keyof typeof ratios)
                    .split('*')
                    .map(Number)
                expect(width * height).toBeGreaterThanOrEqual(512 * 512)
                expect(width * height).toBeLessThanOrEqual(2048 * 2048)
                expect(width / height).toBeCloseTo(expectedRatio, 1)
            }
        }
    })

    it('uses each Himodels image model capability for its displayed resolution', () => {
        expect(getImageResolutionLabel('gemini-3.1-flash-image', 'ultra')).toBe('4K')
        expect(getImageResolutionLabel('seedream-5-0-lite', 'standard')).toBe('2K')
        expect(getImageResolutionDetail('seedream-5-0-lite', 'standard')).toContain('Seedream 5.0 Lite')
        expect(getImageResolutionDetail('seedream-5-0-lite', 'standard')).not.toContain('seedream-5-0-lite')
    })
})
