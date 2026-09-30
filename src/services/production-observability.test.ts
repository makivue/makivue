import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
    findEvents: vi.fn(),
    findReviews: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        productionEvent: { findMany: prismaMocks.findEvents },
        qualityReview: { findMany: prismaMocks.findReviews }
    }
}))

import { classifyGenerationError } from './production-observability'

beforeEach(() => {
    prismaMocks.findEvents.mockReset()
    prismaMocks.findReviews.mockReset()
})

describe('classifyGenerationError', () => {
    it.each([
        ['429 rate limit exceeded', 'rate_limited'],
        ['polling timeout (18 min)', 'timeout'],
        ['API key not configured', 'authentication'],
        ['content safety policy rejected', 'content_policy'],
        ['InputImageSensitiveContentDetected.PrivacyInformation: input image may contain real person', 'content_policy'],
        ['You have no right to access this object because of bucket acl.', 'storage_permission'],
        ['视频台词自动转换为English失败：translation was empty', 'translation'],
        ['local storage upload failed', 'transport'],
        ['invalid JSON response', 'invalid_response'],
        ['No video URL returned', 'transport'],
        ['用户手动停止', 'cancelled']
    ])('maps %s to %s', (message, code) => {
        expect(classifyGenerationError(message)).toBe(code)
    })

    it('keeps unknown failures measurable', () => {
        expect(classifyGenerationError('provider exploded')).toBe('upstream_or_unknown')
        expect(classifyGenerationError(null)).toBeNull()
    })
})
