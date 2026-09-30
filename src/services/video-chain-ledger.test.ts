import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VIDEO_END_FRAME_OFFSETS, selectSharpestEndFrame } from './ffmpeg'

const root = process.cwd()
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('0813 video chain ledger regressions', () => {
    it('skips content quality analysis while retaining media integrity checks before upload', () => {
        const ai = source('src/services/ai.ts')
        const completionStart = ai.indexOf('async function completeVideoGeneration')
        const completionEnd = ai.indexOf('\nexport ', completionStart)
        const completion = ai.slice(completionStart, completionEnd)
        expect(completion).not.toContain('analyzeVideoQuality')
        expect(completion).not.toContain("videoQuality.status === 'blocked'")
        expect(completion).not.toContain('buildVideoCompletionReview')
        expect(completion).toContain('probeMediaStreams')
        expect(completion.indexOf('probeMediaStreams')).toBeLessThan(completion.indexOf('uploadStoryboardArtifact'))
    })

    it('selects the sharpest ending-frame candidate and rejects an all-blurry set', () => {
        expect(VIDEO_END_FRAME_OFFSETS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
        expect(
            selectSharpestEndFrame([
                { id: 'a', score: 0.8 },
                { id: 'b', score: 2.4 },
                { id: 'c', score: 1.6 }
            ])?.id
        ).toBe('b')
        expect(
            selectSharpestEndFrame([
                { id: 'a', score: 0.2 },
                { id: 'b', score: 0.49 }
            ])
        ).toBeNull()
    })
})
