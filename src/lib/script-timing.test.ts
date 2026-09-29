import { describe, expect, it } from 'vitest'
import { analyzeScriptTiming, estimateSpeechSeconds } from './script-timing'

describe('script timing', () => {
    it('estimates spoken and visible action time independently', () => {
        const timing = analyzeScriptTiming('【场景：办公室/日/内】\n（动作：阿青起身走到门边，握住门把。）\n阿青：你终于来了。')
        expect(timing.estimatedSeconds).toBeGreaterThan(timing.dialogueSeconds)
        expect(timing.actionSeconds).toBeGreaterThan(0)
    })

    it('detects an overlong uninterrupted speech turn and talking-head runs', () => {
        const longLine = `阿青：${'这件事情必须现在说清楚'.repeat(10)}`
        const timing = analyzeScriptTiming([longLine, '小雨：你说。', '阿青：先看证据。', '小雨：证据在哪？'].join('\n'))
        expect(timing.longDialogueTurns).toHaveLength(1)
        expect(timing.staticDialogueRuns).toBe(1)
        expect(estimateSpeechSeconds('现在就走。')).toBeGreaterThan(1)
    })
})
