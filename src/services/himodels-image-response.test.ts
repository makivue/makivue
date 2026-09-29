import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: { aiServiceConfig: { findUnique: mocks.findUnique } }
}))

import { extractHiModelsGeneratedImage, generateHiModelsImage, inspectHiModelsEmptyImageResponse } from './himodels'

const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const imageBytes = Buffer.from(imageBase64, 'base64')
const imageDataUrl = `data:image/png;base64,${imageBase64}`
const imageUrl = 'https://cdn.example/generated.png'
const fakeImageBase64 = Buffer.from('generated-image').toString('base64')

function geminiInlineData(data = imageBase64) {
    return {
        candidates: [
            {
                content: {
                    role: 'model',
                    parts: [{ inlineData: { mimeType: 'image/png', data } }]
                },
                finishReason: 'STOP'
            }
        ]
    }
}

describe('HiModels generated-image response parsing', () => {
    it.each([
        ['OpenAI base64', { data: [{ b64_json: imageBase64 }] }, { base64: imageBase64 }],
        ['OpenAI URL', { data: [{ url: imageUrl }] }, { url: imageUrl }],
        ['OpenAI data URL', { data: [{ url: imageDataUrl }] }, { base64: imageBase64 }],
        ['Gemini inlineData', geminiInlineData(), { base64: imageBase64 }],
        ['Gemini inline_data', { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: imageBase64 } }] } }] }, { base64: imageBase64 }],
        ['generic images URL string', { images: [imageUrl] }, { url: imageUrl }],
        ['generic images data URL string', { images: [imageDataUrl] }, { base64: imageBase64 }],
        ['generic images object', { images: [{ url: imageUrl }] }, { url: imageUrl }],
        ['generic image MIME data', { data: imageBase64, mimeType: 'image/png' }, { base64: imageBase64 }],
        ['Vertex prediction bytes', { predictions: [{ bytesBase64Encoded: imageBase64, mimeType: 'image/png' }] }, { base64: imageBase64 }]
    ])('extracts %s responses', (_name, payload, expected) => {
        expect(extractHiModelsGeneratedImage(payload)).toEqual(expected)
    })

    it.each([
        ['response', { response: geminiInlineData() }],
        ['result', { result: { data: [{ b64_json: imageBase64 }] } }],
        ['output', { output: { images: [{ url: imageUrl }] } }]
    ])('extracts an image through a %s gateway envelope', (_name, payload) => {
        expect(extractHiModelsGeneratedImage(payload)).not.toBeNull()
    })

    it.each([
        [
            'OpenAI message images',
            {
                choices: [
                    {
                        message: {
                            images: [{ type: 'image_url', image_url: { url: imageDataUrl } }]
                        }
                    }
                ]
            }
        ],
        [
            'OpenAI message content',
            {
                choices: [
                    {
                        message: {
                            content: [{ type: 'image_url', image_url: { url: imageDataUrl } }]
                        }
                    }
                ]
            }
        ],
        [
            'OpenAI Responses image generation call',
            {
                output: [{ type: 'image_generation_call', result: imageBase64 }]
            }
        ]
    ])('extracts %s image output', (_name, payload) => {
        expect(extractHiModelsGeneratedImage(payload)).toEqual({ base64: imageBase64 })
    })

    it.each([null, undefined, '', [], {}, { data: [] }, { images: [] }, { candidates: [] }, { response: { data: [] } }])('does not mistake an empty or unrelated payload for an image: %j', payload => {
        expect(extractHiModelsGeneratedImage(payload)).toBeNull()
    })

    it('does not recursively mistake unrelated metadata URLs for generated output', () => {
        expect(
            extractHiModelsGeneratedImage({
                model: { avatarUrl: imageUrl },
                usage: { input_tokens: 100 },
                request: { referenceImageUrl: imageUrl }
            })
        ).toBeNull()
    })

    it('does not mistake a URL in provider message text for generated image output', () => {
        expect(
            extractHiModelsGeneratedImage({
                choices: [{ message: { content: 'https://docs.example/image-generation' } }]
            })
        ).toBeNull()
    })

    it('prefers actual image bytes over task and status URLs in the same response', () => {
        expect(
            extractHiModelsGeneratedImage({
                url: 'https://api.example/tasks/task-1',
                data: [{ url: 'https://api.example/tasks/task-1/status' }, { b64_json: imageBase64 }]
            })
        ).toEqual({ base64: imageBase64 })
    })

    it('does not mistake an arbitrary status string for base64 image data', () => {
        expect(extractHiModelsGeneratedImage({ images: [{ data: 'success' }] })).toBeNull()
    })

    it('does not accept decodable base64 whose bytes are not an image', () => {
        expect(extractHiModelsGeneratedImage({ data: [{ b64_json: fakeImageBase64 }] })).toBeNull()
        expect(extractHiModelsGeneratedImage({ images: [`data:image/png;base64,${fakeImageBase64}`] })).toBeNull()
    })
})

describe('HiModels empty-image response diagnosis', () => {
    it('classifies an ordinary 2xx empty result as transient and retains request identifiers', () => {
        const diagnosis = inspectHiModelsEmptyImageResponse({ data: [], request_id: 'req-empty-1', gw_trace_id: 'trace-empty-1' })

        expect(diagnosis).toMatchObject({ retryable: true, blocked: false })
        expect(diagnosis.details).toMatch(/req-empty-1/)
        expect(diagnosis.details).toMatch(/trace-empty-1/)
    })

    it('keeps Gemini finish metadata without collecting content.parts text', () => {
        const diagnosis = inspectHiModelsEmptyImageResponse({
            candidates: [
                {
                    finishReason: 'STOP',
                    finishMessage: 'The model completed without an image.',
                    content: { parts: [{ text: 'No image was generated this time.' }] }
                }
            ]
        })

        expect(diagnosis).toMatchObject({ retryable: true, blocked: false })
        expect(diagnosis.details).toMatch(/finishReason=STOP/)
        expect(diagnosis.details).toMatch(/completed without an image/i)
        expect(diagnosis.details).not.toMatch(/No image was generated/i)
    })

    it.each([
        ['prompt block', { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'Blocked by policy' } }, 'SAFETY'],
        ['candidate image safety', { candidates: [{ finishReason: 'IMAGE_SAFETY', finishMessage: 'Unsafe generated image' }] }, 'IMAGE_SAFETY'],
        ['candidate prohibited content', { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }, 'PROHIBITED_CONTENT'],
        ['candidate recitation', { candidates: [{ finishReason: 'RECITATION' }] }, 'RECITATION'],
        ['nested safety result', { response: { candidates: [{ finishReason: 'SAFETY' }] } }, 'SAFETY']
    ])('classifies %s as a definitive non-retryable block', (_name, payload, expectedReason) => {
        const diagnosis = inspectHiModelsEmptyImageResponse(payload)

        expect(diagnosis).toMatchObject({ retryable: false, blocked: true })
        expect(diagnosis.details).toContain(expectedReason)
    })

    it('classifies a 2xx payload carrying an explicit provider error as non-retryable', () => {
        const diagnosis = inspectHiModelsEmptyImageResponse({
            error: { code: 'INVALID_ARGUMENT', message: 'invalid image prompt' },
            requestId: 'req-invalid-1'
        })

        expect(diagnosis).toMatchObject({ retryable: false, blocked: false })
        expect(diagnosis.details).toMatch(/INVALID_ARGUMENT/)
        expect(diagnosis.details).toMatch(/invalid image prompt/)
        expect(diagnosis.details).toMatch(/req-invalid-1/)
    })

    it('classifies a numeric 2xx error envelope as non-retryable', () => {
        expect(inspectHiModelsEmptyImageResponse({ error_code: 500, error_msg: 'upstream failed' })).toMatchObject({ retryable: false, blocked: false })
    })

    it('treats a provider temporary-empty message as retryable while preserving its diagnosis', () => {
        const diagnosis = inspectHiModelsEmptyImageResponse({ message: 'upstream returned empty content, please retry', trace_id: 'trace-temporary-1' })

        expect(diagnosis).toMatchObject({ retryable: true, blocked: false })
        expect(diagnosis.details).toMatch(/upstream returned empty content/i)
        expect(diagnosis.details).toMatch(/trace-temporary-1/)
    })

    it.each([200, 201, 202, '201'])('does not classify a successful provider code %s as an error', code => {
        expect(inspectHiModelsEmptyImageResponse({ code, data: [] })).toMatchObject({ retryable: true, blocked: false })
    })

    it('treats a symbolic top-level error code as an explicit non-retryable error', () => {
        const diagnosis = inspectHiModelsEmptyImageResponse({
            code: 'IMAGE_GENERATION_FAILED',
            message: 'the upstream image route failed',
            request_id: 'req-symbolic-code-1'
        })

        expect(diagnosis).toMatchObject({ retryable: false, blocked: false })
        expect(diagnosis.details).toMatch(/code=IMAGE_GENERATION_FAILED/)
        expect(diagnosis.details).toMatch(/req-symbolic-code-1/)
    })

    it.each([
        ['raiFilteredReason', { raiFilteredReason: 'RESPONSIBLE_AI_POLICY' }, 'RESPONSIBLE_AI_POLICY'],
        ['filteredReason', { filteredReason: 'PROHIBITED_CONTENT' }, 'PROHIBITED_CONTENT']
    ])('recognizes %s as a non-retryable filtered response', (_name, payload, expectedReason) => {
        const diagnosis = inspectHiModelsEmptyImageResponse(payload)

        expect(diagnosis).toMatchObject({ retryable: false, blocked: true })
        expect(diagnosis.details).toContain(expectedReason)
    })

    it('redacts prompts, signed URLs and credentials without collecting model text', () => {
        const privatePrompt = 'private-character-prompt-keep-secret'
        const diagnosis = inspectHiModelsEmptyImageResponse(
            {
                request_id: 'req-redaction-1',
                error: {
                    code: 'UPSTREAM_ERROR',
                    message:
                        `Failed for ${privatePrompt}; download https://cdn.example/image.png?X-Amz-Credential=AKIA-SECRET&X-Amz-Signature=url-secret; ` +
                        `Authorization: Bearer bearer-secret-token; api_key=api-secret-value; data:image/png;base64,${imageBase64}`
                },
                content: { parts: [{ text: 'model-output-must-not-be-collected' }] }
            },
            [privatePrompt]
        )

        expect(diagnosis.details).toContain('req-redaction-1')
        expect(diagnosis.details).toContain('[redacted')
        expect(diagnosis.details).not.toContain(privatePrompt)
        expect(diagnosis.details).not.toContain('AKIA-SECRET')
        expect(diagnosis.details).not.toContain('url-secret')
        expect(diagnosis.details).not.toContain('bearer-secret-token')
        expect(diagnosis.details).not.toContain('api-secret-value')
        expect(diagnosis.details).not.toContain(imageBase64)
        expect(diagnosis.details).not.toContain('model-output-must-not-be-collected')
    })
})

describe('HiModels empty-image retry policy', () => {
    const outputPaths: string[] = []

    beforeEach(() => {
        vi.restoreAllMocks()
        vi.stubEnv('HIMODELS_DEV_API_KEY', 'test-env-key')
        vi.stubEnv('HIMODELS_SHARED_API_KEY', 'test-env-key')
        vi.stubEnv('HIMODELS_BASE_URL', 'https://himodels.test')
    })

    afterEach(async () => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
        await Promise.all(outputPaths.splice(0).map(outputPath => fs.unlink(outputPath).catch(() => undefined)))
    })

    function outputPath() {
        const value = path.join(os.tmpdir(), `himodels-response-${crypto.randomUUID()}.png`)
        outputPaths.push(value)
        return value
    }

    async function expectFileMissing(filePath: string) {
        await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    }

    async function waitForFetchCount(fetchMock: ReturnType<typeof vi.spyOn>, count: number) {
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(count), { timeout: 5_000, interval: 1 })
    }

    it('retries one transient 2xx empty response with the same selected model', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: [],
                        request_id: 'req-empty-1',
                        usage: { input_tokens: 7, output_tokens: '1', total_tokens: 8, cached: true }
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    }
                )
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        data: [{ b64_json: imageBase64 }],
                        usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14, cached: false }
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    }
                )
            )
        const generatedPath = outputPath()

        const result = await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        const submittedModels = fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).model)
        expect(submittedModels).toEqual(['gemini-3.1-flash-image', 'gemini-3.1-flash-image'])
        const submissionSignals = fetchMock.mock.calls.map(call => call[1]?.signal)
        expect(submissionSignals[0]).toBe(submissionSignals[1])
        const idempotencyKeys = fetchMock.mock.calls.map(call => new Headers(call[1]?.headers).get('Idempotency-Key'))
        expect(idempotencyKeys[0]).toMatch(/^himodels-image-/)
        expect(idempotencyKeys[1]).toBe(idempotencyKeys[0])
        expect(result.usage).toEqual({
            'usage.input_tokens': 11,
            'usage.output_tokens': 3,
            'usage.total_tokens': 14,
            'usage.cached': false
        })
        expect(await fs.readFile(generatedPath)).toEqual(imageBytes)
    })

    it('does not submit again when the operation is cancelled after an empty response', async () => {
        const controller = new AbortController()
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            controller.abort(new Error('cancelled-before-retry'))
            return new Response(JSON.stringify({ data: [], request_id: 'req-cancelled-1' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath(), signal: controller.signal })).rejects.toThrow('cancelled-before-retry')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('stops after one retry when both 2xx responses are transiently empty', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
            async () =>
                new Response(JSON.stringify({ candidates: [], request_id: 'req-still-empty' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toMatchObject({
            code: 'HIMODELS_IMAGE_EMPTY_RESPONSE',
            message: expect.stringMatching(/未返回图片内容/)
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('retries a blank 2xx response body once instead of leaking a JSON parse error', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify(geminiInlineData()), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        const generatedPath = outputPath()

        await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(await fs.readFile(generatedPath)).toEqual(imageBytes)
    })

    it('does not retry a definitive 2xx safety block', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    candidates: [{ finishReason: 'IMAGE_SAFETY', finishMessage: 'Unsafe generated image' }],
                    responseId: 'req-safety-1'
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toMatchObject({
            code: 'HIMODELS_IMAGE_SAFETY_BLOCK',
            message: expect.stringMatching(/IMAGE_SAFETY/)
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('preserves the gateway trace header in a no-image error', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', gw_trace_id: 'gateway-trace-1' }
            })
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toThrow(/gateway-trace-1/)
    })

    it('does not retry a 2xx response carrying an explicit provider error', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ error: { code: 'INVALID_ARGUMENT', message: 'invalid image prompt' }, request_id: 'req-invalid-1' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toThrow(/invalid image prompt/)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['HTTP 202 pending task', 202, { task_id: 'image-task-202', status: 'pending' }],
        ['HTTP 200 nested processing task', 200, { response: { id: 'image-task-200', status: 'processing' } }]
    ])('does not submit a second generation for an accepted %s', async (_name, status, payload) => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify(payload), {
                status,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toMatchObject({
            code: 'HIMODELS_IMAGE_ASYNC_PENDING',
            message: expect.stringMatching(/避免重复生成和重复计费/)
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it.each([500, 502, 503, 504])('does not retry a non-idempotent generation after HTTP %s', async status => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
            async () =>
                new Response(JSON.stringify({ error: { message: 'temporary upstream failure' } }), {
                    status,
                    headers: { 'Content-Type': 'application/json' }
                })
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toThrow(`失败（${status}）`)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries an exhausted HiModels price route with the same model and idempotency key', async () => {
        vi.useFakeTimers()
        const routeUnavailable = () =>
            new Response(
                JSON.stringify({
                    error: {
                        message: 'No available image provider for model: gemini-3.1-flash-image, reason=global_price_route_exhausted, skuProviderIds=[3]'
                    }
                }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(routeUnavailable())
            .mockResolvedValueOnce(routeUnavailable())
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        const generatedPath = outputPath()

        const generation = generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })
        await waitForFetchCount(fetchMock, 1)
        await vi.advanceTimersByTimeAsync(2_000)
        await waitForFetchCount(fetchMock, 2)
        await vi.advanceTimersByTimeAsync(5_000)
        await generation

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).model)).toEqual(['gemini-3.1-flash-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image'])
        const idempotencyKeys = fetchMock.mock.calls.map(call => new Headers(call[1]?.headers).get('Idempotency-Key'))
        expect(new Set(idempotencyKeys).size).toBe(1)
        expect(await fs.readFile(generatedPath)).toEqual(imageBytes)
    })

    it('reports exhausted route retries without switching the selected model', async () => {
        vi.useFakeTimers()
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        error: {
                            message: 'No available image provider for model: gemini-3.1-flash-image, reason=global_price_route_exhausted, skuProviderIds=[3]'
                        }
                    }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                )
        )

        const generation = generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })
        const rejection = expect(generation).rejects.toMatchObject({
            code: 'HIMODELS_IMAGE_ROUTE_UNAVAILABLE',
            message: expect.stringContaining('已保持所选模型重试 3 次，未切换其他模型')
        })
        await waitForFetchCount(fetchMock, 1)
        await vi.advanceTimersByTimeAsync(2_000)
        await waitForFetchCount(fetchMock, 2)
        await vi.advanceTimersByTimeAsync(5_000)
        await rejection

        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('stops exhausted-route recovery when the caller cancels during backoff', async () => {
        vi.useFakeTimers()
        const controller = new AbortController()
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    error: {
                        message: 'No available image provider for model: gemini-3.1-flash-image, reason=global_price_route_exhausted'
                    }
                }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
        )

        const generation = generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath(), signal: controller.signal })
        const rejection = expect(generation).rejects.toThrow('cancelled-during-route-backoff')
        await waitForFetchCount(fetchMock, 1)
        controller.abort(new Error('cancelled-during-route-backoff'))
        await rejection
        await vi.advanceTimersByTimeAsync(10_000)

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('redacts credentials and signed URLs from a non-2xx provider error', async () => {
        const privateUrl = 'https://cdn.example/private.png?X-Amz-Signature=private-signature'
        const privateToken = 'private-bearer-token'
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ error: { message: `download ${privateUrl}; Authorization: Bearer ${privateToken}` } }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        let message = ''
        try {
            await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })
        } catch (error) {
            message = error instanceof Error ? error.message : String(error)
        }

        expect(message).toContain('[redacted')
        expect(message).not.toContain('private-signature')
        expect(message).not.toContain(privateToken)
    })

    it('accepts a direct binary image by signature even with a generic content type', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(imageBytes, {
                status: 200,
                headers: { 'Content-Type': 'application/octet-stream' }
            })
        )
        const generatedPath = outputPath()

        await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(await fs.readFile(generatedPath)).toEqual(imageBytes)
    })

    it('rejects a non-image direct body mislabeled as image content', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ message: 'not an image' }), {
                status: 200,
                headers: { 'Content-Type': 'image/png' }
            })
        )
        const generatedPath = outputPath()

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })).rejects.toThrow(/二进制内容不是受支持的图片格式/)

        expect(fetchMock).toHaveBeenCalledTimes(1)
        await expectFileMissing(generatedPath)
    })

    it('downloads and validates a generated image URL by bytes', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            if (String(input) === imageUrl) {
                return new Response(imageBytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
            }
            return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })
        const generatedPath = outputPath()

        await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(await fs.readFile(generatedPath)).toEqual(imageBytes)
    })

    it('rejects a generated image URL whose downloaded bytes are not an image', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            if (String(input) === imageUrl) {
                return new Response(JSON.stringify({ error: 'not an image' }), { status: 200, headers: { 'Content-Type': 'image/png' } })
            }
            return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        })
        const generatedPath = outputPath()

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })).rejects.toThrow(/下载结果不是受支持的图片格式/)

        expect(fetchMock).toHaveBeenCalledTimes(2)
        await expectFileMissing(generatedPath)
    })
})
