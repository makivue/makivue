import { afterEach, describe, expect, it } from 'vitest'
import {
    API_CREATOR_GENERATION_RATE_LIMIT_PER_WINDOW,
    API_MEDIA_GENERATION_RATE_LIMIT_PER_WINDOW,
    checkApiRateLimit,
    mediaGenerationRateLimitScope,
    mediaGenerationRequestNeedsBody,
    resetApiRateLimitForTests,
    userMediaGenerationRateLimitKey
} from './api-rate-limit'

afterEach(resetApiRateLimitForTests)

const isMediaGenerationRequest = (pathname: string, method: string, body?: unknown) => mediaGenerationRateLimitScope(pathname, method, body) !== null

describe('API rate limiter', () => {
    it('allows 60 generation submissions per anti-abuse window by default', () => {
        expect(API_MEDIA_GENERATION_RATE_LIMIT_PER_WINDOW).toBe(60)
        expect(API_CREATOR_GENERATION_RATE_LIMIT_PER_WINDOW).toBe(60)
    })

    it('uses a sliding 10-second window', () => {
        const rule = { limit: 2, windowMs: 10_000 }
        const key = userMediaGenerationRateLimitKey('10001', 'film-production')
        expect(checkApiRateLimit(key, rule, 0).allowed).toBe(true)
        expect(checkApiRateLimit(key, rule, 1_000).allowed).toBe(true)
        const blocked = checkApiRateLimit(key, rule, 9_999)
        expect(blocked).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 1 })
        expect(checkApiRateLimit(key, rule, 10_001).allowed).toBe(true)
    })

    it('limits image and video generation submissions', () => {
        expect(isMediaGenerationRequest('/api/create/image', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/create/video', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/storyboards/42/images/generate', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/storyboards/42/video/generate', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/storyboards/42/middle-frames/99', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/episodes/42/generate-all', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/storyboards/42/compare-kling', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/storyboards/42/compare-speech', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/projects/42/style-reference', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/projects/42/character-references', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/projects/42/scene-references', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/admin/generate-style-previews', 'POST')).toBe(true)
    })

    it('keeps creator image, creator video, and film anti-abuse scopes separate', () => {
        expect(mediaGenerationRateLimitScope('/api/create/image', 'POST')).toBe('creator-image')
        expect(mediaGenerationRateLimitScope('/api/create/video', 'POST')).toBe('creator-video')
        expect(mediaGenerationRateLimitScope('/api/scenes/42/reference', 'POST', { provider: 'banana' })).toBe('film-production')
        expect(mediaGenerationRateLimitScope('/api/storyboards/42/video/generate', 'POST')).toBe('film-production')
        expect(userMediaGenerationRateLimitKey('10001', 'creator-image')).not.toBe(userMediaGenerationRateLimitKey('10001', 'film-production'))
    })

    it('uses separate anti-abuse keys for different batch targets', () => {
        const firstScene = userMediaGenerationRateLimitKey('10001', 'film-production', '/api/scenes/41/reference')
        const secondScene = userMediaGenerationRateLimitKey('10001', 'film-production', '/api/scenes/42/reference')
        expect(firstScene).not.toBe(secondScene)
        expect(firstScene).toBe(userMediaGenerationRateLimitKey('10001', 'film-production', '/api/scenes/41/reference/'))
    })

    it('recognizes generation on endpoints that also serve non-generation actions', () => {
        expect(mediaGenerationRequestNeedsBody('/api/characters/42/reference', 'POST')).toBe(true)
        expect(isMediaGenerationRequest('/api/characters/42/reference', 'POST', { provider: 'banana' })).toBe(true)
        expect(isMediaGenerationRequest('/api/scenes/42/reference', 'POST', { provider: 'banana' })).toBe(true)
        expect(isMediaGenerationRequest('/api/replica/jobs', 'POST', { mode: 'full' })).toBe(true)
    })

    it('does not limit ordinary API reads and writes', () => {
        expect(isMediaGenerationRequest('/api/projects', 'GET')).toBe(false)
        expect(isMediaGenerationRequest('/api/projects', 'POST')).toBe(false)
        expect(isMediaGenerationRequest('/api/episodes/42', 'PATCH')).toBe(false)
        expect(isMediaGenerationRequest('/api/episodes/42/finalize', 'POST')).toBe(false)
        expect(isMediaGenerationRequest('/api/ai/chapter', 'POST')).toBe(false)
        expect(isMediaGenerationRequest('/api/characters/42/reference', 'POST', { action: 'select' })).toBe(false)
        expect(isMediaGenerationRequest('/api/scenes/42/reference', 'POST', { action: 'delete' })).toBe(false)
        expect(isMediaGenerationRequest('/api/scenes/42/reference', 'POST', { action: 'unselect' })).toBe(false)
        expect(isMediaGenerationRequest('/api/replica/jobs', 'POST', { mode: 'analyze' })).toBe(false)
        expect(isMediaGenerationRequest('/api/storyboards/42/images/generate', 'GET')).toBe(false)
    })

    it('keeps separate user accounts independent on the same network', () => {
        const rule = { limit: 1, windowMs: 10_000 }
        expect(checkApiRateLimit(userMediaGenerationRateLimitKey('10001', 'film-production'), rule, 0).allowed).toBe(true)
        expect(checkApiRateLimit(userMediaGenerationRateLimitKey('10002', 'film-production'), rule, 0).allowed).toBe(true)
    })

    it('does not accept an arbitrary value as a user identity', () => {
        expect(() => userMediaGenerationRateLimitKey('203.0.113.8', 'film-production')).toThrow('Invalid user id')
    })
})
