import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImageWithQwenImage3Pro, QwenImageRateLimitError, QWEN_IMAGE_3_PRO_MODEL, QWEN_IMAGE_MAX_CONCURRENCY, resolveQwenLocalImagePath } from './qwen-image'

describe('Qwen-Image 3.0 Pro', () => {
    const originalFetch = global.fetch

    afterEach(() => {
        global.fetch = originalFetch
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('allows five concurrent generation submissions', () => {
        expect(QWEN_IMAGE_MAX_CONCURRENCY).toBe(5)
    })

    it('confines local references to public/storage while preserving legacy storage paths', () => {
        const projectRoot = path.join(os.tmpdir(), 'qwen-project')
        expect(resolveQwenLocalImagePath('/storage/character.png', projectRoot)).toBe(path.join(projectRoot, 'public', 'storage', 'character.png'))
        expect(resolveQwenLocalImagePath(path.join(projectRoot, 'public', 'storage', 'scene.png'), projectRoot)).toBe(
            path.join(projectRoot, 'public', 'storage', 'scene.png')
        )
        expect(resolveQwenLocalImagePath('/storage/../../hi-models.json', projectRoot)).toBeNull()
        expect(resolveQwenLocalImagePath(path.join(projectRoot, 'hi-models.json'), projectRoot)).toBeNull()
    })

    it('submits the selected ratio and downloads the generated image', async () => {
        const outputPath = path.join(os.tmpdir(), `qwen-image-${crypto.randomUUID()}.png`)
        const referenceName = `qwen-reference-${crypto.randomUUID()}.png`
        const referencePath = path.join(process.cwd(), 'public', 'storage', referenceName)
        const requests: Array<{ url: string; init?: RequestInit }> = []
        global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            requests.push({ url, init })
            if (url.endsWith('/generation')) {
                return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: 'https://cdn.example/qwen.png' }] } }] } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            }
            return new Response(Buffer.from('generated-image'), { status: 200 })
        }) as typeof fetch

        try {
            await fs.mkdir(path.dirname(referencePath), { recursive: true })
            await fs.writeFile(referencePath, Buffer.from('reference-image'))
            await generateImageWithQwenImage3Pro({
                prompt: 'cinematic portrait',
                negativePrompt: 'waxy skin, plastic skin',
                referenceImages: [`/storage/${referenceName}`],
                outputPath,
                aspectRatio: '9:16',
                quality: 'ultra',
                apiKey: 'test-key'
            })
            const body = JSON.parse(String(requests[0].init?.body))
            expect(body.model).toBe(QWEN_IMAGE_3_PRO_MODEL)
            expect(body.parameters.size).toBe('1536*2688')
            expect(body.parameters.prompt_extend).toBe(true)
            expect(body.parameters.enable_thinking).toBe(true)
            expect(body.parameters.negative_prompt).toBe('waxy skin, plastic skin')
            expect(body.input.messages[0].content[0].image).toBe(`data:image/png;base64,${Buffer.from('reference-image').toString('base64')}`)
            expect(requests[0].init?.headers).toMatchObject({ 'X-DashScope-Async': 'enable' })
            expect(await fs.readFile(outputPath, 'utf8')).toBe('generated-image')
        } finally {
            await Promise.all([fs.unlink(outputPath).catch(() => {}), fs.unlink(referencePath).catch(() => {})])
        }
    })

    it('deduplicates references and never submits more than three image items', async () => {
        const outputPath = path.join(os.tmpdir(), `qwen-image-reference-limit-${crypto.randomUUID()}.png`)
        const generationBodies: Array<{ input: { messages: Array<{ content: Array<{ image?: string; text?: string }> }> } }> = []
        global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).endsWith('/generation')) {
                generationBodies.push(JSON.parse(String(init?.body)))
                return new Response(JSON.stringify({ output: { results: [{ url: 'https://cdn.example/qwen-limited.png' }] } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            }
            return new Response(Buffer.from('generated-image'), { status: 200 })
        }) as typeof fetch

        try {
            await generateImageWithQwenImage3Pro({
                prompt: 'two visible references plus hidden style references',
                referenceImages: [
                    'data:image/png;base64,Y2hhcmFjdGVy',
                    'data:image/png;base64,c2NlbmU=',
                    'data:image/png;base64,c3R5bGUx',
                    'data:image/png;base64,c3R5bGUy',
                    'data:image/png;base64,c3R5bGUy'
                ],
                outputPath,
                aspectRatio: '16:9',
                apiKey: 'test-key'
            })

            const content = generationBodies[0].input.messages[0].content
            expect(content.filter(item => item.image)).toHaveLength(3)
            expect(content.at(-1)).toEqual({ text: 'two visible references plus hidden style references' })
        } finally {
            await fs.unlink(outputPath).catch(() => {})
        }
    })

    it('falls back to a synchronous request when the account does not support asynchronous calls', async () => {
        const outputPath = path.join(os.tmpdir(), `qwen-image-sync-${crypto.randomUUID()}.png`)
        const generationRequests: RequestInit[] = []
        global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).endsWith('/generation')) {
                generationRequests.push(init ?? {})
                if (generationRequests.length === 1) {
                    return new Response(JSON.stringify({ code: 'AccessDenied', message: 'current user api does not support asynchronous calls' }), {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' }
                    })
                }
                return new Response(JSON.stringify({ output: { results: [{ url: 'https://cdn.example/qwen-sync.png' }] } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            }
            return new Response(Buffer.from('sync-generated-image'), { status: 200 })
        }) as typeof fetch

        try {
            await generateImageWithQwenImage3Pro({
                prompt: 'live-action portrait',
                outputPath,
                aspectRatio: '1:1',
                apiKey: 'test-key'
            })

            expect(generationRequests).toHaveLength(2)
            expect(generationRequests[0].headers).toMatchObject({ 'X-DashScope-Async': 'enable' })
            expect(generationRequests[1].headers).not.toHaveProperty('X-DashScope-Async')
            expect(await fs.readFile(outputPath, 'utf8')).toBe('sync-generated-image')
        } finally {
            await fs.unlink(outputPath).catch(() => {})
        }
    })

    it('returns a typed error immediately so the caller can switch providers on 429', async () => {
        const outputPath = path.join(os.tmpdir(), `qwen-image-retry-${crypto.randomUUID()}.png`)
        let generationAttempts = 0
        global.fetch = vi.fn(async () => {
            generationAttempts += 1
            return new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'rate quota exceeded' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            })
        }) as typeof fetch

        await expect(
            generateImageWithQwenImage3Pro({
                prompt: 'cinematic portrait',
                outputPath,
                aspectRatio: '1:1',
                apiKey: 'test-key'
            })
        ).rejects.toBeInstanceOf(QwenImageRateLimitError)
        expect(generationAttempts).toBe(1)
    })
})
