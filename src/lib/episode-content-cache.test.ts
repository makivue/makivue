import { describe, expect, it } from 'vitest'
import { createEpisodeContentRequestTracker, isEpisodeContentCurrent } from './episode-content-cache'

describe('episode content cache versions', () => {
    it('rejects a pre-reset cached script or chapter even when its episode ID is unchanged', () => {
        expect(isEpisodeContentCurrent({ sourceVersion: 5 }, { sourceVersion: 4 })).toBe(false)
        expect(isEpisodeContentCurrent({ sourceVersion: 5 }, undefined)).toBe(false)
    })

    it('accepts current content and a save response newer than the summary', () => {
        expect(isEpisodeContentCurrent({ sourceVersion: 5 }, { sourceVersion: 5 })).toBe(true)
        expect(isEpisodeContentCurrent({ sourceVersion: 5 }, { sourceVersion: 6 })).toBe(true)
    })

    it('loads a new version immediately and discards the older in-flight response', () => {
        const requests = createEpisodeContentRequestTracker()
        const old = requests.start('episode', 1)!
        expect(requests.start('episode', 1)).toBeNull()
        const fresh = requests.start('episode', 2)!
        expect(requests.isCurrent('episode', old)).toBe(false)
        expect(requests.finish('episode', old)).toBe(false)
        expect(requests.isCurrent('episode', fresh)).toBe(true)
        expect(requests.finish('episode', fresh)).toBe(true)
    })

    it('supersedes pending loads after generation and discards all pre-reset responses', () => {
        const requests = createEpisodeContentRequestTracker()
        const old = requests.start('episode', 1)!
        const fresh = requests.start('episode', 1, true)!
        expect(requests.isCurrent('episode', old)).toBe(false)
        requests.clear()
        expect(requests.isCurrent('episode', fresh)).toBe(false)
        expect(requests.start('episode', 1)).not.toBeNull()
    })
})
