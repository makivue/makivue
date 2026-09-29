import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runScriptBatch, ScriptRequestError } from './script-batch'

const episodes = [
    { id: 'eleven', episodeNumber: 11 },
    { id: 'twelve', episodeNumber: 12 }
]
const handlers = () => ({ onAttempt: vi.fn(), onComplete: vi.fn().mockResolvedValue(undefined), onRetry: vi.fn() })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('remaining script generation', () => {
    it('honors non-retryable server errors even when their text is localized', async () => {
        const generate = vi.fn().mockRejectedValue(new ScriptRequestError('Le modèle sélectionné est indisponible', 503, false))
        const callbacks = handlers()
        expect(await runScriptBatch({ episodes, generate, ...callbacks })).toMatchObject({ episodeNumber: 11, attempts: 1 })
        expect(generate).toHaveBeenCalledTimes(1)
        expect(callbacks.onRetry).not.toHaveBeenCalled()
    })

    it('stops immediately on missing credentials and preserves the real reason', async () => {
        const reason = 'Himodels API key 未配置，请设置 HIMODELS_SHARED_API_KEY'
        const generate = vi.fn().mockRejectedValue(new Error(reason))
        const callbacks = handlers()
        const issue = await runScriptBatch({ episodes, generate, ...callbacks })
        expect(generate).toHaveBeenCalledTimes(1)
        expect(callbacks.onRetry).not.toHaveBeenCalled()
        expect(callbacks.onComplete).not.toHaveBeenCalled()
        expect(issue).toEqual({ episodeId: 'eleven', episodeNumber: 11, attempts: 1, reason, remainingCount: 1 })
    })

    it.each([400, 401, 402, 403, 404, 409, 422])('does not resubmit HTTP %s rejections', async status => {
        const generate = vi.fn().mockRejectedValue(new ScriptRequestError('request rejected', status))
        const issue = await runScriptBatch({ episodes, generate, ...handlers() })
        expect(generate).toHaveBeenCalledTimes(1)
        expect(issue?.attempts).toBe(1)
    })

    it('waits for a failed predecessor and gives each subsequent episode its own retry budget', async () => {
        const calls: number[] = []
        const counts = new Map<number, number>()
        const generate = vi.fn(async (episode: (typeof episodes)[number]) => {
            calls.push(episode.episodeNumber)
            const count = (counts.get(episode.episodeNumber) ?? 0) + 1
            counts.set(episode.episodeNumber, count)
            if (count < 3) throw new ScriptRequestError('temporary gateway failure', 503)
        })
        const callbacks = handlers()
        const result = runScriptBatch({ episodes: [...episodes].reverse(), generate, ...callbacks })
        await vi.runAllTimersAsync()
        expect(await result).toBeNull()
        expect(calls).toEqual([11, 11, 11, 12, 12, 12])
        expect(callbacks.onComplete.mock.calls.map(([episode]) => episode.episodeNumber)).toEqual([11, 12])
    })

    it('stops after three failures without starting a dependent episode', async () => {
        const generate = vi.fn().mockRejectedValue(new Error('剧本质量检查未通过：前文不一致'))
        const result = runScriptBatch({ episodes, generate, ...handlers() })
        await vi.runAllTimersAsync()
        expect(await result).toMatchObject({ episodeNumber: 11, attempts: 3, remainingCount: 1, reason: '剧本质量检查未通过：前文不一致' })
        expect(generate.mock.calls.map(([episode]) => episode.episodeNumber)).toEqual([11, 11, 11])
    })

    it('does not generate again when refreshing an already saved result fails', async () => {
        const generate = vi.fn().mockResolvedValue(undefined)
        const callbacks = handlers()
        callbacks.onComplete.mockRejectedValue(new Error('refresh failed'))
        await expect(runScriptBatch({ episodes, generate, ...callbacks })).rejects.toThrow('refresh failed')
        expect(generate).toHaveBeenCalledTimes(1)
        expect(callbacks.onRetry).not.toHaveBeenCalled()
    })
})
