import { describe, expect, it } from 'vitest'
import { storyboardGenerationEndpoint } from './storyboard-generation-endpoint'

describe('storyboard generation endpoints', () => {
    it('keeps image and video generation on separate resource endpoints', () => {
        expect(storyboardGenerationEndpoint('42', 'illustrations')).toBe('/api/storyboards/42/images/generate')
        expect(storyboardGenerationEndpoint('42', 'first_frame')).toBe('/api/storyboards/42/images/generate')
        expect(storyboardGenerationEndpoint('42', 'video')).toBe('/api/storyboards/42/video/generate')
    })
})
