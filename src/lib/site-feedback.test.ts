import { describe, expect, it } from 'vitest'
import { feedbackFileIssue, feedbackQuota, feedbackSourcePath } from './site-feedback'

describe('feedback rolling quota', () => {
    it('enforces the minute boundary to the millisecond', () => {
        expect(feedbackQuota([], 0).allowed).toBe(true)
        expect(feedbackQuota([0], 59_999)).toMatchObject({ allowed: false, retryAfterSeconds: 1 })
        expect(feedbackQuota([0], 60_000).allowed).toBe(true)
    })

    it('allows five spaced submissions, then waits for the oldest to leave the rolling window', () => {
        const history: number[] = []
        for (let i = 0; i < 5; i++) {
            expect(feedbackQuota(history, i * 60_000).allowed).toBe(true)
            history.push(i * 60_000)
        }
        expect(feedbackQuota(history, 300_000)).toMatchObject({ allowed: false, retryAfterSeconds: 300 })
        expect(feedbackQuota(history, 599_999)).toMatchObject({ allowed: false, retryAfterSeconds: 1 })
        expect(feedbackQuota(history, 600_000)).toMatchObject({ allowed: true, timestamps: history.slice(1) })
        // This crosses a wall-clock 10-minute boundary without resetting the quota.
        expect(
            feedbackQuota(
                history.map(t => t + 599_000),
                899_000
            ).allowed
        ).toBe(false)
    })

    it('uses the larger wait when both limits apply, regardless of input order', () => {
        expect(feedbackQuota([240_000, 0, 60_000, 180_000, 120_000], 240_000).retryAfterSeconds).toBe(360)
    })
})

describe('feedback attachments and source', () => {
    it('accepts supported images and videos at their size limits', () => {
        expect(feedbackFileIssue({ name: 'a.PNG', type: '', size: 10 * 1024 ** 2 })).toBeNull()
        expect(feedbackFileIssue({ name: 'a.mp4', type: 'video/mp4', size: 50 * 1024 ** 2 })).toBeNull()
    })
    it.each([
        { name: 'a.svg', type: 'image/svg+xml', size: 1 },
        { name: 'a.png', type: 'text/html', size: 1 },
        { name: 'a.jpg', type: 'image/jpeg', size: 10 * 1024 ** 2 + 1 },
        { name: 'a.mp4', type: 'video/mp4', size: 50 * 1024 ** 2 + 1 },
        { name: 'a.gif', type: 'image/gif', size: 0 }
    ])('rejects invalid file %j', file => expect(feedbackFileIssue(file)).not.toBeNull())

    it('removes query parameters and does not accept external source URLs', () => {
        expect(feedbackSourcePath('/zh/projects/123?token=private#hash')).toBe('/zh/projects/123')
        for (const value of [undefined, 'https://example.com/', '//example.com/', 'x'.repeat(1025)]) expect(feedbackSourcePath(value)).toBe('/')
    })
})
