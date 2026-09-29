import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEpisodeNavigationLoader } from './episode-navigation-loader'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function setup() {
    const fetchDetail = vi.fn(async (id: string) => ({ id, statusVersion: 'v1', script: 'original' }))
    const fetchStatus = vi.fn(async (id: string) => ({ id, version: 'v1' }))
    return { fetchDetail, fetchStatus, loader: createEpisodeNavigationLoader({ fetchDetail, fetchStatus }) }
}

afterEach(() => vi.useRealTimers())

describe('episode navigation loading', () => {
    it('shares a slow prefetch with a click and the newly mounted page', async () => {
        const { loader, fetchDetail, fetchStatus } = setup()
        const response = deferred<Awaited<ReturnType<typeof fetchDetail>>>()
        fetchDetail.mockReturnValueOnce(response.promise)
        const hover = loader.prefetch('2')
        const click = loader.prefetch('2')
        const navigation = loader.load('2')
        expect(click).toBe(hover)
        expect(navigation).toBe(hover)
        response.resolve({ id: '2', statusVersion: 'v1', script: 'prefetched' })
        expect((await navigation).script).toBe('prefetched')
        expect(fetchDetail).toHaveBeenCalledTimes(1)
        expect(fetchStatus).not.toHaveBeenCalled()
        await loader.load('2')
        expect(fetchStatus).toHaveBeenCalledTimes(1)
    })

    it('hands a completed prefetch to the page without another network request', async () => {
        const { loader, fetchDetail, fetchStatus } = setup()
        const prefetched = await loader.prefetch('2')
        expect(await loader.load('2')).toBe(prefetched)
        expect(fetchDetail).toHaveBeenCalledTimes(1)
        expect(fetchStatus).not.toHaveBeenCalled()
        // A later visit still checks the server instead of trusting the old prefetch forever.
        await loader.load('2')
        expect(fetchStatus).toHaveBeenCalledTimes(1)
    })

    it('revisits an unchanged episode using only its lightweight status', async () => {
        const { loader, fetchDetail, fetchStatus } = setup()
        const first = await loader.load('1')
        expect(await loader.load('1')).toBe(first)
        expect(fetchDetail).toHaveBeenCalledTimes(1)
        expect(fetchStatus).toHaveBeenCalledWith('1')
    })

    it('waits for fresh details after a reset instead of returning stale media', async () => {
        const { loader, fetchDetail, fetchStatus } = setup()
        await loader.load('1')
        fetchStatus.mockResolvedValueOnce({ id: '1', version: 'v2' })
        fetchDetail.mockResolvedValueOnce({ id: '1', statusVersion: 'v2', script: 'reset' })
        expect((await loader.load('1')).script).toBe('reset')
        expect(fetchDetail).toHaveBeenCalledTimes(2)
    })

    it('revalidates an expired prefetch and periodically reloads non-versioned details', async () => {
        vi.useFakeTimers()
        const { loader, fetchDetail, fetchStatus } = setup()
        await loader.prefetch('1')
        vi.advanceTimersByTime(5_001)
        await loader.load('1')
        expect(fetchStatus).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(120_000)
        await loader.load('1')
        expect(fetchDetail).toHaveBeenCalledTimes(2)
        expect(fetchStatus).toHaveBeenCalledTimes(1)
    })

    it('never lets an older prefetch overwrite a refresh after mutation', async () => {
        const { loader, fetchDetail } = setup()
        const old = deferred<Awaited<ReturnType<typeof fetchDetail>>>()
        fetchDetail.mockReturnValueOnce(old.promise)
        const prefetch = loader.prefetch('1')
        await Promise.resolve()
        fetchDetail.mockResolvedValueOnce({ id: '1', statusVersion: 'v1', script: 'saved' })
        await loader.refresh('1')
        old.resolve({ id: '1', statusVersion: 'v1', script: 'old' })
        await prefetch
        expect((await loader.load('1')).script).toBe('saved')
    })

    it('does not confuse out-of-order responses from rapid episode switches', async () => {
        const { loader, fetchDetail } = setup()
        const first = deferred<Awaited<ReturnType<typeof fetchDetail>>>()
        fetchDetail.mockReturnValueOnce(first.promise)
        const one = loader.load('1')
        const two = loader.load('2')
        expect((await two).id).toBe('2')
        first.resolve({ id: '1', statusVersion: 'v1', script: 'first' })
        expect((await one).id).toBe('1')
        expect((await loader.load('2')).id).toBe('2')
    })

    it('retries a failed speculative request when the user navigates', async () => {
        const { loader, fetchDetail } = setup()
        fetchDetail.mockRejectedValueOnce(new Error('temporarily unavailable'))
        await expect(loader.prefetch('1')).rejects.toThrow('temporarily unavailable')
        expect((await loader.load('1')).id).toBe('1')
        expect(fetchDetail).toHaveBeenCalledTimes(2)
    })

    it('does not display cached content after access validation fails', async () => {
        const { loader, fetchDetail, fetchStatus } = setup()
        await loader.load('1')
        fetchStatus.mockRejectedValueOnce(new Error('forbidden'))
        await expect(loader.load('1')).rejects.toThrow('forbidden')
        expect(fetchDetail).toHaveBeenCalledTimes(1)
    })

    it('falls back to full details for older servers without a revision', async () => {
        const { loader, fetchDetail, fetchStatus } = setup()
        fetchDetail.mockResolvedValueOnce({ id: '1', statusVersion: '', script: 'legacy' })
        await loader.load('1')
        await loader.load('1')
        expect(fetchDetail).toHaveBeenCalledTimes(2)
        expect(fetchStatus).not.toHaveBeenCalled()
    })

    it('bounds large cached episode payloads', async () => {
        const { loader, fetchDetail } = setup()
        for (let id = 1; id <= 9; id++) await loader.load(String(id))
        await loader.load('1')
        expect(fetchDetail).toHaveBeenCalledTimes(10)
    })

    it('never reuses a prefetch across login sessions', async () => {
        const { fetchDetail, fetchStatus } = setup()
        let scope = 'first-session'
        const loader = createEpisodeNavigationLoader({ fetchDetail, fetchStatus, getScope: () => scope })
        await loader.prefetch('1')
        scope = 'second-session'
        await loader.load('1')
        expect(fetchDetail).toHaveBeenCalledTimes(2)
        expect(fetchStatus).not.toHaveBeenCalled()
    })

    it('rejects an old in-flight response after the user signs out', async () => {
        const { fetchDetail, fetchStatus } = setup()
        let scope: string | null = 'signed-in'
        const response = deferred<Awaited<ReturnType<typeof fetchDetail>>>()
        fetchDetail.mockReturnValueOnce(response.promise)
        const loader = createEpisodeNavigationLoader({ fetchDetail, fetchStatus, getScope: () => scope })
        const request = loader.prefetch('1')
        scope = null
        response.resolve({ id: '1', statusVersion: 'v1', script: 'private' })
        await expect(request).rejects.toThrow('登录状态已失效')
    })
})
