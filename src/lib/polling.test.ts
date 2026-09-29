import { describe, expect, it } from 'vitest'
import { getPollingDelay, nextWorkerPollDelay } from './polling'

describe('getPollingDelay', () => {
    it('uses the requested cadence while the tab is active', () => {
        expect(getPollingDelay({ baseMs: 7_500, hidden: false })).toBe(7_500)
    })

    it('backs off transient failures with a bounded delay', () => {
        expect(getPollingDelay({ baseMs: 5_000, failureCount: 1, hidden: false })).toBe(10_000)
        expect(getPollingDelay({ baseMs: 5_000, failureCount: 8, maxMs: 30_000, hidden: false })).toBe(30_000)
    })

    it('limits hidden tabs to a low-QPS cadence', () => {
        expect(getPollingDelay({ baseMs: 5_000, hidden: true })).toBe(30_000)
        expect(getPollingDelay({ baseMs: 20_000, hidden: true, hiddenMinMs: 45_000 })).toBe(45_000)
    })

    it('adds deterministic jitter to spread status requests', () => {
        expect(getPollingDelay({ baseMs: 10_000, hidden: false, jitterRatio: 0.15, random: () => 0 })).toBe(8_500)
        expect(getPollingDelay({ baseMs: 10_000, hidden: false, jitterRatio: 0.15, random: () => 1 })).toBe(11_500)
    })

    it('backs an idle server worker off without delaying active work', () => {
        expect(nextWorkerPollDelay(5_000, true)).toBe(5_000)
        expect(nextWorkerPollDelay(5_000, false)).toBe(10_000)
        expect(nextWorkerPollDelay(20_000, false)).toBe(30_000)
    })
})
