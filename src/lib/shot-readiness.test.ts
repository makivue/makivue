import { describe, expect, it } from 'vitest'
import { isShotFrameReady, isShotVideoReady, reviewShotReadiness, type ReadinessShot } from './shot-readiness'
import { estimateDialogueDurationSeconds } from './video-production-plan'

const shot: ReadinessShot = {
    id: '1',
    order: 1,
    duration: 8,
    imagePrompt: '窗边的女孩手握信封',
    actionDesc: 'Opening state: 女孩手握信封; Ending state: 女孩展开信纸',
    scene: { id: '3' },
    continuityMode: 'stateful'
}

describe('production preflight', () => {
    it('does not count stale URLs as completed media during retries or failures', () => {
        expect(isShotFrameReady({ ...shot, firstFrameUrl: '/old.png', frameStatus: 'generating' })).toBe(false)
        expect(isShotVideoReady({ ...shot, videoUrl: '/old.mp4', videoStatus: 'failed' })).toBe(false)
        expect(isShotVideoReady({ ...shot, videoUrl: '/old.mp4', videoStatus: 'completed', latestVideoRequest: { status: 'generating' } })).toBe(false)
        expect(isShotVideoReady({ ...shot, videoUrl: '/ready.mp4', videoStatus: 'completed' })).toBe(true)
    })

    it('distinguishes current shot duration from the provider maximum', () => {
        const speaking = { ...shot, duration: 4, dialogue: '女孩：三年前，我们都以为那段故事已经结束，可这封信却说他从未离开。' }
        expect(reviewShotReadiness(speaking, undefined, 'wan3').map(issue => issue.code)).toContain('dialogue_timing')
        expect(reviewShotReadiness({ ...speaking, duration: 20 }, undefined, 'wan3')).toEqual([])
    })

    it('flags contradictory scene continuity without flagging an intentional scene cut', () => {
        const changedScene = { ...shot, scene: { id: '4' } }
        expect(reviewShotReadiness(changedScene, shot).map(issue => issue.code)).toContain('continuity_scene_change')
        expect(reviewShotReadiness({ ...changedScene, continuityMode: 'independent' }, shot)).toEqual([])
        expect(reviewShotReadiness({ ...shot, scene: { id: 3n } }, shot)).toEqual([])
    })

    it('reports missing boundaries and invalid timing, while accepting a simple completed action', () => {
        expect(reviewShotReadiness({ ...shot, duration: NaN, actionDesc: '' }).map(issue => issue.code)).toEqual(['missing_boundary', 'invalid_duration'])
        expect(reviewShotReadiness(shot)).toEqual([])
    })

    it('counts Arabic and Hindi speech and excludes every speaker label', () => {
        expect(estimateDialogueDurationSeconds('ليلى: أين الرسالة التي تركتها هنا؟')).toBeGreaterThan(1)
        expect(estimateDialogueDurationSeconds('सीमा: वह पत्र कहाँ है जो मैंने यहाँ रखा था?')).toBeGreaterThan(1)
        expect(estimateDialogueDurationSeconds('阿青：你好。\n小雨：再见。')).toBe(estimateDialogueDurationSeconds('你好。\n再见。'))
    })
})
