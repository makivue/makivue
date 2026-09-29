import { describe, expect, it } from 'vitest'
import { getNanoBananaImageSize } from './image-quality'
import {
    GEMINI_FLASH_TEXT_MODEL,
    GEMINI_FLASH_TEXT_MODEL_ID,
    LEGACY_GEMINI_FLASH_LITE_TEXT_MODEL_ID,
    LEGACY_GEMINI_FLASH_TEXT_MODEL_ID,
    LEGACY_GEMINI_PRO_TEXT_MODEL_ID,
    NANO_BANANA_IMAGE_MODEL,
    NANO_BANANA_VISION_MODEL,
    REMOVED_GEMINI_36_FLASH_TEXT_MODEL_ID,
    REMOVED_GEMINI_FLASH_LITE_TEXT_MODEL_ID
} from './gemini-models'

describe('current Gemini model configuration', () => {
    it('uses the configured image and internal vision-inspection models', () => {
        expect(NANO_BANANA_IMAGE_MODEL).toBe('gemini-3.1-flash-image')
        expect(NANO_BANANA_VISION_MODEL).toBe('gemini-2.5-pro')
    })

    it('exposes only current Vertex AI text model IDs', () => {
        expect(GEMINI_FLASH_TEXT_MODEL).toBe('gemini-3.7-flash')
        expect(GEMINI_FLASH_TEXT_MODEL_ID).toBe('gemini:gemini-3.7-flash')
        expect(LEGACY_GEMINI_FLASH_TEXT_MODEL_ID).toBe('gemini:gemini-3.5-flash')
        expect(LEGACY_GEMINI_PRO_TEXT_MODEL_ID).toBe('gemini:gemini-3.1-pro-preview')
        expect(LEGACY_GEMINI_FLASH_LITE_TEXT_MODEL_ID).toBe('gemini:gemini-3.1-flash-lite-preview')
        expect(REMOVED_GEMINI_36_FLASH_TEXT_MODEL_ID).toBe('gemini:gemini-3.6-flash')
        expect(REMOVED_GEMINI_FLASH_LITE_TEXT_MODEL_ID).toBe('gemini:gemini-3.1-flash-lite')
    })

    it.each([
        ['standard', '1K'],
        ['clear', '2K'],
        ['ultra', '4K']
    ] as const)('maps %s image quality to %s', (quality, expected) => {
        expect(getNanoBananaImageSize(quality)).toBe(expected)
    })
})
