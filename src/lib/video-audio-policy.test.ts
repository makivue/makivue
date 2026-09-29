import { describe, expect, it } from 'vitest'
import { getVideoSpeechCapability, usesEmbeddedVideoAudio } from './video-audio-policy'

describe('video audio policy', () => {
    it.each(['seedance', 'wan3', 'wan3prime', 'veo3', 'seedance-2.0-global', 'MiniMax-H3', 'veo-3.1-generate-001', 'veo-3.1-fast-generate-001', 'veo-3.1-lite-generate-001'])(
        '%s keeps the video model audio track',
        provider => {
            expect(usesEmbeddedVideoAudio(provider)).toBe(true)
        }
    )

    it('does not treat Happy Horse as embedded audio', () => {
        expect(usesEmbeddedVideoAudio('wanx')).toBe(false)
        expect(getVideoSpeechCapability('wanx', true).mode).toBe('none')
    })

    it('does not treat an unknown legacy provider as embedded audio', () => {
        expect(usesEmbeddedVideoAudio('legacy-video')).toBe(false)
    })

    it('describes Happy Horse as visual-only even when the storyboard has dialogue', () => {
        expect(getVideoSpeechCapability('seedance', true)).toMatchObject({ mode: 'native', supportsMultipleSpeakers: true })
        expect(getVideoSpeechCapability('wan3', true)).toMatchObject({ mode: 'native', supportsMultipleSpeakers: true })
        expect(getVideoSpeechCapability('wan3prime', true)).toMatchObject({ mode: 'native', supportsMultipleSpeakers: true })
        expect(getVideoSpeechCapability('seedance-2.0-global', true)).toMatchObject({ mode: 'native', supportsMultipleSpeakers: true })
        expect(getVideoSpeechCapability('MiniMax-H3', true)).toMatchObject({ mode: 'native', supportsMultipleSpeakers: true })
        expect(getVideoSpeechCapability('veo-3.1-generate-001', true)).toMatchObject({ mode: 'native', supportsMultipleSpeakers: true })
        expect(getVideoSpeechCapability('wanx', true)).toMatchObject({ mode: 'none', supportsMultipleSpeakers: false })
        expect(getVideoSpeechCapability('wanx', false)).toMatchObject({ mode: 'none', supportsMultipleSpeakers: false })
    })
})
