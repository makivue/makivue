import { afterEach, describe, expect, it, vi } from 'vitest'

const toastMocks = vi.hoisted(() => ({ pushToast: vi.fn() }))

vi.mock('@/components/Toast', () => ({ pushToast: toastMocks.pushToast }))

import { clientFetch, isRequestAbortError, readApiJson } from './client-fetch'
import { WALLET_BALANCE_INVALIDATED_EVENT, WALLET_RECHARGE_REQUIRED_EVENT } from './wallet-gate'

afterEach(() => {
    vi.unstubAllGlobals()
    toastMocks.pushToast.mockClear()
})

describe('clientFetch rate-limit feedback', () => {
    it('shows one deduplicated toast when requests receive 429', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '10' } }))
        )

        await clientFetch('/api/create/image', { method: 'POST' })
        await clientFetch('/api/create/video', { method: 'POST' })

        expect(toastMocks.pushToast).toHaveBeenCalledTimes(1)
        expect(toastMocks.pushToast).toHaveBeenCalledWith('error', '图片/视频生成请求过于频繁，请稍后再试。')
    })

    it('allows a caller with its own retry notice to suppress the global toast', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 429 }))
        )

        await clientFetch('/api/storyboards/42/images/generate', {
            method: 'POST',
            suppressRateLimitToast: true
        })

        expect(toastMocks.pushToast).not.toHaveBeenCalled()
    })
})

describe('clientFetch wallet feedback', () => {
    it('notifies the global recharge prompt when the API rejects an unfunded action', async () => {
        const message = '余额不足，本次生成预计需要 120 积分'
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { pathname: '/zh' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ success: false, error: message }), { status: 402, headers: { 'content-type': 'application/json' } }))
        )

        const response = await clientFetch('/api/projects', { method: 'POST' })

        expect(response.status).toBe(402)
        await vi.waitFor(() => {
            expect(dispatchEvent).toHaveBeenCalledTimes(1)
            expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: WALLET_RECHARGE_REQUIRED_EVENT, detail: { message } })
        })
    })

    it.each([
        {
            label: 'text job',
            url: '/api/ai/outline/status/job-wallet-text',
            payload: { success: true, data: { id: 'job-wallet-text', phase: 'error', error: '可用金币不足，本次模型调用需要预留 120 金币，完成后按实际费用结算' } }
        },
        {
            label: 'image job',
            url: '/api/create/image/status/job-wallet-image',
            payload: { success: true, data: { id: 'job-wallet-image', phase: 'error', error: '积分不足，本次生成预计需要 40 积分' } }
        },
        {
            label: 'scene batch child',
            url: '/api/projects/1/scene-references/status/job-wallet-scene',
            payload: { success: true, data: { id: 'job-wallet-scene', phase: 'generating', items: [{ jobId: 'scene-child', phase: 'error', error: '可用金币不足' }] } }
        }
    ])('notifies when a background $label reports insufficient coins in a successful polling response', async ({ url, payload }) => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/zh' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }))
        )

        await clientFetch(url)

        await vi.waitFor(() => {
            const rechargeEvent = dispatchEvent.mock.calls.map(call => call[0]).find(event => event.type === WALLET_RECHARGE_REQUIRED_EVENT)
            expect(rechargeEvent?.detail?.message).toMatch(/(?:金币不足|积分不足)/)
        })
    })

    it('notifies when a video status endpoint returns a stored insufficient-coins failure with a non-402 status', async () => {
        const message = '可用金币不足，本次模型调用需要预留 800 金币，完成后按实际费用结算'
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/zh' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ success: false, error: message }), { status: 409, headers: { 'content-type': 'application/json' } }))
        )

        await clientFetch('/api/create/video/status?jobId=job-wallet-video')

        await vi.waitFor(() => {
            const rechargeEvent = dispatchEvent.mock.calls.map(call => call[0]).find(event => event.type === WALLET_RECHARGE_REQUIRED_EVENT)
            expect(rechargeEvent?.detail).toEqual({ message })
        })
    })

    it('does not reopen the prompt for an old snapshot failure, but detects a newly failed storyboard generation', async () => {
        const message = '可用金币不足，本次模型调用需要预留 900 金币，完成后按实际费用结算'
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/projects/1' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            success: true,
                            data: {
                                id: 'episode-wallet-failure',
                                storyboards: [{ id: 'shot-wallet-old', videoStatus: 'failed', latestErrors: { video: { errorMsg: message, createdAt: '2026-09-15T06:00:00.000Z' } } }]
                            }
                        }),
                        { headers: { 'content-type': 'application/json' } }
                    )
                )
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            success: true,
                            data: {
                                id: 'episode-wallet-failure',
                                storyboards: [
                                    { id: 'shot-wallet-old', videoStatus: 'failed', latestErrors: { video: { errorMsg: message, createdAt: '2026-09-15T06:00:00.000Z' } } },
                                    { id: 'shot-wallet-new', videoStatus: 'failed', latestErrors: { video: { errorMsg: message, createdAt: '2026-09-16T06:00:00.000Z' } } }
                                ]
                            }
                        }),
                        { headers: { 'content-type': 'application/json' } }
                    )
                )
        )

        await clientFetch('/api/episodes/episode-wallet-failure')
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(dispatchEvent.mock.calls.some(call => call[0].type === WALLET_RECHARGE_REQUIRED_EVENT)).toBe(false)

        await clientFetch('/api/episodes/episode-wallet-failure')
        await vi.waitFor(() => expect(dispatchEvent.mock.calls.some(call => call[0].type === WALLET_RECHARGE_REQUIRED_EVENT)).toBe(true))
    })

    it('does not treat generated story text mentioning insufficient coins as a wallet failure', async () => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/zh' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ success: true, data: { id: 'job-story-dialogue', phase: 'done', result: { content: '角色说：“我的金币不足，怎么办？”' } } }), {
                        headers: { 'content-type': 'application/json' }
                    })
            )
        )

        await clientFetch('/api/ai/script/status/job-story-dialogue')
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(dispatchEvent.mock.calls.some(call => call[0].type === WALLET_RECHARGE_REQUIRED_EVENT)).toBe(false)
    })

    it('invalidates the displayed balance after a synchronous billed action succeeds', async () => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/projects/1' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
        )

        await clientFetch('/api/storyboards/42/split-action', { method: 'POST' })
        await Promise.resolve()

        expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: WALLET_BALANCE_INVALIDATED_EVENT }))
    })

    it('waits for an accepted asynchronous job to finish before invalidating the balance', async () => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/projects/1' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }))
        )

        await clientFetch('/api/ai/outline', { method: 'POST' })
        await Promise.resolve()

        expect(dispatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: WALLET_BALANCE_INVALIDATED_EVENT }))
    })

    it.each(['/api/ai/outline/status/job-wallet-refresh', '/api/projects/1/scene-references/status/scene-wallet-refresh'])('invalidates the displayed balance when %s finishes', async url => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/projects/1' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'job-wallet-refresh', phase: 'done' } }), { headers: { 'content-type': 'application/json' } }))
        )

        await clientFetch(url)
        await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: WALLET_BALANCE_INVALIDATED_EVENT })))
    })

    it('invalidates the balance when media in a polled episode newly completes', async () => {
        const dispatchEvent = vi.fn()
        vi.stubGlobal('window', { location: { origin: 'https://example.com', pathname: '/projects/1' }, dispatchEvent })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({ success: true, data: { id: 'episode-wallet-refresh', storyboards: [{ id: 'shot-1', videoStatus: 'generating' }] } }), {
                        headers: { 'content-type': 'application/json' }
                    })
                )
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({ success: true, data: { id: 'episode-wallet-refresh', storyboards: [{ id: 'shot-1', videoStatus: 'completed', videoUrl: 'https://cdn.example/video.mp4' }] } }),
                        { headers: { 'content-type': 'application/json' } }
                    )
                )
        )

        await clientFetch('/api/episodes/episode-wallet-refresh')
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(dispatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: WALLET_BALANCE_INVALIDATED_EVENT }))

        await clientFetch('/api/episodes/episode-wallet-refresh')
        await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: WALLET_BALANCE_INVALIDATED_EVENT })))
    })
})

describe('readApiJson', () => {
    it('turns an empty server error into a useful message', async () => {
        const response = new Response(null, { status: 500 })

        await expect(readApiJson(response)).rejects.toThrow(/HTTP 500/)
    })

    it('parses normal JSON API responses', async () => {
        const response = new Response(JSON.stringify({ success: true, data: { id: '1' } }), {
            headers: { 'content-type': 'application/json' }
        })

        await expect(readApiJson(response)).resolves.toEqual({ success: true, data: { id: '1' } })
    })
})

describe('isRequestAbortError', () => {
    it.each([
        new DOMException('The operation was aborted.', 'AbortError'),
        new DOMException('The operation timed out.', 'TimeoutError'),
        Object.assign(new Error('The user aborted a request.'), { name: 'TypeError' })
    ])('recognizes browser cancellation variants', error => {
        expect(isRequestAbortError(error)).toBe(true)
    })

    it('does not hide real request failures', () => {
        expect(isRequestAbortError(new Error('/api/episodes/42 500: database unavailable'))).toBe(false)
    })
})
