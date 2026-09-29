import { describe, expect, it } from 'vitest'
import { resolveVideoFailureDisplay, SWITCHED_VIDEO_FAILURE, VIDEO_FAILURE_WITHOUT_DETAIL } from './storyboard-failure-display'

describe('storyboard video failure display', () => {
    it('shows the current batch error inside the expanded storyboard', () => {
        expect(
            resolveVideoFailureDisplay({
                videoUrl: null,
                videoStatus: 'pending',
                batchVideoFailed: true,
                batchError: '批量视频任务提交失败',
                persistedError: undefined
            })
        ).toEqual({ failed: true, message: '批量视频任务提交失败' })
    })

    it('uses the persisted generation error after a refresh', () => {
        expect(
            resolveVideoFailureDisplay({
                videoUrl: null,
                videoStatus: 'failed',
                batchVideoFailed: false,
                persistedError: '上游视频任务失败'
            })
        ).toEqual({ failed: true, message: '上游视频任务失败' })
    })

    it('explains historical failed rows that have no generation detail', () => {
        expect(
            resolveVideoFailureDisplay({
                videoUrl: null,
                videoStatus: 'failed',
                batchVideoFailed: false
            })
        ).toEqual({ failed: true, message: VIDEO_FAILURE_WITHOUT_DETAIL })
    })

    it('does not keep a stale batch failure red after a video exists', () => {
        expect(
            resolveVideoFailureDisplay({
                videoUrl: 'https://cdn.example.com/video.mp4',
                videoStatus: 'completed',
                batchVideoFailed: true,
                batchError: '旧批次失败'
            })
        ).toEqual({ failed: false, message: undefined })
    })

    it('does not expose the internal fallback provider or raw response', () => {
        expect(
            resolveVideoFailureDisplay({
                videoUrl: null,
                videoStatus: 'failed',
                batchVideoFailed: false,
                providerSwitched: true,
                persistedError: 'Veo 3 done but no video URI: {"videos":[{"bytes":"..."}]}'
            })
        ).toEqual({ failed: true, message: SWITCHED_VIDEO_FAILURE })
    })
})
