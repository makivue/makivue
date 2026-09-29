// Transport/diagnostic tests isolate billing; model-call-billing tests cover the financial boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

vi.mock('@/services/model-call-billing', () => ({ prepareModelCallBilling: vi.fn(), finishModelCallBilling: vi.fn() }))

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: { aiServiceConfig: { findUnique: mocks.findUnique }, hiModelsCall: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) } }
}))

import { chatHiModels, createHiModelsVideoTask, generateHiModelsImage, getHiModelsVideoTask } from './himodels'
import { hiModelsDiagnosticStore } from '@/lib/himodels-diagnostic-store.server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prepareModelCallBilling } from '@/services/model-call-billing'

const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('Himodels image compatibility recovery', () => {
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
        const value = path.join(os.tmpdir(), `himodels-compat-${crypto.randomUUID()}.png`)
        outputPaths.push(value)
        return value
    }

    it.each(['json', 'binary'])('saves an already received %s character image if the request is aborted while recording usage', async format => {
        const controller = new AbortController()
        let requests = 0
        const server = createServer((_request, response) => {
            requests += 1
            response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json' : 'image/png' })
            response.end(
                format === 'json' ? JSON.stringify({ data: [{ b64_json: imageBase64 }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }) : Buffer.from(imageBase64, 'base64')
            )
        })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        try {
            const address = server.address() as { port: number }
            vi.stubEnv('HIMODELS_BASE_URL', `http://127.0.0.1:${address.port}`)
            const destination = outputPath()
            const onUsage = vi.fn(() => controller.abort())
            const result = await withHiModelsUsageScope({ userId: 800n, onUsage }, () =>
                generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'character sheet', imageSize: '4K', outputPath: destination, signal: controller.signal })
            )

            expect(controller.signal.aborted).toBe(true)
            expect(await fs.readFile(destination)).toEqual(Buffer.from(imageBase64, 'base64'))
            expect(result.usage).toEqual(format === 'json' ? { 'usage.prompt_tokens': 2, 'usage.completion_tokens': 3, 'usage.total_tokens': 5 } : null)
            expect(onUsage).toHaveBeenCalledOnce()
            expect(requests).toBe(1)
        } finally {
            server.closeAllConnections()
            await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
        }
    })

    it('captures the original text response including usage before extracting content', async () => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        const payload = {
            id: 'upstream-outline-1',
            choices: [{ message: { content: '{"chapters":[]}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333, completion_tokens_details: { reasoning_tokens: 20 } }
        }
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { headers: { 'x-request-id': 'trace-outline-1' } }))
        const onResponse = vi.fn()

        await expect(chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onResponse })).resolves.toBe('{"chapters":[]}')

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(onResponse).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                model: 'gemini-3.7-flash',
                status: 200,
                requestId: 'trace-outline-1',
                response: payload,
                truncated: false
            })
        )
        expect(onResponse.mock.calls[0][0]).not.toHaveProperty('headers')
    })

    it('retains responses without usage rather than inventing token counters', async () => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        const payload = { choices: [{ message: { content: 'outline' } }] }
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)))
        const onResponse = vi.fn()

        await chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onResponse })

        expect(onResponse.mock.calls[0][0].response).toEqual(payload)
        expect(onResponse.mock.calls[0][0].response).not.toHaveProperty('usage')
    })

    it('records provider errors and redacts reflected credentials', async () => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'invalid prompt' }, api_key: 'test-file-key' }), { status: 400 }))
        const onResponse = vi.fn()

        await expect(chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onResponse })).rejects.toThrow('invalid prompt')

        expect(onResponse.mock.calls[0][0]).toMatchObject({ status: 400, response: { error: { message: 'invalid prompt' }, api_key: '[REDACTED]' } })
    })

    it('records non-JSON provider failures without changing their handling', async () => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream unavailable', { status: 503 }))
        const onResponse = vi.fn()

        await expect(chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onResponse })).rejects.toThrow('503')

        expect(onResponse.mock.calls[0][0]).toMatchObject({ status: 503, response: 'upstream unavailable' })
    })

    it('does not retry or fail generation if diagnostic persistence fails', async () => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'outline' } }] })))
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(
            chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], {
                onResponse: async () => {
                    throw new Error('diagnostic storage unavailable')
                }
            })
        ).resolves.toBe('outline')

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not capture raw responses in production without an explicit opt-in', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', '')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'outline' } }] })))
        const onResponse = vi.fn()

        await chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onResponse })

        expect(onResponse).not.toHaveBeenCalled()
    })

    it('retains real text usage in production independently of raw logging', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'false')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            Response.json({
                choices: [{ message: { content: 'outline' } }],
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    prompt_tokens: 13890,
                    completion_tokens: 2520,
                    total_tokens: 16410
                }
            })
        )
        const onUsage = vi.fn()
        const onResponse = vi.fn()
        await expect(chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onUsage, onResponse })).resolves.toBe('outline')
        expect(onUsage).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ model: 'gemini-3.7-flash', usage: expect.objectContaining({ inputTokens: 13890, outputTokens: 2520, totalTokens: 16410 }) })
        )
        expect(onResponse).not.toHaveBeenCalled()
    })

    it('reports an unknown-usage call and never retries if usage persistence fails', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ message: { content: 'outline' } }] }))
        const onUsage = vi.fn(async () => {
            throw new Error('usage storage unavailable')
        })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'outline' }], { onUsage })).resolves.toBe('outline')
        expect(onUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usage: null }))
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('captures image submissions, video submissions and every video status request', async () => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
        const since = Date.now()
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(Response.json({ data: [{ b64_json: imageBase64 }], usage: { total_tokens: 5 } }))
            .mockResolvedValueOnce(Response.json({ task_id: 'video-log-task' }))
            .mockResolvedValueOnce(Response.json({ status: 'processing' }))
            .mockResolvedValueOnce(Response.json({ status: 'done', usage: { total_tokens: 12 } }))
        await withHiModelsUsageScope({ userId: 135791n }, async () => {
            await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })
            await createHiModelsVideoTask({ model: 'seedance-2.0-global', prompt: 'cat', aspectRatio: '16:9', duration: 8 })
            await getHiModelsVideoTask('video-log-task')
            await getHiModelsVideoTask('video-log-task')
        })
        const records = hiModelsDiagnosticStore.read('135791', null, since).events
        expect(records.map(record => record.phase)).toEqual(['request', 'response', 'request', 'response', 'request', 'response', 'request', 'response'])
        expect(records[0]).toMatchObject({ method: 'POST', url: 'https://himodels.test/v1/images/generations' })
        expect(records[2]).toMatchObject({ method: 'POST', url: 'https://himodels.test/v1/video/generations' })
        expect(records[4]).toMatchObject({ method: 'GET', url: 'https://himodels.test/v1/video/generations/video-log-task' })
        expect(records[7].body).toEqual({ status: 'done', usage: { total_tokens: 12 } })
    })

    it('reroutes a contradictory thinking error with the same model and a fresh idempotency key', async () => {
        vi.useFakeTimers()
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ error: { message: 'thinking_level is not supported by this model' } }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            )

        const generatedPath = outputPath()
        const generation = generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: generatedPath })
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
        await vi.advanceTimersByTimeAsync(250)
        await generation

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).model)).toEqual(['gemini-3.1-flash-image', 'gemini-3.1-flash-image'])
        const idempotencyKeys = fetchMock.mock.calls.map(call => new Headers(call[1]?.headers).get('Idempotency-Key'))
        expect(new Set(idempotencyKeys).size).toBe(2)
        for (const call of fetchMock.mock.calls) {
            const rawBody = String(call[1]?.body)
            expect(rawBody).not.toMatch(/thinking[_-]?(?:level|config)/i)
        }
        expect(await fs.readFile(generatedPath)).toEqual(Buffer.from(imageBase64, 'base64'))
    })

    it('classifies an exhausted incompatible thinking route without switching models', async () => {
        vi.useFakeTimers()
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
            async () =>
                new Response(JSON.stringify({ error: { message: 'thinking_level is not supported by this model' } }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                })
        )

        const generation = generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })
        const rejection = expect(generation).rejects.toMatchObject({ code: 'HIMODELS_IMAGE_THINKING_ROUTE' })
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
        await vi.advanceTimersByTimeAsync(250)
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
        await vi.advanceTimersByTimeAsync(750)
        await rejection

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).model)).toEqual(['gemini-3.1-flash-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image'])
        const idempotencyKeys = fetchMock.mock.calls.map(call => new Headers(call[1]?.headers).get('Idempotency-Key'))
        expect(new Set(idempotencyKeys).size).toBe(3)
    })

    it('does not send thinkingConfig to Gemini 3.1 Flash Image', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        await generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const rawBody = String(fetchMock.mock.calls[0]?.[1]?.body)
        const request = JSON.parse(rawBody)
        expect(request.generationConfig.thinkingConfig).toBeUndefined()
        expect(rawBody).not.toMatch(/thinking[_-]?(?:level|config)/i)
    })

    it('does not hide unrelated provider errors behind a compatibility retry', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ error: { message: 'invalid prompt' } }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        await expect(generateHiModelsImage({ model: 'gemini-3.1-flash-image', prompt: 'cat', outputPath: outputPath() })).rejects.toThrow('invalid prompt')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('submits exactly the documented text request body', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        await chatHiModels('gemini-3.7-flash', [{ role: 'user', content: 'hello' }], { temperature: 0.5, maxTokens: 128 })

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
            model: 'gemini-3.7-flash',
            messages: [{ role: 'user', content: 'hello' }],
            temperature: 0.5,
            max_tokens: 128
        })
    })

    it('submits exactly the documented active video request body', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ id: 'video-task-1' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        )

        await createHiModelsVideoTask({ model: 'seedance-2.0-global', prompt: 'camera pans left', aspectRatio: '16:9', duration: 8 })

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
            model: 'seedance-2.0-global',
            content: [{ type: 'text', text: 'camera pans left' }],
            ratio: '16:9',
            duration: 8,
            resolution: '720p'
        })
    })

    it('submits MiniMax H3 through the documented 2K content contract', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'h3-video-task' }))

        await createHiModelsVideoTask({
            model: 'MiniMax-H3',
            prompt: 'native multi-shot trailer with synchronized sound',
            aspectRatio: '21:9',
            duration: 15,
            referenceImages: [{ url: 'https://cdn.test/opening.png', role: 'first_frame' }],
            referenceVideos: [{ url: 'https://cdn.test/motion.mp4', durationSeconds: 6 }]
        })

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
            model: 'MiniMax-H3',
            content: [
                { type: 'text', text: 'native multi-shot trailer with synchronized sound' },
                { type: 'image_url', image_url: { url: 'https://cdn.test/opening.png' }, role: 'first_frame' },
                { type: 'video_url', video_url: { url: 'https://cdn.test/motion.mp4' }, role: 'reference_video' }
            ],
            ratio: '21:9',
            duration: 15,
            resolution: '2K'
        })
        const billingInit = vi.mocked(prepareModelCallBilling).mock.calls.at(-1)?.[3]
        expect(JSON.parse(String(billingInit?.body))).toMatchObject({ model: 'MiniMax-H3', input_video_duration: 6 })
    })

    it('submits a Seedance first-frame image with its documented role', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'video-task-first-frame' }))

        await createHiModelsVideoTask({
            model: 'seedance-2.0-global',
            prompt: 'the subject starts walking',
            aspectRatio: '9:16',
            duration: 5,
            referenceImages: [{ url: 'https://cdn.test/opening.png', role: 'first_frame' }]
        })

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
            model: 'seedance-2.0-global',
            content: [
                { type: 'text', text: 'the subject starts walking' },
                { type: 'image_url', image_url: { url: 'https://cdn.test/opening.png' }, role: 'first_frame' }
            ],
            ratio: '9:16',
            duration: 5,
            resolution: '720p'
        })
    })

    it('submits Seedance opening and ending frames in order', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'video-task-first-last' }))

        await createHiModelsVideoTask({
            model: 'seedance-2.5-global',
            prompt: 'move continuously between both frames',
            aspectRatio: '16:9',
            duration: 8,
            referenceImages: [
                { url: 'https://cdn.test/opening.png', role: 'first_frame' },
                { url: 'https://cdn.test/ending.png', role: 'last_frame' }
            ]
        })

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).content).toEqual([
            { type: 'text', text: 'move continuously between both frames' },
            { type: 'image_url', image_url: { url: 'https://cdn.test/opening.png' }, role: 'first_frame' },
            { type: 'image_url', image_url: { url: 'https://cdn.test/ending.png' }, role: 'last_frame' }
        ])
    })

    it('keeps Seedance image and video references together in content order', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'video-task-mixed-references' }))

        await createHiModelsVideoTask({
            model: 'seedance-2.0-global',
            prompt: 'follow the supplied motion',
            aspectRatio: '1:1',
            duration: 6,
            referenceImages: [{ url: 'https://cdn.test/opening.png', role: 'first_frame' }],
            referenceVideos: [{ url: 'https://cdn.test/motion.mp4' }]
        })

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).content).toEqual([
            { type: 'text', text: 'follow the supplied motion' },
            { type: 'image_url', image_url: { url: 'https://cdn.test/opening.png' }, role: 'first_frame' },
            { type: 'video_url', video_url: { url: 'https://cdn.test/motion.mp4' }, role: 'reference_video' }
        ])
    })

    it('blocks retired Veo models before submitting a new task', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')

        await expect(createHiModelsVideoTask({ model: 'veo-3.1-generate-001', prompt: 'camera pans left', aspectRatio: '16:9', duration: 8 })).rejects.toThrow('不支持的视频模型')
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
