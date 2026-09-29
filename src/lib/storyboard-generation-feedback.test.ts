import { describe, expect, it } from 'vitest'
import { collectStoryboardGenerationFailureNotices, generationFeedbackStageForRequest, generationFeedbackWatchKey, type StoryboardGenerationFeedbackItem } from './storyboard-generation-feedback'

function storyboard(overrides: Partial<StoryboardGenerationFeedbackItem> = {}): StoryboardGenerationFeedbackItem {
    return {
        id: 'shot-66',
        order: 66,
        frameStatus: 'pending',
        videoStatus: 'pending',
        latestErrors: {},
        ...overrides
    }
}

describe('storyboard generation failure feedback', () => {
    it('maps every single-shot request to the status that its polling should watch', () => {
        expect(generationFeedbackStageForRequest('illustrations')).toBe('frame')
        expect(generationFeedbackStageForRequest('first_frame')).toBe('frame')
        expect(generationFeedbackStageForRequest('last_frame')).toBe('frame')
        expect(generationFeedbackStageForRequest('video')).toBe('video')
        expect(generationFeedbackStageForRequest('audio')).toBeNull()
    })

    it('reports an active-to-failed transition with the detailed child-frame error', () => {
        const previous = storyboard({ frameStatus: 'generating' })
        const current = storyboard({
            frameStatus: 'failed',
            latestErrors: {
                illustrations: { errorMsg: '主插图生成失败，未继续生成插图组', createdAt: '2026-09-01T03:26:32Z' },
                first_frame: { errorMsg: 'thinking_level is not supported', provider: 'gemini-3.1-flash-image', createdAt: '2026-09-01T03:26:32Z' }
            }
        })

        const result = collectStoryboardGenerationFailureNotices({ previous: [previous], current: [current], watchedKeys: new Set(), shownFailureKeys: new Set() })

        expect(result.notices).toEqual([expect.objectContaining({ message: '分镜 66 插图生成失败：thinking_level is not supported' })])
    })

    it('reports a newly persisted failure for a watched fast request only once', () => {
        const watchKey = generationFeedbackWatchKey('shot-66', 'frame')
        const previous = storyboard({
            frameStatus: 'failed',
            latestErrors: { first_frame: { errorMsg: '旧错误', createdAt: '2026-09-01T03:20:00Z' } }
        })
        const current = storyboard({
            frameStatus: 'failed',
            latestErrors: { first_frame: { errorMsg: '新错误', createdAt: '2026-09-01T03:26:32Z' } }
        })
        const first = collectStoryboardGenerationFailureNotices({ previous: [previous], current: [current], watchedKeys: new Set([watchKey]), shownFailureKeys: new Set() })
        const shown = new Set(first.notices.map(notice => notice.failureKey))
        const duplicate = collectStoryboardGenerationFailureNotices({ previous: [current], current: [current], watchedKeys: new Set([watchKey]), shownFailureKeys: shown })

        expect(first.notices).toHaveLength(1)
        expect(first.resolvedWatchKeys.has(watchKey)).toBe(true)
        expect(duplicate.notices).toHaveLength(0)
    })

    it('does not announce a historical failure on initial page load', () => {
        const failed = storyboard({
            frameStatus: 'failed',
            latestErrors: { first_frame: { errorMsg: '历史错误', createdAt: '2026-08-31T10:00:00Z' } }
        })

        const result = collectStoryboardGenerationFailureNotices({ previous: [], current: [failed], watchedKeys: new Set(), shownFailureKeys: new Set() })

        expect(result.notices).toHaveLength(0)
    })
})
