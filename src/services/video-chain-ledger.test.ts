import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { VIDEO_END_FRAME_OFFSETS, selectSharpestEndFrame } from './ffmpeg'

const root = process.cwd()
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('0813 video chain ledger regressions', () => {
    it('uses the detailed content-adaptive action, camera and transition plan', () => {
        const llm = source('src/services/llm.ts')
        const start = llm.indexOf('export async function improveVideoMotionPrompt')
        const end = llm.indexOf('\nexport ', start + 1)
        const promptTemplate = llm.slice(start, end)
        expect(promptTemplate).not.toContain('body facing camera')
        expect(promptTemplate).toContain('buildVideoTimelineInstructions')
        expect(promptTemplate).toContain('buildFallbackVideoTimeline')
        expect(promptTemplate).toContain('isCompleteVideoTimeline')
        expect(promptTemplate).toContain('semantic-beat execution plan')
        expect(promptTemplate).toContain('Infer the segment count and variable durations from the action')
        expect(promptTemplate).toContain('never apply a preset timing grid')
    })

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

    it('keeps single and batch generation behind the dialogue-capacity hard gate', () => {
        for (const route of ['src/services/storyboard-generation-handler.ts', 'src/app/api/episodes/[id]/generate-all/route.ts']) {
            const content = source(route)
            expect(content).toContain("dialogueHandling === 'split'")
            expect(content).toContain("suggestedAction: 'split_storyboard'")
            expect(content).toContain("code: 'DIALOGUE_SPLIT_REQUIRED'")
        }
        expect(source('src/services/storyboard-generation-handler.ts')).toContain('409')
        expect(source('src/app/api/episodes/[id]/generate-all/route.ts')).toContain('422')
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

    it('audits recommendations without replacing the selected video provider', () => {
        const batchRoute = source('src/app/api/episodes/[id]/generate-all/route.ts')
        expect(batchRoute).toContain('recommendVideoProvider(')
        expect(batchRoute).toContain("policyApplied: 'explicit_provider_lock'")
        expect(batchRoute).toContain('recommendedProvider: routingRecommendation.provider')
        expect(batchRoute).toContain('appliedProvider: shotVideoProvider')
        expect(batchRoute).toContain('const providerForStoryboard = () => videoProvider')
        expect(batchRoute).toContain('const primaryVideoProvider = videoProviderOverride ?? (await resolveGlobalVideoProvider())')
        expect(batchRoute).toContain('Promise.resolve(primaryVideoProvider)')
        expect(batchRoute).not.toContain('autoModelRouting')
        expect(batchRoute).not.toContain('videoProviderByStoryboard')
        expect(batchRoute).not.toContain('getVideoProviderRoutingFeedback')
    })
})
