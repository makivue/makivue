import { describe, expect, it } from 'vitest'
import { STYLE_GROUPS } from './drama-creation'
import { getVisualStyle, getVisualStyleProfile, VISUAL_STYLE_PRESETS } from './novel'
import { matchesStyleReferenceCategory, STYLE_REFERENCE_CATEGORIES } from './style-reference-categories'

describe('creative reference discovery', () => {
    it('keeps each preset in exactly one visual group and every reference points to a real preset', () => {
        const keys = VISUAL_STYLE_PRESETS.map(style => style.key)
        const grouped = STYLE_GROUPS.flatMap(group => group.styles)
        expect(grouped.toSorted()).toEqual(keys.toSorted())
        for (const category of STYLE_REFERENCE_CATEGORIES) {
            expect(category.styles.length).toBeGreaterThan(0)
            for (const key of category.styles) expect(keys).toContain(key)
        }
    })

    it('allows one reference to appear in several useful creative categories', () => {
        expect(matchesStyleReferenceCategory('photoreal-pet-drama', 'daily-comedy')).toBe(true)
        expect(matchesStyleReferenceCategory('photoreal-pet-drama', 'nature-pets')).toBe(true)
        expect(matchesStyleReferenceCategory('ancient-indian-war', 'history-war')).toBe(true)
        expect(matchesStyleReferenceCategory('ancient-indian-war', 'commercial')).toBe(false)
        expect(matchesStyleReferenceCategory('pixel-art', 'all')).toBe(true)
    })

    it('preserves deliberate pixel/VHS texture and avoids human skin directions in object-led references', () => {
        const pixel = getVisualStyleProfile('pixel-art')
        expect(pixel.videoPromptPrefix).toContain('pixel grid')
        expect(pixel.colorPalette.prompt).toContain('limited')
        const analog = getVisualStyleProfile('analog-horror')
        expect(analog.texture.prompt).toContain('CRT scanlines')
        expect(analog.negativePrompt).not.toContain('unintended live action')
        expect(getVisualStyleProfile('found-footage').negativePrompt).not.toContain('unintended live action')
        for (const key of ['surreal-asmr', 'cooking-macro', 'product-commercial', 'architecture-tour', 'photoreal-pet-drama']) {
            const profile = getVisualStyleProfile(key)
            expect(profile.imagePromptPrefix).not.toContain('skin pores')
            expect(profile.artDirection.prompt).not.toContain('idol-grade')
            expect(getVisualStyle(key).previewPrompt).toMatch(/no (?:people|humans)/)
        }
    })

    it('distinguishes hand-drawn rubber-hose cartoons from three-dimensional family animation', () => {
        const rubber = getVisualStyleProfile('retro-rubber-hose')
        expect(rubber.rendering.prompt).toContain('hand-drawn 2D')
        expect(rubber.rendering.prompt).not.toContain('polished stylized 3D')
        expect(rubber.colorPalette.prompt).toContain('no color accents')
        expect(getVisualStyleProfile('modern-family-animation').linework.prompt).toContain('no drawn outlines')
    })
})
