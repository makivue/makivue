import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getGoogleAccessToken: vi.fn(),
    getGoogleAuthClient: vi.fn(),
    resetGoogleAuthCache: vi.fn()
}))

vi.mock('./banana', () => mocks)
vi.mock('./safety-diagnostics', () => ({ isSafetyDiagnosticsEnabled: vi.fn().mockResolvedValue(false) }))

import { chatGemini } from './gemini-text'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'

beforeEach(() => {
    vi.stubEnv('GEMINI_TEXT_LOCATION', '')
    mocks.getGoogleAuthClient.mockResolvedValue({ projectId: 'test-project' })
    mocks.getGoogleAccessToken.mockResolvedValue('test-token')
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('chatGemini token usage', () => {
    it('uses the configured Vertex region in both the host and resource path', async () => {
        vi.stubEnv('GEMINI_TEXT_LOCATION', 'us-central1')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] })))
        expect(await chatGemini('gemini-3.7-flash', [{ role: 'user', content: 'test' }])).toBe('ok')
        expect(fetch).toHaveBeenCalledWith(
            'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-3.7-flash:generateContent',
            expect.any(Object)
        )
    })

    it('extracts Vertex usageMetadata before returning generated text', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        candidates: [{ content: { parts: [{ text: '{"chapters":[]}' }] }, finishReason: 'STOP' }],
                        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 30, totalTokenCount: 180 }
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json', 'x-goog-request-id': 'google-request-1' } }
                )
            )
        )
        const onUsage = vi.fn()

        const result = await chatGemini('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { json: true, onUsage })

        expect(result).toBe('{"chapters":[]}')
        expect(onUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'gemini',
                model: 'gemini:gemini-3.7-flash',
                status: 200,
                requestId: 'google-request-1',
                usage: expect.objectContaining({ inputTokens: 120, outputTokens: 30, totalTokens: 180 }),
                rawUsage: { usageMetadata: expect.objectContaining({ promptTokenCount: 120, totalTokenCount: 180 }) }
            })
        )
    })

    it('reports usage to the active job scope when the caller does not pass an observer', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                Response.json({
                    candidates: [{ content: { parts: [{ text: 'chapter' }] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, totalTokenCount: 100 }
                })
            )
        )
        const onUsage = vi.fn()

        const result = await withHiModelsUsageScope({ jobId: 'chapter-job', onUsage }, () => chatGemini('gemini-3.7-flash', [{ role: 'user', content: 'chapter' }]))

        expect(result).toBe('chapter')
        expect(onUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'gemini',
                usage: expect.objectContaining({ inputTokens: 80, outputTokens: 20, totalTokens: 100 })
            })
        )
    })
})
