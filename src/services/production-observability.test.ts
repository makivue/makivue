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

import { classifyGenerationError, getVideoProviderRoutingFeedback } from './production-observability'

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

describe('getVideoProviderRoutingFeedback', () => {
    it('aggregates terminal provider events and generation-linked quality scores', async () => {
        prismaMocks.findEvents.mockResolvedValue([
            { provider: 'wanx', status: 'completed', durationMs: 40_000, costUsd: 0.2, storyboardId: 11n, generationId: 101n },
            { provider: 'wanx', status: 'failed', durationMs: 20_000, costUsd: 0.1, storyboardId: 12n, generationId: 102n }
        ])
        prismaMocks.findReviews.mockResolvedValue([{ storyboardId: 11n, generationId: 101n, score: 92 }])

        const result = await getVideoProviderRoutingFeedback(30)
        expect(result.providers.wanx).toEqual({
            attempts: 2,
            successRate: 0.5,
            averageDurationMs: 30_000,
            averageCostUsd: 0.15,
            averageQualityScore: 92
        })
    })

    it('falls back to rule-only routing when feedback storage is unavailable', async () => {
        prismaMocks.findEvents.mockRejectedValue(new Error('telemetry unavailable'))
        prismaMocks.findReviews.mockResolvedValue([])
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(getVideoProviderRoutingFeedback()).resolves.toMatchObject({ windowDays: 30, providers: {} })
        expect(warning).toHaveBeenCalledOnce()
        warning.mockRestore()
    })
})
