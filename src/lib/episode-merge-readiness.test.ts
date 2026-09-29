import { describe, expect, it } from 'vitest'
import { assessEpisodeMergeReadiness, effectiveEpisodeMergeVideoPath, type EpisodeMergeStoryboard } from './episode-merge-readiness'

function storyboard(overrides: Partial<EpisodeMergeStoryboard> = {}): EpisodeMergeStoryboard {
    return {
        videoUrl: 'https://cdn.example.com/video.mp4',
        videoStatus: 'completed',
        audioUrl: null,
        composedVideoUrl: null,
        dialogue: null,
        expectedAudioMode: 'native_ambience',
        compositionMode: null,
        generations: [{ provider: 'seedance', status: 'completed' }],
        ...overrides
    }
}

describe('episode merge readiness', () => {
    it('reports active video work before dialogue-audio requirements even when an old video URL exists', () => {
        const shots = Array.from({ length: 18 }, () =>
            storyboard({
                videoStatus: 'generating',
                dialogue: '有对白',
                expectedAudioMode: 'external_dialogue',
                generations: [{ provider: 'wanx', status: 'processing' }]
            })
        )

        expect(assessEpisodeMergeReadiness(shots)).toEqual({ ready: false, stage: 'video', count: 18 })
    })

    it.each(['seedance', 'seedance25', 'wan3', 'wan3prime'])('accepts completed %s dialogue video directly without a separate TTS track', provider => {
        const shot = storyboard({ dialogue: '有对白', expectedAudioMode: 'native_dialogue', generations: [{ provider, status: 'completed' }] })

        expect(assessEpisodeMergeReadiness([shot])).toEqual({ ready: true })
        expect(effectiveEpisodeMergeVideoPath(shot)).toBe(shot.videoUrl)
    })

    it('requires a new video for a visual-only dialogue shot instead of starting TTS', () => {
        const shot = storyboard({
            dialogue: '有对白',
            expectedAudioMode: 'external_dialogue',
            generations: [{ provider: 'wanx', status: 'completed' }]
        })

        expect(assessEpisodeMergeReadiness([shot])).toEqual({ ready: false, stage: 'video_audio', count: 1 })
    })

    it('keeps an existing completed legacy dialogue mix mergeable', () => {
        const shot = storyboard({
            dialogue: '有对白',
            expectedAudioMode: 'external_dialogue',
            audioUrl: 'https://cdn.example.com/audio.mp3',
            composedVideoUrl: 'https://cdn.example.com/composed.mp4',
            compositionMode: 'audio_mix',
            generations: [{ provider: 'wanx', status: 'completed' }]
        })

        expect(assessEpisodeMergeReadiness([shot])).toEqual({ ready: true })
        expect(effectiveEpisodeMergeVideoPath(shot)).toBe(shot.composedVideoUrl)
    })

    it('does not treat a standalone TTS track as a finished dialogue video', () => {
        expect(
            assessEpisodeMergeReadiness([
                storyboard({
                    dialogue: '有对白',
                    audioUrl: 'https://cdn.example.com/old-tts.mp3',
                    expectedAudioMode: 'external_dialogue',
                    generations: [{ provider: 'wanx', status: 'completed' }]
                })
            ])
        ).toEqual({ ready: false, stage: 'video_audio', count: 1 })
    })

    it('allows a visual-only shot without dialogue to merge without generating speech', () => {
        const shot = storyboard({ expectedAudioMode: 'none', generations: [{ provider: 'wanx', status: 'completed' }] })
        expect(assessEpisodeMergeReadiness([shot])).toEqual({ ready: true })
        expect(effectiveEpisodeMergeVideoPath(shot)).toBe(shot.videoUrl)
    })

    it('keeps legacy completed native-audio rows mergeable when no generation record remains', () => {
        expect(
            assessEpisodeMergeReadiness([
                storyboard({
                    dialogue: '旧数据对白',
                    expectedAudioMode: 'native_dialogue',
                    generations: []
                })
            ])
        ).toEqual({ ready: true })
    })
})
