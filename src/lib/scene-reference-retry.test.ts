import { describe, expect, it } from 'vitest'
import { SCENE_REFERENCE_NEGATIVE, SCENE_SINGLE_IMAGE_LOCK, sanitizeSceneReferenceLocationPrompt } from './scene-reference-retry'

describe('scene reference quality retry', () => {
    it('locks references to one empty coherent environment image', () => {
        expect(SCENE_SINGLE_IMAGE_LOCK).toContain('ONE single uninterrupted environment image')
        expect(SCENE_SINGLE_IMAGE_LOCK).toContain('zero people')
        expect(SCENE_SINGLE_IMAGE_LOCK).toContain('every street, platform, seat, stand and interior is visibly vacant')
        expect(SCENE_REFERENCE_NEGATIVE).toContain('multi-panel layout')
        expect(SCENE_REFERENCE_NEGATIVE).toContain('human-shaped chess piece')
    })

    it('removes occupancy cues from an arena location while preserving its architecture', () => {
        const prompt = sanitizeSceneReferenceLocationPrompt('massive floating arena, multi-level floating spectator stands glowing with banners, open-air flight zone')

        expect(prompt).toContain('massive floating arena')
        expect(prompt).toContain('completely vacant seating tiers')
        expect(prompt).not.toMatch(/spectator/i)
    })

    it('turns humanoid chess set dressing into abstract environment geometry', () => {
        const prompt = sanitizeSceneReferenceLocationPrompt(
            'gigantic chessboard battlefield, towering titanium combat knight mechas, queen annihilation artillery units, black and white glowing grid tiles'
        )

        expect(prompt).toContain('gigantic chessboard battlefield')
        expect(prompt).toContain('abstract chess-piece')
        expect(prompt).toContain('abstract non-humanoid structures')
        expect(prompt).not.toMatch(/\b(?:knight|queen|mecha)\b/i)
    })
})
