// Transport/diagnostic tests isolate billing; model-call-billing tests cover the financial boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { issueSessionToken } from '@/lib/session-token'
import { hiModelsDiagnosticStore } from '@/lib/himodels-diagnostic-store.server'
import { GET } from '@/app/api/diagnostics/himodels/route'
import { fetchHiModels } from './himodels-http'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'

vi.mock('@/services/model-call-billing', () => ({ prepareModelCallBilling: vi.fn(), finishModelCallBilling: vi.fn() }))

const mocks = vi.hoisted(() => ({ headers: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/prisma', () => ({ prisma: { hiModelsCall: { create: mocks.create, update: mocks.update } } }))
vi.mock('@/lib/id', () => ({ genId: () => 1n }))

let userId = 800n
let token = ''
let since = 0
beforeEach(() => {
    vi.restoreAllMocks()
    mocks.create.mockReset().mockResolvedValue({})
    mocks.update.mockReset().mockResolvedValue({})
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
    vi.stubEnv('APP_SESSION_SECRET', 'unit-test-only-secret')
    userId += 1n
    token = issueSessionToken({ userId, email: 'test@example.test' })
    mocks.headers.mockResolvedValue(new Headers({ Authorization: `Bearer ${token}` }))
    since = Date.now()
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

function events() {
    return hiModelsDiagnosticStore.read(String(userId), null, since).events
}

describe('HiModels HTTP browser diagnostics', () => {
    it.each(['true', 'false'])('keeps a received response readable if its signal aborts during usage recording (diagnostics=%s)', async diagnostics => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', diagnostics)
        const payload = { data: [{ b64_json: 'image-fixture' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }
        let requests = 0
        const server = createServer((_request, response) => {
            requests += 1
            response.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': 'received-image' })
            response.end(JSON.stringify(payload))
        })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        try {
            const address = server.address() as { port: number }
            const controller = new AbortController()
            const url = `http://127.0.0.1:${address.port}/v1/images/generations`
            const response = await withHiModelsUsageScope({ userId, onUsage: () => controller.abort() }, () =>
                fetchHiModels(url, { method: 'POST', signal: controller.signal }, { model: 'gemini-3.1-flash-image', apiKey: '' })
            )

            expect(controller.signal.aborted).toBe(true)
            expect(response.url).toBe(url)
            expect(response.headers.get('x-request-id')).toBe('received-image')
            expect(await response.json()).toEqual(payload)
            expect(requests).toBe(1)
            expect(mocks.update).toHaveBeenCalledWith({ where: { id: 1n }, data: expect.objectContaining({ captureState: 'received', usage: expect.objectContaining({ totalTokens: 5 }) }) })
        } finally {
            server.closeAllConnections()
            await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
        }
    })

    it('does not send a paid request if the durable preflight record fails', async () => {
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)
        mocks.create.mockRejectedValue(new Error('migration missing'))
        await expect(fetchHiModels('https://himodels.test/v1/images/generations', { method: 'POST' }, { model: 'image', apiKey: '' })).rejects.toThrow('尚未调用模型')
        expect(fetch).not.toHaveBeenCalled()
    })

    it('preserves a response stream failure without reading again or resubmitting the model call', async () => {
        const failure = new Error('upstream disconnected during the response body')
        const response = new Response(new ReadableStream({ start: controller => controller.error(failure) }), { headers: { 'Content-Type': 'application/json' } })
        const fetch = vi.fn().mockResolvedValue(response)
        vi.stubGlobal('fetch', fetch)

        await expect(fetchHiModels('https://himodels.test/v1/images/generations', { method: 'POST' }, { model: 'image', apiKey: '' })).rejects.toBe(failure)
        expect(fetch).toHaveBeenCalledOnce()
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 1n }, data: expect.objectContaining({ captureState: 'body_error', httpStatus: 200 }) })
    })

    it.each([204, 304])('preserves bodyless HTTP %s responses', async status => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
        const response = await fetchHiModels('https://himodels.test/v1/video/generations/task-1', {}, { model: 'video', apiKey: '' })
        expect(response.status).toBe(status)
        expect(response.body).toBeNull()
        expect(await response.text()).toBe('')
    })

    it('captures real usage when diagnostics are disabled and before downstream parsing', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'false')
        const payload = { choices: [{ message: { content: 'invalid JSON' } }], usage: { prompt_tokens: 13890, completion_tokens: 2520, total_tokens: 16410, input_tokens: 0, output_tokens: 0 } }
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)))
        const onUsage = vi.fn()
        const response = await withHiModelsUsageScope({ userId, jobId: '2', onUsage }, () => fetchHiModels('https://himodels.test/v1/chat/completions', {}, { model: 'gemini-3.7-flash', apiKey: '' }))
        expect(await response.json()).toEqual(payload)
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId, jobId: 2n }) })
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 1n },
            data: expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 13890, outputTokens: 2520, totalTokens: 16410 }), rawUsage: { usage: payload.usage } })
        })
        expect(onUsage).toHaveBeenCalledOnce()
        expect(events()).toEqual([])
    })

    it('does not repeat upstream generation when persisting its response fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const fetch = vi.fn().mockResolvedValue(Response.json({ usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } }))
        vi.stubGlobal('fetch', fetch)
        mocks.update.mockRejectedValue(new Error('database offline'))
        const onUsage = vi.fn()
        await fetchHiModels('https://himodels.test/v1/images/generations', { method: 'POST' }, { model: 'image', apiKey: '', onUsage })
        expect(fetch).toHaveBeenCalledOnce()
        expect(mocks.update).toHaveBeenCalledTimes(3)
        expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 3 }) }))
    })

    it('records failed HTTP responses with any returned usage and marks binary/missing usage unknown', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(Response.json({ error: 'blocked', usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 } }, { status: 400 }))
                .mockResolvedValueOnce(new Response(new Uint8Array([137, 80]), { headers: { 'Content-Type': 'image/png' } }))
                .mockResolvedValueOnce(Response.json({ status: 'pending' }))
        )
        const onUsage = vi.fn()
        for (let index = 0; index < 3; index++) await fetchHiModels('https://himodels.test/v1/images/generations', {}, { model: 'image', apiKey: '', onUsage })
        expect(onUsage.mock.calls[0][0]).toMatchObject({ status: 400, usage: { totalTokens: 5 }, captureState: 'received' })
        expect(onUsage.mock.calls[1][0]).toMatchObject({ usage: null, captureState: 'binary_without_usage' })
        expect(onUsage.mock.calls[2][0]).toMatchObject({ usage: null, captureState: 'received' })
    })

    it('publishes a redacted request before dispatch and a correlated full JSON response afterward', async () => {
        let complete!: (response: Response) => void
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>(resolve => {
                    complete = resolve
                })
        )
        vi.stubGlobal('fetch', fetchMock)
        const onResponse = vi.fn()
        const pending = fetchHiModels(
            'https://himodels.test/v1/chat/completions',
            {
                method: 'POST',
                headers: { Authorization: 'Bearer test-provider-key' },
                body: JSON.stringify({ model: 'gemini-3.7-flash', messages: [{ role: 'user', content: 'outline' }] })
            },
            { model: 'gemini-3.7-flash', apiKey: 'test-provider-key', onResponse }
        )
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
        expect(events()).toHaveLength(1)
        expect(events()[0]).toMatchObject({ phase: 'request', headers: { authorization: '[REDACTED]' }, body: { model: 'gemini-3.7-flash' } })

        const payload = { choices: [{ message: { content: 'outline' } }], usage: { prompt_tokens: 13890, completion_tokens: 2520, total_tokens: 16410 } }
        complete(Response.json(payload, { headers: { 'x-request-id': 'upstream-id', 'set-cookie': 'private-cookie' } }))
        const response = await pending
        expect(await response.json()).toEqual(payload)
        expect(events()).toHaveLength(2)
        expect(events()[1]).toMatchObject({ id: events()[0].id, phase: 'response', status: 200, requestId: 'upstream-id', body: payload })
        expect(JSON.stringify(events())).not.toContain('test-provider-key')
        expect(JSON.stringify(events())).not.toContain('private-cookie')
        expect(onResponse.mock.calls[0][0]).toMatchObject({ id: events()[0].id, response: payload })
    })

    it('records every poll and preserves HTTP/non-JSON and network failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(Response.json({ status: 'processing' }))
                .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
                .mockRejectedValueOnce(new TypeError('fetch failed for test-provider-key'))
        )
        const context = { model: 'video', apiKey: 'test-provider-key' }
        await fetchHiModels('https://himodels.test/v1/video/generations/task-1', {}, context)
        const errorResponse = await fetchHiModels('https://himodels.test/v1/video/generations/task-1', {}, context)
        expect(await errorResponse.text()).toBe('bad gateway')
        await expect(fetchHiModels('https://himodels.test/v1/video/generations/task-1', {}, context)).rejects.toThrow('fetch failed')
        expect(events().map(event => event.phase)).toEqual(['request', 'response', 'request', 'response', 'request', 'error'])
        expect(
            new Set(
                events()
                    .filter(event => event.phase === 'request')
                    .map(event => event.id)
            ).size
        ).toBe(3)
        expect(events()[3]).toMatchObject({ status: 502, body: 'bad gateway' })
        expect(events()[5].body).toEqual({ name: 'TypeError', message: 'fetch failed for [REDACTED]' })
    })

    it('does not consume binary image bytes for logging', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })))
        const response = await fetchHiModels('https://himodels.test/v1/images/generations', { method: 'POST' }, { model: 'image', apiKey: '' })
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
        expect(events()[1]).toMatchObject({ phase: 'response', truncated: true, body: { diagnostic: 'BINARY OMITTED', contentType: 'image/png' } })
    })

    it('does not attribute unauthenticated or spoofed requests to a browser user', async () => {
        mocks.headers.mockResolvedValue(new Headers({ 'x-user-id': String(userId) }))
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ result: 'secret' })))
        await fetchHiModels('https://himodels.test/v1/chat/completions', {}, { model: 'text', apiKey: '' })
        expect(events()).toEqual([])
        const res = await GET(new Request(`https://studio.test/api/diagnostics/himodels?since=${since}`, { headers: { 'x-user-id': String(userId) } }))
        expect(res.status).toBe(401)
    })

    it('supports detached worker owners and isolates the authenticated feed', async () => {
        mocks.headers.mockRejectedValue(new Error('outside request scope'))
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Response.json({ result: 'my result' }))
        )
        await withHiModelsUsageScope({ userId }, () => fetchHiModels('https://himodels.test/v1/chat/completions', {}, { model: 'text', apiKey: '' }))
        const own = await GET(new Request(`https://studio.test/api/diagnostics/himodels?since=${since}`, { headers: { Authorization: `Bearer ${token}` } }))
        const ownPayload = await own.json()
        expect(ownPayload.events).toHaveLength(2)
        expect(own.headers.get('Cache-Control')).toContain('no-store')
        const otherToken = issueSessionToken({ userId: 999n, email: 'other@example.test' })
        const other = await GET(new Request(`https://studio.test/api/diagnostics/himodels?since=${since}`, { headers: { Authorization: `Bearer ${otherToken}`, 'x-user-id': String(userId) } }))
        expect((await other.json()).events).toEqual([])
    })

    it('turns off raw capture in production unless explicitly enabled', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', '')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ result: 'private' })))
        const onResponse = vi.fn()
        await fetchHiModels('https://himodels.test/v1/chat/completions', {}, { model: 'text', apiKey: '', onResponse })
        expect(events()).toEqual([])
        expect(onResponse).not.toHaveBeenCalled()
        const result = await GET(new Request(`https://studio.test/api/diagnostics/himodels?since=${since}`, { headers: { Authorization: `Bearer ${token}` } }))
        expect(await result.json()).toEqual({ enabled: false, events: [] })
    })
})
