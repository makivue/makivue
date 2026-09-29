import { describe, expect, it } from 'vitest'
import { shouldGenerateEpisodeStoryboards } from './storyboard-batch-selection'

describe('storyboard batch selection', () => {
    it('never includes an episode with existing storyboards in missing mode even when status is stale', () => {
        expect(shouldGenerateEpisodeStoryboards({ status: 'scripted', _count: { storyboards: 8 } }, 'missing')).toBe(false)
        expect(shouldGenerateEpisodeStoryboards({ status: 'storyboarded', _count: { storyboards: 8 } }, 'missing')).toBe(false)
    })

    it('includes only script-ready episodes with zero storyboards in missing mode', () => {
        expect(shouldGenerateEpisodeStoryboards({ status: 'scripted', _count: { storyboards: 0 } }, 'missing')).toBe(true)
        expect(shouldGenerateEpisodeStoryboards({ status: 'draft', _count: { storyboards: 0 } }, 'missing')).toBe(false)
    })

    it('allows explicit all mode to include script-ready episodes with existing storyboards', () => {
        expect(shouldGenerateEpisodeStoryboards({ status: 'storyboarded', _count: { storyboards: 8 } }, 'all')).toBe(true)
    })
})
