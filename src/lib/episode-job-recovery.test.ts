import { describe, expect, it } from 'vitest'
import { EP_JOB_STALE_MS, isEpJobHeartbeatExpired } from './episodeJobStore'

describe('episode one-click generation heartbeat', () => {
    it('keeps a recently heartbeating executor active', () => {
        const now = Date.now()
        expect(isEpJobHeartbeatExpired(now - EP_JOB_STALE_MS + 1, now)).toBe(false)
    })

    it('makes a stopped executor recoverable after three minutes', () => {
        const now = Date.now()
        expect(isEpJobHeartbeatExpired(now - EP_JOB_STALE_MS - 1, now)).toBe(true)
    })
})
