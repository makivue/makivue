import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHiModelsVideoTask } from './himodels'
import { pollHiModelsVideoOperation } from './ai'

vi.mock('./himodels', async importOriginal => ({
    ...(await importOriginal<typeof import('./himodels')>()),
    getHiModelsVideoTask: vi.fn()
}))

const completed = { status: 'completed', usage: { completion_tokens: 108900 }, response: { videos: [{ video_url: 'https://cdn.example/video.mp4' }] } }

describe('HiModels video polling', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.mocked(getHiModelsVideoTask).mockReset()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it.each([
        { status: 'failed', error: { message: 'Output audio copyright restriction' } },
        { status: 'failed', message: 'Provider failed' },
        { status: 'cancelled' },
        { status: 'unknown' },
        { done: true, response: {} }
    ])('ends a terminal response immediately instead of polling for 30 minutes: %j', async response => {
        vi.mocked(getHiModelsVideoTask).mockResolvedValue(response)
        const result = pollHiModelsVideoOperation('task', 'Seedance 2.5', 120).catch(error => error)
        await vi.advanceTimersByTimeAsync(15000)
        expect(await result).toBeInstanceOf(Error)
        expect(getHiModelsVideoTask).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('recovers from a transient query error and returns the successful video and usage', async () => {
        vi.mocked(getHiModelsVideoTask).mockRejectedValueOnce(new Error('temporary 502')).mockResolvedValueOnce({ status: 'processing' }).mockResolvedValueOnce(completed)
        const result = pollHiModelsVideoOperation('task', 'Seedance 2.5')
        await vi.advanceTimersByTimeAsync(45000)
        expect(await result).toEqual({ videoResult: { kind: 'uri', uri: 'https://cdn.example/video.mp4' }, usage: { 'usage.completion_tokens': 108900 } })
        expect(getHiModelsVideoTask).toHaveBeenCalledTimes(3)
    })

    it('stops after five consecutive transport failures', async () => {
        const error = new Error('upstream unavailable')
        vi.mocked(getHiModelsVideoTask).mockRejectedValue(error)
        const result = pollHiModelsVideoOperation('task', 'Seedance 2.5').catch(error => error)
        await vi.advanceTimersByTimeAsync(75000)
        expect(await result).toBe(error)
        expect(getHiModelsVideoTask).toHaveBeenCalledTimes(5)
    })

    it('resets the transport error budget only after a valid status response', async () => {
        const query = vi.mocked(getHiModelsVideoTask)
        for (let i = 0; i < 4; i++) query.mockRejectedValueOnce(new Error('temporary'))
        query.mockResolvedValueOnce({ status: 'processing' })
        for (let i = 0; i < 4; i++) query.mockRejectedValueOnce(new Error('temporary'))
        query.mockResolvedValueOnce(completed)
        const result = pollHiModelsVideoOperation('task', 'Seedance 2.5')
        await vi.advanceTimersByTimeAsync(150000)
        expect((await result).videoResult).toEqual({ kind: 'uri', uri: 'https://cdn.example/video.mp4' })
        expect(query).toHaveBeenCalledTimes(10)
    })
})
