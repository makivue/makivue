import { describe, expect, it } from 'vitest'
import { hasRequiredReferenceFrames, minimumReferenceImageCount } from './video-timeline-plan'

describe('video timeline planning', () => {
    it('requires distinct opening and ending frames for first-last generation', () => {
        expect(minimumReferenceImageCount('first_last')).toBe(2)
        expect(hasRequiredReferenceFrames('first_last', { firstFrameUrl: '/first.png' })).toBe(false)
        expect(hasRequiredReferenceFrames('first_last', { firstFrameUrl: '/same.png', plannedLastFrameUrl: '/same.png' })).toBe(false)
        expect(hasRequiredReferenceFrames('first_last', { firstFrameUrl: '/first.png', plannedLastFrameUrl: '/last.png' })).toBe(true)
    })
})
