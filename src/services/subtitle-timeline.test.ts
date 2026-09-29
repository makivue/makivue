import { describe, expect, it } from 'vitest'
import { offsetAndClipSubtitleCues } from './subtitle'

describe('episode subtitle timeline', () => {
    it('clips the final cue to the actual merged video duration', () => {
        const cues = offsetAndClipSubtitleCues([{ startMs: 800, endMs: 1400, text: '尾句' }], 9000, 1500, 10000)
        expect(cues).toEqual([{ startMs: 9800, endMs: 10000, text: '尾句' }])
        expect(cues[0].endMs).toBeLessThanOrEqual(10000)
    })
})
