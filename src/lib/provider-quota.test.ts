import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithProviderQuota } from './provider-quota'
import { tryAcquireProviderQuota, renewProviderQuota, releaseProviderQuota } from './provider-quota-store'

vi.mock('./provider-quota-store', () => ({ tryAcquireProviderQuota: vi.fn(), renewProviderQuota: vi.fn(), releaseProviderQuota: vi.fn() }))
const acquire = vi.mocked(tryAcquireProviderQuota)
const renew = vi.mocked(renewProviderQuota)
const release = vi.mocked(releaseProviderQuota)
const url = 'https://supplier.example/v1/images'
const init = { method: 'POST', headers: { authorization: 'test' } }
const context = (fetchImpl: typeof fetch) => ({ provider: 'himodels' as const, model: 'image-test', fetchImpl })

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('PROVIDER_QUOTA_ENABLED', '1')
    vi.stubEnv('PROVIDER_QUOTAS_JSON', '')
    vi.stubEnv('PROVIDER_QUOTA_WAIT_MS', '120000')
    vi.clearAllMocks()
    acquire.mockResolvedValue({ ids: [1n, 2n], retryAfterMs: 0 })
    renew.mockResolvedValue(true)
    release.mockResolvedValue(undefined)
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('provider quota dispatch', () => {
    it('waits for shared capacity before any HTTP request', async () => {
        acquire.mockResolvedValueOnce({ ids: [], retryAfterMs: 2000 })
        const dispatch = vi.fn().mockResolvedValue(new Response('ok'))
        const pending = fetchWithProviderQuota(url, init, context(dispatch))
        await vi.advanceTimersByTimeAsync(1000)
        expect(dispatch).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1500)
        expect(await (await pending).text()).toBe('ok')
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(release).toHaveBeenCalledWith([1n, 2n])
    })

    it('removes cancelled local waiters without blocking following requests', async () => {
        acquire.mockResolvedValueOnce({ ids: [], retryAfterMs: 2000 })
        const dispatch = vi.fn().mockImplementation(() => Promise.resolve(new Response('ok')))
        const first = fetchWithProviderQuota(url, init, context(dispatch))
        const abort = new AbortController()
        const cancelled = fetchWithProviderQuota(url, { ...init, signal: abort.signal }, context(dispatch))
        const rejected = expect(cancelled).rejects.toThrow('cancelled')
        abort.abort(new Error('cancelled'))
        await rejected
        const third = fetchWithProviderQuota(url, init, context(dispatch))
        await vi.advanceTimersByTimeAsync(2500)
        await Promise.all([first, third])
        expect(dispatch).toHaveBeenCalledTimes(2)
    })

    it('holds and renews the lease until the response body finishes', async () => {
        let stream!: ReadableStreamDefaultController<Uint8Array>
        const dispatch = vi.fn().mockResolvedValue(
            new Response(
                new ReadableStream({
                    start(controller) {
                        stream = controller
                    }
                })
            )
        )
        const pending = fetchWithProviderQuota(url, init, context(dispatch))
        await vi.advanceTimersByTimeAsync(15000)
        expect(renew).toHaveBeenCalledWith([1n, 2n])
        expect(release).not.toHaveBeenCalled()
        stream.enqueue(new TextEncoder().encode('ok'))
        stream.close()
        expect(await (await pending).text()).toBe('ok')
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('aborts on lost lease and preserves HTTP status for body-error billing', async () => {
        renew.mockResolvedValue(false)
        const dispatch = vi.fn().mockImplementation((_url, request: RequestInit) =>
            Promise.resolve(
                new Response(
                    new ReadableStream({
                        start(stream) {
                            request.signal!.addEventListener('abort', () => stream.error(request.signal!.reason))
                        }
                    }),
                    { status: 200, headers: { 'x-request-id': 'supplier-call' } }
                )
            )
        )
        const pending = fetchWithProviderQuota(url, init, context(dispatch))
        await vi.advanceTimersByTimeAsync(15000)
        const response = await pending
        expect(response.status).toBe(200)
        expect(response.headers.get('x-request-id')).toBe('supplier-call')
        await expect(response.arrayBuffer()).rejects.toThrow('租约')
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('releases after network failure and never fails successful calls on release errors', async () => {
        const failed = vi.fn().mockRejectedValue(new Error('network'))
        await expect(fetchWithProviderQuota(url, init, context(failed))).rejects.toThrow('network')
        expect(release).toHaveBeenCalledTimes(1)
        release.mockRejectedValueOnce(new Error('database'))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const success = vi.fn().mockResolvedValue(new Response('paid result'))
        expect(await (await fetchWithProviderQuota(url, init, context(success))).text()).toBe('paid result')
        expect(success).toHaveBeenCalledTimes(1)
    })
})
