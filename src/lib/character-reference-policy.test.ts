import { describe, expect, it } from 'vitest'
import { getVisualStyle } from './novel'
import {
    adaptCharacterReferenceStylePrompt,
    CHARACTER_REFERENCE_PROMPT_VERSION,
    getCharacterBeautyPrompt,
    isLiveActionHumanStyle,
    LEGACY_BEAUTY_PREFIX,
    LIVE_ACTION_ANTI_WAX_NEGATIVE,
    resolveCharacterReferencePolicy
} from './character-reference-policy'

describe('character reference policy', () => {
    it('keeps the selected live-action provider and replaces the legacy beauty anchor', () => {
        const style = getVisualStyle('cinematic')
        const policy = resolveCharacterReferencePolicy(style, 'banana')

        expect(style.imagePromptPrefix).toContain('realistic skin texture with visible pores')
        expect(style.imagePromptPrefix).not.toContain(LEGACY_BEAUTY_PREFIX)
        expect(policy.provider).toBe('banana')
        expect(policy.promptVersion).toBe(CHARACTER_REFERENCE_PROMPT_VERSION)
        expect(policy.stylePromptPrefix).toContain('realistic skin texture with visible pores')
        expect(policy.stylePromptPrefix).not.toContain(LEGACY_BEAUTY_PREFIX)
        expect(policy.negativePrompt).toBe(LIVE_ACTION_ANTI_WAX_NEGATIVE)
    })

    it('keeps the selected provider for expanded live-action presets', () => {
        const style = getVisualStyle('modern-war')
        expect(isLiveActionHumanStyle(style)).toBe(true)
        expect(resolveCharacterReferencePolicy(style, 'gemini-3.1-flash-image').provider).toBe('gemini-3.1-flash-image')
    })

    it.each(['anime', 'cn-3d', 'watercolor'])('keeps the configured provider and legacy anchor for %s', key => {
        const policy = resolveCharacterReferencePolicy(getVisualStyle(key), 'banana')

        expect(policy.liveAction).toBe(false)
        expect(policy.provider).toBe('banana')
        expect(policy.stylePromptPrefix).toContain(LEGACY_BEAUTY_PREFIX)
        expect(policy.negativePrompt).toBe('')
    })

    it('uses natural gender-specific live-action casting anchors without idol language', () => {
        const female = getCharacterBeautyPrompt('女', true, false)
        const male = getCharacterBeautyPrompt('男', true, false)

        for (const prompt of [female, male]) {
            expect(prompt).toContain('realistic skin texture with visible pores')
            expect(prompt).toContain('natural facial asymmetry')
            expect(prompt).not.toContain('idol-grade')
        }
        expect(female).toContain('subtle natural makeup')
        expect(male).toContain('natural grooming')
    })

    it('replaces live-action human casting anchors for an animal identity', () => {
        const policy = resolveCharacterReferencePolicy(getVisualStyle('cinematic'), 'gemini-3.1-flash-image')
        const prompt = adaptCharacterReferenceStylePrompt(policy.stylePromptPrefix, policy.liveAction, true)
        const presentation = getCharacterBeautyPrompt('男', policy.liveAction, true)

        for (const value of [prompt, presentation]) {
            expect(value).toContain('photorealistic natural-history wildlife character design')
            expect(value).toContain('species-accurate head and body anatomy')
            expect(value).toContain('no human anatomy')
            expect(value).not.toContain('adult man')
            expect(value).not.toContain('live-action short drama casting')
            expect(value).not.toContain('skin texture with visible pores')
        }
    })
})
