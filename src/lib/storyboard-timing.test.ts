import { describe, expect, it } from 'vitest'
import { normalizeStoryboardDuration, recommendStoryboardDuration } from './storyboard-timing'

describe('content-aware storyboard timing', () => {
    it('keeps short reactions short and gives long coherent dialogue more time', () => {
        expect(recommendStoryboardDuration({ shotType: 'close-up', actionDesc: '她抬眼，轻轻皱眉。' }, 30)).toBeLessThanOrEqual(6)
        expect(recommendStoryboardDuration({ shotType: 'close-up', dialogue: `角色：${'这是一段需要自然说完的台词'.repeat(8)}` }, 30)).toBeGreaterThan(15)
    })

    it('respects the selected provider maximum', () => {
        const longDialogue = { dialogue: `角色：${'这是一段需要自然说完的台词'.repeat(10)}` }
        expect(recommendStoryboardDuration(longDialogue, 30)).toBe(30)
        expect(recommendStoryboardDuration(longDialogue, 15)).toBe(15)
        expect(normalizeStoryboardDuration(30, longDialogue, 15)).toBe(15)
    })
})
