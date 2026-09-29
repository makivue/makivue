import { describe, expect, it } from 'vitest'
import { isEpisodeBatchExecutorInterrupted, normalizeTerminalBatchShots, resolveEpisodeBatchFailureStage, summarizeEpisodeBatchShots } from './episode-batch-progress'

describe('episode batch progress', () => {
    const shots = [
        { storyboardId: '1', order: 1, status: 'frame_running' as const },
        { storyboardId: '2', order: 2, status: 'video_running' as const },
        { storyboardId: '3', order: 3, status: 'pending' as const },
        { storyboardId: '4', order: 4, status: 'failed' as const },
        { storyboardId: '5', order: 5, status: 'frame_done' as const }
    ]

    it('never leaves stale running spinners after a batch reaches a terminal phase', () => {
        const normalized = normalizeTerminalBatchShots(shots, 'done')
        expect(normalized.map(shot => shot.status)).toEqual(['skipped', 'skipped', 'skipped', 'failed', 'skipped'])
        expect(summarizeEpisodeBatchShots(normalized)).toEqual({ completed: 0, failed: 1, skipped: 4, running: 0 })
    })

    it('preserves real running state while the batch is active', () => {
        expect(normalizeTerminalBatchShots(shots, 'running')).toEqual(shots)
    })

    it('recognizes both legacy lease expiry and the new executor interruption message', () => {
        expect(
            isEpisodeBatchExecutorInterrupted({
                phase: 'error',
                shots: [{ storyboardId: '1', order: 1, status: 'failed', errorMsg: '任务租约过期，已自动回收，请重试' }]
            })
        ).toBe(true)
        expect(isEpisodeBatchExecutorInterrupted({ phase: 'error', errorMsg: 'Nano Banana 429', shots: [] })).toBe(false)
    })

    it('keeps a completed illustration successful when the video stage fails', () => {
        expect(resolveEpisodeBatchFailureStage({ status: 'failed', failedStage: 'video', errorMsg: 'provider failed' })).toBe('video')
        expect(resolveEpisodeBatchFailureStage({ status: 'failed', errorMsg: 'Seedance create error: InputImageSensitiveContent' })).toBe('video')
        expect(resolveEpisodeBatchFailureStage({ status: 'failed', errorMsg: '主插图生成失败' })).toBe('frame')
    })
})
