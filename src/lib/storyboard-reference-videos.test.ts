import { describe, expect, it } from 'vitest'
import {
    formatReferenceVideoDurationViolation,
    getReferenceVideoDurationViolation,
    MAX_REFERENCE_VIDEO_BYTES,
    MAX_STORYBOARD_REFERENCE_VIDEOS,
    parseStoryboardReferenceVideos,
    resolveReferenceVideoMimeType,
    totalReferenceVideoDuration
} from './storyboard-reference-videos'

describe('storyboard reference videos', () => {
    it('limits each reference video to 300 MiB', () => {
        expect(MAX_REFERENCE_VIDEO_BYTES).toBe(300 * 1024 * 1024)
    })

    it('keeps only valid unique assets and enforces the storyboard limit', () => {
        const valid = Array.from({ length: 4 }, (_, index) => ({
            id: `video-${index}`,
            url: `https://cdn.test/video-${index}.mp4`,
            name: `video-${index}.mp4`,
            mimeType: 'video/mp4',
            sizeBytes: 1024,
            durationSeconds: index + 1,
            createdAt: '2026-09-16T00:00:00.000Z'
        }))
        const parsed = parseStoryboardReferenceVideos([null, { ...valid[0], url: '/local.mp4' }, ...valid, valid[0]])
        expect(parsed).toHaveLength(MAX_STORYBOARD_REFERENCE_VIDEOS)
        expect(parsed.map(video => video.id)).toEqual(['video-0', 'video-1', 'video-2'])
        expect(totalReferenceVideoDuration(parsed)).toBe(6)
    })

    it('accepts browser files that provide a useful extension but no MIME type', () => {
        expect(resolveReferenceVideoMimeType('', 'reference.MOV')).toBe('video/quicktime')
        expect(resolveReferenceVideoMimeType('application/octet-stream', 'reference.webm')).toBe('video/webm')
        expect(resolveReferenceVideoMimeType('', 'reference.avi')).toBeNull()
    })

    it('reports individual and aggregate duration violations', () => {
        const rule = { min: 2, max: 15, totalMax: 15 }
        expect(getReferenceVideoDurationViolation([{ name: 'short.mp4', durationSeconds: 1.9 }], rule)).toMatchObject({ kind: 'too_short', limit: 2 })
        expect(getReferenceVideoDurationViolation([{ name: 'long.mp4', durationSeconds: 15.1 }], rule)).toMatchObject({ kind: 'too_long', limit: 15 })
        const aggregateViolation = getReferenceVideoDurationViolation(
            [
                { name: 'one.mp4', durationSeconds: 8 },
                { name: 'two.mp4', durationSeconds: 8 }
            ],
            rule
        )
        expect(aggregateViolation).toMatchObject({ kind: 'total_too_long', limit: 15, total: 16 })
        expect(formatReferenceVideoDurationViolation('Seedance 2.0', aggregateViolation!)).toContain('合计不能超过 15 秒')
    })
})
