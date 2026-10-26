import { describe, expect, it } from 'vitest'
import { parseVideoThemeInput, parseVideoThemePlan, videoThemeSourceKey } from './creator-video-plan'

const input = { topic: 'Explain how coffee is brewed', purpose: 'knowledge', audio: 'narration', language: 'en', provider: 'wan3', duration: 10, ratio: '9:16' }

describe('topic video planning constraints', () => {
    it('accepts supported settings and trims the topic', () => {
        expect(parseVideoThemeInput({ ...input, topic: '  coffee  ' }).topic).toBe('coffee')
        expect(parseVideoThemeInput({ ...input, provider: 'MiniMax-H3', ratio: '21:9' }).ratio).toBe('21:9')
    })
    it.each([
        { topic: '' },
        { topic: 'a'.repeat(1001) },
        { duration: 60 },
        { duration: 5.5 },
        { duration: '10' },
        { ratio: '21:9' },
        { ratio: ['9:16'] },
        { language: 'de' },
        { provider: 'wanx' },
        { purpose: 'unknown' },
        { purpose: ['knowledge'] },
        { audio: 'unknown' }
    ])('rejects unsupported parameters before any paid model call: %j', patch => {
        expect(() => parseVideoThemeInput({ ...input, ...patch })).toThrow()
    })
    it('invalidates a cached script when any production input changes', () => {
        const original = parseVideoThemeInput(input)
        const key = videoThemeSourceKey(original)
        for (const patch of [
            { topic: 'tea' },
            { duration: 15 },
            { ratio: '16:9' },
            { audio: 'ambient' as const },
            { language: 'zh' as const },
            { purpose: 'travel' as const },
            { provider: 'seedance' }
        ]) {
            expect(videoThemeSourceKey({ ...original, ...patch })).not.toBe(key)
        }
        expect(videoThemeSourceKey({ ...original, topic: '  ' + original.topic + '  ' })).toBe(key)
    })
    it('never clips incomplete or oversized model output into a valid script', () => {
        expect(parseVideoThemePlan({ title: ' Coffee ', prompt: ' Show a coffee cup. ' })).toEqual({ title: 'Coffee', prompt: 'Show a coffee cup.' })
        for (const raw of [null, {}, { title: 'Coffee', prompt: '' }, { title: 'Coffee', prompt: 'x'.repeat(4001) }, { title: 12, prompt: 'Coffee' }]) expect(() => parseVideoThemePlan(raw)).toThrow()
    })
})
