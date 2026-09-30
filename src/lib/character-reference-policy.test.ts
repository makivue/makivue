import { describe, expect, it } from 'vitest'
import { isLiveActionHumanStyle } from './character-reference-policy'
import { getVisualStyle } from './novel'

describe('visual style classification', () => {
    it('distinguishes live action from illustrated styles', () => {
        expect(isLiveActionHumanStyle(getVisualStyle('anime'))).toBe(false)
        expect(isLiveActionHumanStyle({ key: 'live', label: 'Live action', hint: '', imagePromptPrefix: 'photorealistic portrait', videoPromptPrefix: '' })).toBe(true)
    })
})
