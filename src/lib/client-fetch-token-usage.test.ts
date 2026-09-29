import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientFetch, extractApiTokenUsage } from './client-fetch'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('browser API token usage diagnostics', () => {
    it('prints each raw outline response once, including batches received before job completion', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})
        const first = {
            id: 'raw-outline-call-1',
            model: 'gemini-3.7-flash',
            status: 200,
            response: { choices: [{ message: { content: '{"chapters":[]}' } }], usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 } }
        }
        const second = { id: 'raw-outline-call-2', model: first.model, status: 200, response: { choices: [{ message: { content: 'second batch' } }] } }
        const read = async (phase: string, responses: unknown[], suffix = '') => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ success: true, data: { id: 'raw-outline-job', phase, himodelsResponses: responses } }), { headers: { 'content-type': 'application/json' } })
            )
            await clientFetch(`/api/ai/outline/status/raw-outline-job${suffix}`)
            await new Promise(resolve => setTimeout(resolve, 0))
        }

        await read('generating', [first])
        await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1))
        expect(log).toHaveBeenNthCalledWith(1, expect.stringContaining('[HiModels Raw Response]'), first.response, expect.objectContaining({ callId: first.id, tokenUsageReturned: true }))
        await read('generating', [first], '?__retry=1')
        expect(log).toHaveBeenCalledTimes(1)
        await read('done', [first, second])
        await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2))
        expect(log).toHaveBeenNthCalledWith(2, expect.stringContaining('raw-outline-call-2'), second.response, expect.objectContaining({ tokenUsageReturned: false }))
        await read('done', [first, second])
        expect(log).toHaveBeenCalledTimes(2)
    })

    it('prints upstream error responses even when the outline job fails', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        const upstream = { error: { message: 'route unavailable' } }
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            success: true,
                            data: {
                                id: 'raw-error-job',
                                phase: 'error',
                                himodelsResponses: [{ id: 'raw-error-call', model: 'gemini-3.7-flash', status: 503, response: upstream }]
                            }
                        }),
                        { headers: { 'content-type': 'application/json' } }
                    )
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        await clientFetch('/api/ai/outline/status/raw-error-job')

        await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'), upstream, expect.objectContaining({ status: 503 })))
    })

    it('normalizes OpenAI usage returned by an API request', () => {
        expect(
            extractApiTokenUsage({
                data: {
                    usage: {
                        input_tokens: 120,
                        output_tokens: 35,
                        total_tokens: 155
                    }
                }
            })
        ).toMatchObject({ inputTokens: 120, outputTokens: 35, totalTokens: 155 })
    })

    it('normalizes Gemini usage nested in a completed job result', () => {
        expect(
            extractApiTokenUsage({
                data: {
                    result: {
                        usageMetadata: {
                            promptTokenCount: 88,
                            candidatesTokenCount: 12,
                            totalTokenCount: 100
                        }
                    }
                }
            })
        ).toMatchObject({ inputTokens: 88, outputTokens: 12, totalTokens: 100 })
    })

    it('does not mistake historical episode usage for the current request usage', () => {
        expect(
            extractApiTokenUsage({
                data: {
                    storyboards: [
                        {
                            latestHimodelsUsage: {
                                provider: 'gemini-3.1-flash-image',
                                usage: { input_tokens: 21, output_tokens: 8, total_tokens: 29 }
                            }
                        }
                    ]
                }
            })
        ).toBeNull()
    })

    it('ignores usage objects that do not contain token counters', () => {
        expect(extractApiTokenUsage({ usage: { credits: 2, billable: true } })).toBeNull()
        expect(extractApiTokenUsage({ success: true, data: { id: '1' } })).toBeNull()
    })

    it('keeps response token usage available without printing a console entry', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ data: { usage: { input_tokens: 9, output_tokens: 4 } } }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    })
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        const response = await clientFetch('/api/ai/outline', { method: 'POST' })
        expect(extractApiTokenUsage(await response.json())).toMatchObject({ inputTokens: 9, outputTokens: 4, totalTokens: 13 })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(log).not.toHaveBeenCalled()
    })

    it('does not print direct Gemini usage when an outline job completes', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            success: true,
                            data: {
                                id: 'direct-gemini-job',
                                phase: 'done',
                                tokenUsage: {
                                    source: 'gemini',
                                    providers: ['gemini'],
                                    inputTokens: 120,
                                    outputTokens: 30,
                                    totalTokens: 180,
                                    calls: 1,
                                    complete: true,
                                    missingUsageCalls: 0
                                }
                            }
                        }),
                        { headers: { 'content-type': 'application/json' } }
                    )
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        const response = await clientFetch('/api/ai/outline/status/direct-gemini-job')
        expect(extractApiTokenUsage(await response.json())).toMatchObject({ inputTokens: 120, outputTokens: 30, totalTokens: 180 })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(log).not.toHaveBeenCalled()
    })

    it('does not print direct Gemini usage when a chapter job completes', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                Response.json({
                    success: true,
                    data: {
                        id: 'direct-gemini-chapter-job',
                        phase: 'done',
                        tokenUsage: {
                            source: 'gemini',
                            providers: ['gemini'],
                            inputTokens: 800,
                            outputTokens: 200,
                            totalTokens: 1100,
                            calls: 1,
                            complete: true,
                            missingUsageCalls: 0
                        },
                        result: { episodeId: 'episode-1', chapterContent: 'chapter' }
                    }
                })
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        const response = await clientFetch('/api/ai/chapter/status/direct-gemini-chapter-job')
        expect(extractApiTokenUsage(await response.json())).toMatchObject({ inputTokens: 800, outputTokens: 200, totalTokens: 1100 })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(log).not.toHaveBeenCalled()
    })

    it('does not add token diagnostics to unrelated API calls', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ success: true, data: { id: '1' } }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    })
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        await clientFetch('/api/profile')
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(log).not.toHaveBeenCalled()
    })

    it('does not print a token log when neither usage nor provider identity is available', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ success: true, data: { id: 'job-no-usage', phase: 'done', result: { usage: { credits: 2 } } } }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    })
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        await clientFetch('/api/create/image/status/job-no-usage')
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(log).not.toHaveBeenCalled()
    })

    it('does not log a 202 submission even if its payload includes usage', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ data: { id: 'submitted', usage: { total_tokens: 100 } } }), {
                        status: 202,
                        headers: { 'content-type': 'application/json' }
                    })
            )
        )
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})

        const response = await clientFetch('/api/storyboards/shot-4/images/generate', { method: 'POST' })
        await response.json()
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(log).not.toHaveBeenCalled()
    })

    it('does not print HiModels usage for completed generations or repeated episode refreshes', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})
        const read = async (generationId: string, suffix = '') => {
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        success: true,
                        data: {
                            storyboards: [
                                {
                                    id: 'shot-4',
                                    order: 4,
                                    latestHimodelsUsage: { generationId, provider: 'seedream-5-0-lite', usage: { total_tokens: 16 } }
                                }
                            ]
                        }
                    }),
                    { headers: { 'content-type': 'application/json' } }
                )
            )
            const response = await clientFetch(`/api/episodes/console-lifecycle${suffix}`)
            await response.json()
            await new Promise(resolve => setTimeout(resolve, 0))
        }

        await read('historical-generation')
        await read('historical-generation')
        expect(log).not.toHaveBeenCalled()

        await read('completed-generation')
        expect(log).not.toHaveBeenCalled()

        await read('completed-generation', '?__retry=1')
        expect(log).not.toHaveBeenCalled()
    })
})
