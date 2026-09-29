import { describe, expect, it } from 'vitest'
import { buildVideoLanguageLock, normalizeVideoLanguage } from './video-language'

describe('video language configuration', () => {
    it('supports Chinese and English with Chinese as the safe default', () => {
        expect(normalizeVideoLanguage('zh')).toBe('zh')
        expect(normalizeVideoLanguage('en')).toBe('en')
        expect(normalizeVideoLanguage('fr')).toBe('zh')
    })

    it('creates an explicit spoken-language lock for providers', () => {
        expect(buildVideoLanguageLock('en', 'I will be back.')).toContain('English only')
        expect(buildVideoLanguageLock('en', 'I will be back.')).toContain('I will be back.')
        expect(buildVideoLanguageLock('zh', '我会回来。')).toContain('Mandarin Chinese only')
        expect(buildVideoLanguageLock('zh', null, '旁白：雨下了三天。')).toContain('off-screen voice-over')
        expect(buildVideoLanguageLock('zh', null, '旁白：雨下了三天。')).toContain('雨下了三天')
    })
})
