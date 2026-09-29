import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const mocks = vi.hoisted(() => {
    class MockBananaImageSafetyError extends Error {
        readonly code = 'BANANA_IMAGE_SAFETY'

        constructor(
            message: string,
            readonly diagnostic: string
        ) {
            super(message)
            this.name = 'BananaImageSafetyError'
        }
    }

    class MockQwenImageRateLimitError extends Error {
        readonly code = 'QWEN_IMAGE_RATE_LIMIT'
    }

    return {
        MockBananaImageSafetyError,
        MockQwenImageRateLimitError,
        generateImageWithBanana: vi.fn(),
        generateImageWithQwenImage3Pro: vi.fn(),
        generateHiModelsImage: vi.fn(),
        rewriteImagePromptForSafety: vi.fn(),
        findUnique: vi.fn()
    }
})

vi.mock('@/lib/prisma', () => ({
    prisma: {
        aiServiceConfig: { findUnique: mocks.findUnique }
    }
}))

vi.mock('./banana', () => ({
    BananaImageSafetyError: mocks.MockBananaImageSafetyError,
    generateImageWithBanana: mocks.generateImageWithBanana,
    getGoogleAccessToken: vi.fn(),
    getGoogleAuthClient: vi.fn(),
    inspectImageTextArtifacts: vi.fn(),
    resetGoogleAuthCache: vi.fn(),
    shouldRejectCharacterReferenceImage: vi.fn()
}))

vi.mock('./qwen-image', () => ({
    QwenImageRateLimitError: mocks.MockQwenImageRateLimitError,
    QWEN_IMAGE_3_PRO_MODEL: 'qwen-image-3.0-pro',
    generateImageWithQwenImage3Pro: mocks.generateImageWithQwenImage3Pro
}))

vi.mock('./himodels', () => ({
    createHiModelsVideoTask: vi.fn(),
    extractHiModelsUsage: vi.fn(),
    generateHiModelsImage: mocks.generateHiModelsImage,
    getHiModelsVideoTask: vi.fn(),
    HIMODELS_VEO_LABEL: 'veo-3.1-generate-001'
}))

vi.mock('./llm', () => ({
    improveFrameImagePrompt: vi.fn(),
    improveVideoMotionPrompt: vi.fn(),
    rewriteAnimalCharacterAppearance: vi.fn(),
    rewriteImagePromptForSafety: mocks.rewriteImagePromptForSafety
}))

import { generateImageUnified, IMAGE_GENERATION_MAX_CONCURRENCY, IMAGE_PROVIDER_CONCURRENCY_LIMITS, IMAGE_PROVIDER_HARD_TIMEOUT_MS, IMAGE_RATE_LIMIT_MAX_ATTEMPTS, imageProviderPool } from './ai'

async function flushMicrotasksUntil(predicate: () => boolean) {
    // Full-suite module transforms can briefly delay the queued image worker.
    // Keep this fake-timer assertion focused on behavior instead of host load.
    await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 5_000, interval: 1 })
}

describe('image generation automatic recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('HAPPY_HORSE_API_KEY', 'test-dashscope-key')
        mocks.findUnique.mockResolvedValue(null)
        mocks.rewriteImagePromptForSafety.mockImplementation(async ({ prompt, attempt }: { prompt: string; attempt: number }) => `${prompt}, safe rewrite ${attempt}`)
        mocks.generateHiModelsImage.mockResolvedValue({ referenceImagesApplied: true, usage: null })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
    })

    it('keeps Nano Banana when the original prompt succeeds', async () => {
        mocks.generateImageWithBanana.mockResolvedValue({ localPath: '/tmp/frame.png' })

        const result = await generateImageUnified({
            prompt: 'cinematic frame',
            outputAbsPath: '/tmp/frame.png',
            provider: 'banana',
            quality: 'ultra',
            automaticFallback: true
        })

        expect(result).toMatchObject({ actualProvider: 'banana', safetyRewriteCount: 0 })
        expect(mocks.generateImageWithBanana).toHaveBeenCalledWith(expect.objectContaining({ quality: 'ultra' }))
        expect(mocks.generateHiModelsImage).not.toHaveBeenCalled()
    })

    it("falls back from 21:9 to Qwen-Image's widest supported ratio", async () => {
        mocks.findUnique.mockResolvedValue({ apiKey: 'qwen-key', baseUrl: 'https://dashscope.example' })
        mocks.generateImageWithQwenImage3Pro.mockResolvedValue({ referenceImagesApplied: false, taskId: null })

        await generateImageUnified({
            prompt: 'ultra-wide character sheet',
            outputAbsPath: '/tmp/frame.png',
            provider: 'qwen-image-3.0-pro',
            aspectRatio: '21:9',
            quality: 'ultra'
        })

        expect(mocks.generateImageWithQwenImage3Pro).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: '16:9' }))
    })

    it('reports a safety rewrite when Banana succeeds on the retry', async () => {
        mocks.generateImageWithBanana.mockRejectedValueOnce(new mocks.MockBananaImageSafetyError('blocked', 'SAFETY')).mockResolvedValueOnce({ localPath: '/tmp/frame.png' })

        const result = await generateImageUnified({
            prompt: 'cinematic frame',
            outputAbsPath: '/tmp/frame.png',
            provider: 'banana',
            automaticFallback: true
        })

        expect(result).toMatchObject({ actualProvider: 'banana', recovery: 'safety_rewrite', safetyRewriteCount: 1 })
        expect(mocks.generateHiModelsImage).not.toHaveBeenCalled()
    })

    it('uses the HiModels Gemini fallback only after Banana safety recovery is exhausted', async () => {
        mocks.generateImageWithBanana.mockRejectedValue(new mocks.MockBananaImageSafetyError('did not return an image', 'NO_IMAGE'))

        const result = await generateImageUnified({
            prompt: 'cinematic frame',
            referenceImages: ['/storage/character.png'],
            outputAbsPath: '/tmp/frame.png',
            provider: 'banana',
            automaticFallback: true
        })

        expect(mocks.generateImageWithBanana).toHaveBeenCalledTimes(3)
        expect(mocks.rewriteImagePromptForSafety).toHaveBeenCalledTimes(2)
        expect(mocks.generateHiModelsImage).toHaveBeenCalledTimes(1)
        expect(mocks.generateHiModelsImage).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-image', referenceImages: ['/storage/character.png'] }))
        expect(result).toMatchObject({
            requestedProvider: 'banana',
            actualProvider: 'gemini-3.1-flash-image',
            recovery: 'fallback_provider',
            safetyRewriteCount: 2,
            referenceImagesApplied: true
        })
    })

    it('keeps the selected Nano Banana provider when provider switching is disabled', async () => {
        mocks.generateImageWithBanana.mockRejectedValue(new mocks.MockBananaImageSafetyError('did not return an image', 'NO_IMAGE'))

        await expect(
            generateImageUnified({
                prompt: 'cinematic frame',
                outputAbsPath: '/tmp/frame.png',
                provider: 'banana',
                automaticFallback: true,
                allowProviderSwitch: false
            })
        ).rejects.toThrow('图片在自动安全改写后仍被拦截')

        expect(mocks.generateImageWithBanana).toHaveBeenCalledTimes(3)
        expect(mocks.generateHiModelsImage).not.toHaveBeenCalled()
    })

    it('does not silently replace a selected Himodels image model after a schema error', async () => {
        mocks.generateHiModelsImage.mockRejectedValueOnce(new Error('gemini-3.1-flash-image失败（400）：thinking_level is not supported by this model'))
        const onProviderSwitch = vi.fn()

        await expect(
            generateImageUnified({
                prompt: 'character turnaround',
                referenceImages: ['/storage/character.png'],
                outputAbsPath: '/tmp/himodels-pro.png',
                provider: 'gemini-3.1-flash-image',
                contentLabel: '角色设定板',
                onProviderSwitch
            })
        ).rejects.toThrow('thinking_level is not supported')

        expect(mocks.generateHiModelsImage).toHaveBeenCalledTimes(1)
        expect(mocks.generateHiModelsImage.mock.calls[0]?.[0]).toMatchObject({ model: 'gemini-3.1-flash-image' })
        expect(onProviderSwitch).not.toHaveBeenCalled()
    })

    it('does not switch a storyboard to another model when the selected Himodels route is unavailable', async () => {
        mocks.generateHiModelsImage.mockRejectedValueOnce(
            new Error('HiModels 当前没有 gemini-3.1-flash-image 的可用图片线路，已保持所选模型重试 3 次，未切换其他模型。上游详情：reason=global_price_route_exhausted')
        )
        const onProviderSwitch = vi.fn()

        await expect(
            generateImageUnified({
                prompt: 'storyboard frame',
                outputAbsPath: '/tmp/himodels-route-unavailable.png',
                provider: 'gemini-3.1-flash-image',
                contentLabel: '分镜 66 · 主插图',
                allowProviderSwitch: false,
                onProviderSwitch
            })
        ).rejects.toThrow('未切换其他模型')

        expect(mocks.generateHiModelsImage).toHaveBeenCalledTimes(1)
        expect(mocks.generateImageWithBanana).not.toHaveBeenCalled()
        expect(onProviderSwitch).not.toHaveBeenCalled()
    })

    it('retries Qwen 429 three times, then switches only the current content to Nano Banana', async () => {
        vi.useFakeTimers()
        mocks.findUnique.mockResolvedValue({ apiKey: 'qwen-key', baseUrl: 'https://dashscope.example' })
        mocks.generateImageWithQwenImage3Pro.mockRejectedValue(new mocks.MockQwenImageRateLimitError('rate limited'))
        mocks.generateImageWithBanana.mockResolvedValue({ localPath: '/tmp/frame.png' })
        const onProviderSwitch = vi.fn()

        const resultPromise = generateImageUnified({
            prompt: 'cinematic frame',
            referenceImages: ['/storage/character.png'],
            outputAbsPath: '/tmp/frame.png',
            provider: 'qwen-image-3.0-pro',
            contentLabel: 'underground cave',
            onProviderSwitch
        })
        await flushMicrotasksUntil(() => mocks.generateImageWithQwenImage3Pro.mock.calls.length === 1)
        await vi.advanceTimersByTimeAsync(1_000)
        await flushMicrotasksUntil(() => mocks.generateImageWithQwenImage3Pro.mock.calls.length === 2)
        await vi.advanceTimersByTimeAsync(2_500)
        await flushMicrotasksUntil(() => mocks.generateImageWithQwenImage3Pro.mock.calls.length === 3)
        const result = await resultPromise

        expect(IMAGE_RATE_LIMIT_MAX_ATTEMPTS).toBe(3)
        expect(mocks.generateImageWithQwenImage3Pro).toHaveBeenCalledTimes(3)
        expect(mocks.generateImageWithBanana).toHaveBeenCalledTimes(1)
        expect(onProviderSwitch).toHaveBeenCalledWith({
            from: 'qwen-image-3.0-pro',
            to: 'banana',
            reason: 'Qwen-Image 429 after 3 attempts',
            status: 429,
            attempts: 3,
            contentLabel: 'underground cave'
        })
        expect(result).toMatchObject({
            requestedProvider: 'qwen-image-3.0-pro',
            actualProvider: 'banana',
            recovery: 'fallback_provider',
            providerSwitch: { from: 'qwen-image-3.0-pro', to: 'banana', status: 429 }
        })
    })

    it('does not switch other image contents when one concurrent item is rate limited', async () => {
        vi.useFakeTimers()
        mocks.findUnique.mockResolvedValue({ apiKey: 'qwen-key', baseUrl: 'https://dashscope.example' })
        mocks.generateImageWithQwenImage3Pro.mockImplementation(async ({ prompt }: { prompt: string }) => {
            if (prompt.includes('limited item')) throw new mocks.MockQwenImageRateLimitError('rate limited')
            return { referenceImagesApplied: false }
        })
        mocks.generateImageWithBanana.mockResolvedValue({ localPath: '/tmp/fallback.png' })

        const limitedPromise = generateImageUnified({
            prompt: 'limited item',
            outputAbsPath: '/tmp/limited.png',
            provider: 'qwen-image-3.0-pro',
            contentLabel: 'limited content'
        })
        const healthyPromise = generateImageUnified({
            prompt: 'healthy item',
            outputAbsPath: '/tmp/healthy.png',
            provider: 'qwen-image-3.0-pro',
            contentLabel: 'healthy content'
        })
        const limitedAttempts = () => mocks.generateImageWithQwenImage3Pro.mock.calls.filter(([input]) => input.prompt.includes('limited item')).length
        await flushMicrotasksUntil(() => limitedAttempts() === 1)
        await vi.advanceTimersByTimeAsync(1_000)
        await flushMicrotasksUntil(() => limitedAttempts() === 2)
        await vi.advanceTimersByTimeAsync(2_500)
        await flushMicrotasksUntil(() => limitedAttempts() === 3)
        const [limited, healthy] = await Promise.all([limitedPromise, healthyPromise])

        expect(limited.actualProvider).toBe('banana')
        expect(healthy.actualProvider).toBe('qwen-image-3.0-pro')
        expect(healthy.providerSwitch).toBeUndefined()
    })

    it('times out a stuck provider, switches only that image, and releases its slot', async () => {
        vi.useFakeTimers()
        mocks.generateImageWithBanana.mockImplementation(() => new Promise(() => undefined))
        const onProviderSwitch = vi.fn()

        const resultPromise = generateImageUnified({
            prompt: 'stuck frame',
            outputAbsPath: '/tmp/stuck-frame.png',
            provider: 'banana',
            contentLabel: '分镜 22 · 主插图',
            onProviderSwitch
        })
        await flushMicrotasksUntil(() => mocks.generateImageWithBanana.mock.calls.length === 1)
        await vi.advanceTimersByTimeAsync(IMAGE_PROVIDER_HARD_TIMEOUT_MS)
        const result = await resultPromise

        expect(onProviderSwitch).toHaveBeenCalledWith({
            from: 'banana',
            to: 'gemini-3.1-flash-image',
            reason: `Nano Banana timed out after ${IMAGE_PROVIDER_HARD_TIMEOUT_MS}ms`,
            status: 408,
            attempts: 1,
            contentLabel: '分镜 22 · 主插图'
        })
        expect(result).toMatchObject({
            requestedProvider: 'banana',
            actualProvider: 'gemini-3.1-flash-image',
            recovery: 'fallback_provider',
            providerSwitch: { from: 'banana', to: 'gemini-3.1-flash-image', status: 408 }
        })

        mocks.generateImageWithBanana.mockResolvedValue({ localPath: '/tmp/next-frame.png' })
        await expect(
            generateImageUnified({
                prompt: 'next healthy frame',
                outputAbsPath: '/tmp/next-frame.png',
                provider: 'banana'
            })
        ).resolves.toMatchObject({ actualProvider: 'banana' })
    })

    it('reports the selected Nano Banana timeout without calling the fallback when provider switching is disabled', async () => {
        vi.useFakeTimers()
        mocks.generateImageWithBanana.mockImplementation(() => new Promise(() => undefined))

        const resultPromise = generateImageUnified({
            prompt: 'stuck locked frame',
            outputAbsPath: '/tmp/stuck-locked-frame.png',
            provider: 'banana',
            contentLabel: '分镜 22 · 主插图',
            allowProviderSwitch: false
        })
        const rejection = expect(resultPromise).rejects.toThrow('“分镜 22 · 主插图”生成超时')
        await flushMicrotasksUntil(() => mocks.generateImageWithBanana.mock.calls.length === 1)
        await vi.advanceTimersByTimeAsync(IMAGE_PROVIDER_HARD_TIMEOUT_MS)
        await rejection

        expect(mocks.generateHiModelsImage).not.toHaveBeenCalled()
    })

    it('limits one provider without creating a two-request service bottleneck', async () => {
        let active = 0
        let maxActive = 0
        mocks.generateImageWithBanana.mockImplementation(async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise(resolve => setTimeout(resolve, 10))
            active -= 1
            return { localPath: '/tmp/frame.png' }
        })

        await Promise.all(
            Array.from({ length: 12 }, (_, index) =>
                generateImageUnified({
                    prompt: `frame ${index}`,
                    outputAbsPath: `/tmp/frame-${index}.png`,
                    provider: 'banana'
                })
            )
        )

        expect(IMAGE_GENERATION_MAX_CONCURRENCY).toBe(8)
        expect(IMAGE_PROVIDER_CONCURRENCY_LIMITS.banana).toBe(8)
        expect(maxActive).toBe(8)
    })

    it('isolates provider pools so one saturated provider does not block another', async () => {
        let releaseBanana!: () => void
        const bananaGate = new Promise<void>(resolve => {
            releaseBanana = resolve
        })
        mocks.generateImageWithBanana.mockImplementation(() => bananaGate.then(() => ({ localPath: '/tmp/frame.png' })))

        const bananaTasks = Array.from({ length: IMAGE_PROVIDER_CONCURRENCY_LIMITS.banana }, (_, index) =>
            generateImageUnified({
                prompt: `banana frame ${index}`,
                outputAbsPath: `/tmp/banana-frame-${index}.png`,
                provider: 'banana'
            })
        )
        await flushMicrotasksUntil(() => mocks.generateImageWithBanana.mock.calls.length === IMAGE_PROVIDER_CONCURRENCY_LIMITS.banana)

        const hiModelsTask = generateImageUnified({
            prompt: 'himodels frame',
            outputAbsPath: '/tmp/himodels-frame.png',
            provider: 'seedream-5-0-lite'
        })
        await flushMicrotasksUntil(() => mocks.generateHiModelsImage.mock.calls.length === 1)

        releaseBanana()
        await Promise.all([...bananaTasks, hiModelsTask])
        expect(imageProviderPool('banana')).toBe('banana')
        expect(imageProviderPool('seedream-5-0-lite')).toBe('himodels')
        expect(imageProviderPool('qwen-image-3.0-pro')).toBe('qwen')
    })

    it('enables automatic fallback for primary character turnaround sheets only', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
        expect(source).toContain("automaticFallback: role === 'turnaround_sheet'")
    })

    it('locks storyboard illustrations to the explicitly selected image provider', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/services/ai.ts'), 'utf8')
        const frameFlowStart = source.indexOf('export async function generateFrame')
        const storyboardFrameFlow = source.slice(frameFlowStart)
        expect(storyboardFrameFlow.match(/allowProviderSwitch: false/g)).toHaveLength(1)
        expect(storyboardFrameFlow).not.toContain('reportFrameProviderSwitch')
        expect(storyboardFrameFlow).not.toContain('activeImageProvider')
    })

    it('does not advertise automatic storyboard provider switching in the episode UI', () => {
        const page = fs.readFileSync(path.join(process.cwd(), 'src/app/projects/[id]/episodes/[episodeId]/page.tsx'), 'utf8')
        expect(page).not.toContain('已仅为这张图片切换备用通道')
    })

    it('does not switch providers for credentials or network failures', async () => {
        mocks.generateImageWithBanana.mockRejectedValue(new Error('Nano Banana credentials not found'))

        await expect(
            generateImageUnified({
                prompt: 'cinematic frame',
                outputAbsPath: '/tmp/frame.png',
                provider: 'banana',
                automaticFallback: true
            })
        ).rejects.toThrow('credentials not found')

        expect(mocks.generateHiModelsImage).not.toHaveBeenCalled()
    })
})
