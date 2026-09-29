import { describe, expect, it } from 'vitest'
import { GENERATION_CONCURRENCY_LIMITS, getGenerationCategory, getGenerationConcurrencyLimitMessage, getGenerationConcurrencySummary, MAX_ACTIVE_PROJECTS_PER_USER } from './generation-concurrency'

describe('generation concurrency policy', () => {
    it('limits each user to 15 image tasks and 10 video tasks across pods', () => {
        expect(GENERATION_CONCURRENCY_LIMITS.image).toEqual({ project: 15, user: 15, queued: 15 })
        expect(GENERATION_CONCURRENCY_LIMITS.video).toEqual({ project: 10, user: 10, queued: 10 })
        expect(MAX_ACTIVE_PROJECTS_PER_USER).toBe(6)
    })

    it.each(['illustrations', 'first_frame', 'middle_frame', 'last_frame'])('counts %s as one image category', type => {
        expect(getGenerationCategory(type)).toBe('image')
    })

    it('keeps video separate and exposes limits to the client', () => {
        expect(getGenerationCategory('video')).toBe('video')
        expect(getGenerationConcurrencySummary('video')).toEqual({
            category: 'video',
            projectMaxConcurrent: 10,
            userMaxConcurrent: 10,
            userMaxQueued: 10,
            maxActiveProjects: 6
        })
    })

    it('rejects retired generation types instead of assigning them an unrelated queue', () => {
        expect(() => getGenerationCategory('audio')).toThrow('Unsupported generation type: audio')
    })

    it('returns category-specific limit feedback', () => {
        expect(getGenerationConcurrencyLimitMessage('image')).toBe('当前账号最多同时处理 15 个图片生成任务，请等待正在处理的图片完成后再试。')
        expect(getGenerationConcurrencyLimitMessage('video')).toBe('当前账号最多同时处理 10 个视频生成任务，请等待正在处理的视频完成后再试。')
    })
})
