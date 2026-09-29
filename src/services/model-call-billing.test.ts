import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiModelsUsageCall } from '@/lib/himodels-token-usage'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prepareModelCallBilling, finishModelCallBilling } from './model-call-billing'
import { fetchMeteredProvider } from '@/lib/provider-token-usage.server'
import { fetchHiModels } from './himodels-http'

const mocks = vi.hoisted(() => ({ previous: vi.fn(), fx: vi.fn(), release: vi.fn(), start: vi.fn(), finish: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { hiModelsCall: { findFirst: mocks.previous } } }))
vi.mock('./fx-rates', () => ({ RATE_SCALE: 1_000_000, getFxRate: mocks.fx }))
vi.mock('./wallet-reservations', () => ({ releaseModelReservations: mocks.release }))
vi.mock('@/lib/himodels-usage-ledger.server', async original => ({
    ...(await original<typeof import('@/lib/himodels-usage-ledger.server')>()),
    startHiModelsUsage: mocks.start,
    finishHiModelsUsage: mocks.finish
}))

const url = 'https://api.himodels.ai/v1/chat/completions'
const call = (model = 'gemini-3.7-flash'): HiModelsUsageCall => ({ id: 'call-1', model, provider: 'himodels', usage: null, operationKey: 'operation-1', endpoint: '/v1/chat/completions' })
const request = { method: 'POST', body: JSON.stringify({ model: 'gemini-3.7-flash', messages: [{ role: 'user', content: 'boat' }], max_tokens: 100 }) }
const scoped = <T>(fn: () => T) => withHiModelsUsageScope({ userId: 1n, jobId: '2' }, fn)

beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('WALLET_BILLING_ENABLED', 'true')
    vi.stubEnv('MODEL_COST_RATES_JSON', '')
    mocks.fx.mockResolvedValue(1_000_000)
    mocks.start.mockResolvedValue(4n)
    mocks.finish.mockResolvedValue(undefined)
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('model call financial boundary', () => {
    describe.each(['direct', 'himodels'] as const)('%s transport failures', transport => {
        const dispatch = (init: RequestInit) =>
            scoped(() =>
                transport === 'himodels' ? fetchHiModels(url, init, { model: 'gemini-3.7-flash', apiKey: '' }) : fetchMeteredProvider(url, init, { provider: 'himodels', model: 'gemini-3.7-flash' })
            )

        it.each(['network', 'body'] as const)('excludes an unreadable %s response without inventing a supplier cost or retrying', async failureStage => {
            const failure = new Error('inspection connection lost')
            const fetch = vi.fn()
            if (failureStage === 'network') fetch.mockRejectedValue(failure)
            else fetch.mockResolvedValue(new Response(new ReadableStream({ start: controller => controller.error(failure) })))
            vi.stubGlobal('fetch', fetch)
            await expect(dispatch(request)).rejects.toBe(failure)
            expect(fetch).toHaveBeenCalledOnce()
            expect(mocks.finish).toHaveBeenCalledWith(4n, expect.objectContaining({ billing: expect.objectContaining({ state: 'failed', costUsd: null }) }))
            expect(mocks.release).toHaveBeenCalledOnce()
        })

        it('keeps a failed poll reservation available for a later successful video response', async () => {
            const submit = call('seedance-2.0-global')
            await scoped(() => prepareModelCallBilling(submit, 1n, url, { method: 'POST', body: JSON.stringify({ duration: 6, resolution: '720p' }) }))
            mocks.previous.mockResolvedValue({ billing: submit.billing })
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('poll timed out')))
            await expect(dispatch({})).rejects.toThrow('poll timed out')
            expect(mocks.finish).toHaveBeenCalledWith(4n, expect.objectContaining({ billing: submit.billing }))
            expect(mocks.release).not.toHaveBeenCalled()
        })

        it('retains a shared reservation when an idempotent attempt disconnects', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection lost')))
            await expect(dispatch({ ...request, headers: { 'Idempotency-Key': 'shared-image' } })).rejects.toThrow('connection lost')
            expect(mocks.finish).toHaveBeenCalledWith(4n, expect.objectContaining({ billing: expect.objectContaining({ state: 'failed', costUsd: null }) }))
            expect(mocks.release).not.toHaveBeenCalled()
        })
    })
    it('rejects a missing job or missing independent price before dispatch', async () => {
        const fetchImpl = vi.fn()
        await expect(withHiModelsUsageScope({ userId: 1n }, () => fetchMeteredProvider(url, request, { provider: 'himodels', model: 'gemini-3.7-flash', fetchImpl }))).rejects.toMatchObject({
            status: 503
        })
        await expect(scoped(() => fetchMeteredProvider(url, request, { provider: 'himodels', model: 'unknown-model-fixture', fetchImpl }))).rejects.toMatchObject({ status: 503 })
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(mocks.start).not.toHaveBeenCalled()
    })
    it('does not send the request if atomic reserve/ledger creation fails', async () => {
        mocks.start.mockRejectedValue(new Error('insufficient balance'))
        const fetchImpl = vi.fn()
        await expect(scoped(() => fetchMeteredProvider(url, request, { provider: 'himodels', model: 'gemini-3.7-flash', fetchImpl }))).rejects.toThrow('insufficient balance')
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(mocks.start.mock.calls[0][2]).toBeGreaterThan(0)
    })
    it('reuses a price snapshot on poll without reserving or repricing', async () => {
        const submit = call('seedance-2.0-global')
        await scoped(() => prepareModelCallBilling(submit, 1n, url, { method: 'POST', body: JSON.stringify({ duration: 6, resolution: '720p' }) }))
        mocks.previous.mockResolvedValue({ billing: submit.billing })
        mocks.fx.mockRejectedValue(new Error('must use original exchange rate'))
        const poll = call('seedance-2.0-global')
        expect(await scoped(() => prepareModelCallBilling(poll, 1n, `${url}/task`, {}))).toBeUndefined()
        expect(poll.billing).toEqual(submit.billing)
        poll.endpoint = '/v1/video/generations/:taskId'
        poll.status = 502
        await finishModelCallBilling(poll, 1n, { error: 'gateway query failed' })
        expect(poll.billing?.state).toBe('pending')
        expect(mocks.release).not.toHaveBeenCalled()
        poll.status = 200
        await finishModelCallBilling(poll, 1n, { status: 'completed', usage: { completion_tokens: 100000 } })
        expect(poll.billing).toMatchObject({ state: 'priced', costUsd: 0.7 })
    })
    it('never adopts another job reservation for the same user', async () => {
        mocks.previous.mockResolvedValue({ billing: { scopeKey: 'job:999' } })
        await expect(scoped(() => prepareModelCallBilling(call(), 1n, url, {}))).rejects.toMatchObject({ status: 409 })
    })
    it('does not free a shared idempotency reservation on a retry failure', async () => {
        const first = call(),
            retry = call()
        const init = { ...request, headers: { 'Idempotency-Key': 'image-attempt-1' } }
        await scoped(() => prepareModelCallBilling(first, 1n, url, init))
        await scoped(() => prepareModelCallBilling(retry, 1n, url, init))
        expect(first.billing?.reservationKey).toBe(retry.billing?.reservationKey)
        retry.status = 500
        await finishModelCallBilling(retry, 1n, { error: 'upstream' })
        expect(mocks.release).not.toHaveBeenCalled()
        expect(retry.billing?.state).toBe('failed')
    })
    it('captures supplier cost before returning the usable response', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage: { prompt_tokens: 1495, completion_tokens: 2663 } })))
        const response = await scoped(() => fetchMeteredProvider(url, request, { provider: 'himodels', model: 'gemini-3.7-flash', fetchImpl }))
        expect(await response.json()).toHaveProperty('usage.prompt_tokens', 1495)
        expect(mocks.finish).toHaveBeenCalledWith(4n, expect.objectContaining({ billing: expect.objectContaining({ state: 'priced', costUsd: 0.0262095 }) }))
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
    it('prices a delivered Seedream image without requiring a token usage field', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: ['https://images.example/cup.png'] })))
        const response = await scoped(() =>
            fetchMeteredProvider(
                'https://api.himodels.ai/v1/images/generations',
                { method: 'POST', body: JSON.stringify({ model: 'seedream-5-0-lite', prompt: 'cup' }) },
                {
                    provider: 'himodels',
                    model: 'seedream-5-0-lite',
                    fetchImpl
                }
            )
        )
        expect(await response.json()).toEqual({ images: ['https://images.example/cup.png'] })
        expect(mocks.finish).toHaveBeenCalledWith(4n, expect.objectContaining({ billing: expect.objectContaining({ state: 'priced', costUsd: 0.04 }) }))
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
})
