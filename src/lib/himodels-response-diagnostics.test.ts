import { afterEach, describe, expect, it, vi } from 'vitest'
import { hiModelsResponseDiagnosticsEnabled, HIMODELS_RAW_RESPONSE_MAX_CHARS, sanitizeHiModelsRawResponse } from './himodels-response-diagnostics'

afterEach(() => vi.unstubAllEnvs())

describe('HiModels raw response privacy', () => {
    it('keeps provider content and token details intact but strips secrets', () => {
        const payload = {
            choices: [{ message: { content: 'hello fake-provider-key' } }],
            usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, completion_tokens_details: { reasoning_tokens: 5 } },
            usageMetadata: { candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 34 }] },
            nested: { api_key: 'other-key', access_token: 'private', authorization: 'Bearer credential' }
        }
        const result = sanitizeHiModelsRawResponse(payload, 'fake-provider-key')

        expect(result.truncated).toBe(false)
        expect(result.response).toEqual({
            ...payload,
            choices: [{ message: { content: 'hello [REDACTED]' } }],
            nested: { api_key: '[REDACTED]', access_token: '[REDACTED]', authorization: '[REDACTED]' }
        })
        expect(payload.choices[0].message.content).toBe('hello fake-provider-key')
    })

    it('redacts credentials from plain-text errors too', () => {
        expect(sanitizeHiModelsRawResponse('Failed for fake-provider-key, Bearer another-credential', 'fake-provider-key').response).toBe('Failed for [REDACTED], Bearer [REDACTED]')
    })

    it('explicitly labels oversized responses rather than silently changing them', () => {
        const result = sanitizeHiModelsRawResponse({ choices: [{ message: { content: 'x'.repeat(HIMODELS_RAW_RESPONSE_MAX_CHARS + 10) } }] }, '')
        expect(result.truncated).toBe(true)
        expect(JSON.stringify(result.response)).toContain('[TRUNCATED:')
        expect(JSON.stringify(result.response).length).toBeLessThan(HIMODELS_RAW_RESPONSE_MAX_CHARS + 100)
    })

    it('summarizes image Base64 and long prompts without dropping later usage fields', () => {
        const usage = { prompt_tokens: 13890, completion_tokens: 2520, total_tokens: 16410 }
        const result = sanitizeHiModelsRawResponse(
            {
                candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'A'.repeat(400_000) } }] } }],
                choices: [{ message: { content: '长'.repeat(400_000) } }],
                usage
            },
            ''
        )
        expect(result.truncated).toBe(true)
        expect(result.response).toMatchObject({ usage })
        expect(JSON.stringify(result.response)).toContain('BINARY OMITTED')
        expect(JSON.stringify(result.response)).toContain('TRUNCATED')
    })

    it('allows disabling development diagnostics and requires a production opt-in', () => {
        vi.stubEnv('NODE_ENV', 'development')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', '')
        expect(hiModelsResponseDiagnosticsEnabled()).toBe(true)
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'false')
        expect(hiModelsResponseDiagnosticsEnabled()).toBe(false)
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', '')
        expect(hiModelsResponseDiagnosticsEnabled()).toBe(false)
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        expect(hiModelsResponseDiagnosticsEnabled()).toBe(true)
    })
})
