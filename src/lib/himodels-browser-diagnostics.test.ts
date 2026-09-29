import { afterEach, describe, expect, it, vi } from 'vitest'
import { logHiModelsDiagnosticEvent } from './himodels-browser-diagnostics'
import { clientFetch } from './client-fetch'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('HiModels browser console', () => {
    it('pairs requests and responses without reporting consumption at submission', () => {
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})
        const common = { id: 'browser-pair', model: 'gemini-3.7-flash', method: 'POST', url: '/v1/chat/completions', timestamp: '', truncated: false }
        logHiModelsDiagnosticEvent({ ...common, phase: 'request', body: { model: 'gemini-3.7-flash' } })
        expect(log.mock.calls[0][0]).toContain('[HiModels Request]')
        expect(log.mock.calls[0][2]).not.toHaveProperty('tokenUsageReturned')
        const response = {
            ...common,
            phase: 'response' as const,
            status: 200,
            body: { usage: { input_tokens: 0, output_tokens: 0, prompt_tokens: 13890, completion_tokens: 2520, total_tokens: 16410 } }
        }
        logHiModelsDiagnosticEvent(response)
        logHiModelsDiagnosticEvent(response)
        expect(log).toHaveBeenCalledTimes(2)
        expect(log.mock.calls[1][2]).toMatchObject({ inputTokens: 13890, outputTokens: 2520, totalTokens: 16410 })
    })

    it('deduplicates live feed and persisted outline responses without logging aggregate usage', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://studio.test', pathname: '/zh/projects' }, dispatchEvent: vi.fn() })
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})
        const body = { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }
        logHiModelsDiagnosticEvent({ id: 'cross-feed-call', phase: 'response', model: 'model', method: 'POST', url: '/v1/chat/completions', timestamp: '', truncated: false, body, status: 200 })
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                Response.json({
                    success: true,
                    data: {
                        id: 'cross-feed-job',
                        phase: 'done',
                        tokenUsage: { source: 'himodels', inputTokens: 10, outputTokens: 2, totalTokens: 12, complete: true, missingUsageCalls: 0 },
                        himodelsResponses: [{ id: 'cross-feed-call', model: 'model', status: 200, response: body }]
                    }
                })
            )
        )
        const response = await clientFetch('/api/ai/outline/status/cross-feed-job')
        expect((await response.json()).data.tokenUsage).toMatchObject({ inputTokens: 10, outputTokens: 2, totalTokens: 12, complete: true })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(log).toHaveBeenCalledTimes(1)
        expect(log.mock.calls[0][0]).toContain('[HiModels Raw Response]')
    })
})
