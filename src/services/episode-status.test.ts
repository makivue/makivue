import { describe, expect, it } from 'vitest'
import { episodeStatusSnapshot } from './episode-status'

function source() {
    return {
        id: 1n,
        status: 'generating',
        sourceVersion: 1,
        updatedAt: null,
        videoUrl: null,
        storyboards: [
            {
                id: 2n,
                updatedAt: null,
                sourceVersion: 1,
                operationVersion: 1,
                frameStatus: null,
                videoStatus: 'generating',
                composeStatus: null,
                audioStatus: null,
                polishStatus: null,
                firstFrameUrl: null,
                lastFrameUrl: null,
                plannedLastFrameUrl: null,
                actualVideoEndFrameUrl: null,
                videoUrl: null,
                composedVideoUrl: null,
                audioUrl: null,
                generations: [{ id: 3n, status: 'processing', resultUrl: null, errorMsg: null }]
            }
        ],
        merges: [{ id: 4n, status: 'processing', videoUrl: null, updatedAt: null }]
    }
}

describe('lightweight episode status', () => {
    it('serializes nullable legacy states without leaking media or generation payloads', () => {
        const snapshot = episodeStatusSnapshot(source())
        expect(snapshot.storyboards).toEqual([{ id: '2', frameStatus: 'pending', videoStatus: 'generating', composeStatus: 'pending' }])
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
        expect(snapshot.storyboards[0]).not.toHaveProperty('generations')
    })

    it('detects completed media and errors even when timestamps and high-level statuses are unchanged', () => {
        const episode = source()
        const original = episodeStatusSnapshot(episode).version
        expect(episodeStatusSnapshot({ ...episode, storyboards: [{ ...episode.storyboards[0], videoUrl: 'https://cdn.example/video.mp4' }] }).version).not.toBe(original)
        expect(episodeStatusSnapshot({ ...episode, storyboards: [{ ...episode.storyboards[0], generations: [{ ...episode.storyboards[0].generations[0], errorMsg: 'failed' }] }] }).version).not.toBe(
            original
        )
        expect(episodeStatusSnapshot({ ...episode, storyboards: [{ ...episode.storyboards[0], operationVersion: 2 }] }).version).not.toBe(original)
    })

    it('ignores billing and heartbeat-only updates from a full-detail payload', () => {
        const episode = source()
        const withExtra = {
            ...episode,
            usage: { coins: 100 },
            storyboards: episode.storyboards.map(shot => ({ ...shot, generations: shot.generations.map(job => ({ ...job, metrics: { heartbeat: Date.now() } })) }))
        }
        expect(episodeStatusSnapshot(withExtra).version).toBe(episodeStatusSnapshot(episode).version)
    })
})
