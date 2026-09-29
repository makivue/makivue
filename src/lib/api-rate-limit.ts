export const RATE_LIMIT_MESSAGE = '请求过于频繁，请合理使用'

type RateLimitRule = {
    limit: number
    windowMs: number
}

export type RateLimitResult = {
    allowed: boolean
    remaining: number
    retryAfterMs: number
}

export type MediaGenerationRateLimitScope = 'creator-image' | 'creator-video' | 'film-production'

const MAX_TRACKED_KEYS = 100_000
const entries = new Map<string, number[]>()
let lastCleanupAt = 0

function positiveEnv(name: string, fallback: number, minimum: number, maximum: number) {
    const parsed = Number(process.env[name])
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
}

const API_MEDIA_GENERATION_RATE_LIMIT_WINDOW_MS = positiveEnv('API_MEDIA_GENERATION_RATE_LIMIT_WINDOW_MS', 10_000, 1_000, 60_000)
export const API_MEDIA_GENERATION_RATE_LIMIT_PER_WINDOW = positiveEnv('API_MEDIA_GENERATION_RATE_LIMIT_PER_10S', 60, 1, 1_000)
export const API_CREATOR_GENERATION_RATE_LIMIT_PER_WINDOW = positiveEnv('API_CREATOR_GENERATION_RATE_LIMIT_PER_10S', 60, 1, 1_000)

const FILM_GENERATION_POST_PATHS = [
    /^\/api\/admin\/generate-style-previews$/,
    /^\/api\/projects\/[^/]+\/style-reference$/,
    /^\/api\/projects\/[^/]+\/character-references$/,
    /^\/api\/projects\/[^/]+\/scene-references$/,
    /^\/api\/storyboards\/[^/]+\/(?:images|video)\/generate$/,
    /^\/api\/storyboards\/[^/]+\/middle-frames\/[^/]+$/,
    /^\/api\/storyboards\/[^/]+\/compare-(?:kling|speech)$/,
    /^\/api\/episodes\/[^/]+\/generate-all$/
]

const CHARACTER_OR_SCENE_REFERENCE_PATH = /^\/api\/(?:characters|scenes)\/[^/]+\/reference$/

function normalizedPathname(pathname: string) {
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mediaGenerationRequestNeedsBody(pathname: string, method: string) {
    if (method.toUpperCase() !== 'POST') return false
    const normalized = normalizedPathname(pathname)
    return CHARACTER_OR_SCENE_REFERENCE_PATH.test(normalized) || normalized === '/api/replica/jobs'
}

/** Classifies creator and film submissions into separate anti-abuse buckets. */
export function mediaGenerationRateLimitScope(pathname: string, method: string, body?: unknown): MediaGenerationRateLimitScope | null {
    if (method.toUpperCase() !== 'POST') return null
    const normalized = normalizedPathname(pathname)
    if (normalized === '/api/create/image') return 'creator-image'
    if (normalized === '/api/create/video') return 'creator-video'
    if (FILM_GENERATION_POST_PATHS.some(pattern => pattern.test(normalized))) return 'film-production'

    if (CHARACTER_OR_SCENE_REFERENCE_PATH.test(normalized)) {
        const action = isRecord(body) ? body.action : undefined
        return action !== 'select' && action !== 'unselect' && action !== 'delete' && action !== 'clear' ? 'film-production' : null
    }

    return normalized === '/api/replica/jobs' && isRecord(body) && body.mode === 'full' ? 'film-production' : null
}

function prune(timestamps: number[], now: number, windowMs: number) {
    const firstValid = timestamps.findIndex(timestamp => timestamp > now - windowMs)
    return firstValid === -1 ? [] : timestamps.slice(firstValid)
}

function cleanup(now: number) {
    if (now - lastCleanupAt < API_MEDIA_GENERATION_RATE_LIMIT_WINDOW_MS && entries.size < MAX_TRACKED_KEYS) return
    lastCleanupAt = now
    for (const [key, timestamps] of entries) {
        if (prune(timestamps, now, API_MEDIA_GENERATION_RATE_LIMIT_WINDOW_MS).length === 0 || entries.size > MAX_TRACKED_KEYS) entries.delete(key)
    }
}

/**
 * Process-local sliding-window limiter. Proxy globals are not shared between
 * deployment replicas, so production clusters should enforce the same limits
 * at the CDN/gateway or replace this store with a shared Redis/KV adapter.
 */
export function checkApiRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
    cleanup(now)
    const timestamps = prune(entries.get(key) ?? [], now, rule.windowMs)
    if (timestamps.length >= rule.limit) {
        entries.set(key, timestamps)
        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(1, timestamps[0] + rule.windowMs - now)
        }
    }
    timestamps.push(now)
    entries.set(key, timestamps)
    return { allowed: true, remaining: Math.max(0, rule.limit - timestamps.length), retryAfterMs: 0 }
}

export function mediaGenerationRateLimitRule(scope: MediaGenerationRateLimitScope): RateLimitRule {
    return {
        limit: scope === 'film-production' ? API_MEDIA_GENERATION_RATE_LIMIT_PER_WINDOW : API_CREATOR_GENERATION_RATE_LIMIT_PER_WINDOW,
        windowMs: API_MEDIA_GENERATION_RATE_LIMIT_WINDOW_MS
    }
}

/**
 * Build a per-account limiter key from the user ID in a verified session.
 * Never derive this key from client-controlled forwarding headers: a shared
 * LAN address would make unrelated users consume one another's quota.
 */
export function userMediaGenerationRateLimitKey(userId: string | bigint, scope: MediaGenerationRateLimitScope, pathname?: string) {
    const normalizedUserId = String(userId)
    if (!/^[1-9]\d{0,18}$/.test(normalizedUserId)) throw new Error('Invalid user id for API rate limit')
    // The time window is an anti-abuse guard, not the account concurrency
    // queue. Distinguishing concrete targets lets one legitimate batch submit
    // many different characters/scenes while repeated requests for one target
    // are still throttled. The database slot allocator separately enforces the
    // account-wide 30-image / 20-video processing limits.
    const target = pathname ? `:${normalizedPathname(pathname)}` : ''
    return `user:${normalizedUserId}:media-generation:${scope}${target}`
}

export function resetApiRateLimitForTests() {
    entries.clear()
    lastCleanupAt = 0
}
