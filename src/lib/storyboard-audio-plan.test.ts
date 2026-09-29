import { describe, expect, it } from 'vitest'
import { buildAudioTimelineDirection, buildStoryboardAudioPlan } from './storyboard-audio-plan'

describe('storyboard audio plan', () => {
    it('separates visible dialogue, voice-over, and inner monologue into timed cues', () => {
        const plan = buildStoryboardAudioPlan({ duration: 10, dialogue: '阿青：进来吧。', narration: '阿青（内心）：他果然来了。\n旁白：雨还在下。' })
        expect(plan?.cues.map(cue => [cue.mode, cue.lipSync])).toEqual([
            ['dialogue', true],
            ['inner_monologue', false],
            ['voice_over', false]
        ])
        expect(plan?.cues[0].startTime).toBeLessThan(plan!.cues[0].endTime)
        expect(plan?.cues.at(-1)?.endTime).toBeLessThanOrEqual(10)
        expect(buildAudioTimelineDirection(plan)).toContain('no visible mouth movement')
    })
})
