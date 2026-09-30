import type { ReferenceGenerationProgress } from '@/lib/reference-generation-progress'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    character: vi.fn(),
    project: vi.fn(),
    banana: vi.fn(),
    qwen: vi.fn(),
    inspect: vi.fn(),
    upload: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        character: { findFirst: mocks.character },
        project: { findFirst: mocks.project },
        aiServiceConfig: { findUnique: vi.fn().mockResolvedValue(null) }
    }
}))
vi.mock('./banana', () => ({
    BananaImageSafetyError: class extends Error {},
    generateImageWithBanana: mocks.banana,
    inspectCharacterReferenceQuality: mocks.inspect,
    inspectImageTextArtifacts: vi.fn().mockResolvedValue({ hasText: false, blockingRegions: [], regions: [] }),
    shouldRejectCharacterReferenceImage: vi.fn().mockReturnValue(false),
    getGoogleAccessToken: vi.fn(),
    getGoogleAuthClient: vi.fn(),
    resetGoogleAuthCache: vi.fn()
}))
vi.mock('./qwen-image', () => ({
    QwenImageRateLimitError: class extends Error {},
    QWEN_IMAGE_3_PRO_MODEL: 'qwen-image-3.0-pro',
    generateImageWithQwenImage3Pro: mocks.qwen
}))
vi.mock('./llm', () => ({ improveFrameImagePrompt: vi.fn(), improveVideoMotionPrompt: vi.fn(), rewriteAnimalCharacterAppearance: vi.fn(), rewriteImagePromptForSafety: vi.fn() }))
vi.mock('./local-media', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/local-media')>()),
    saveImmutableLocalImage: mocks.upload,
    saveLocalMediaFile: vi.fn(),
    toLocalMediaUrl: (url: string) => url
}))

import { generateCharacterReference } from './ai'

beforeEach(() => {
    vi.resetAllMocks()
    mocks.inspect.mockReset()
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-dashscope-key')
    mocks.character.mockResolvedValue({ id: 1n, projectId: 2n, name: 'Mira', appearancePrompt: 'adult woman, brown hair, blue jacket', gender: '女' })
    mocks.project.mockResolvedValue({ id: 2n, title: 'Test story', novelSetup: null })
    mocks.banana.mockResolvedValue({ localPath: '/unused-mocked-reference.png' })
    mocks.qwen.mockResolvedValue({ referenceImagesApplied: false })
    mocks.upload.mockResolvedValue('https://example.test/reference.png')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

function generate(progress: ReferenceGenerationProgress[] = []) {
    return generateCharacterReference(1n, {
        commit: false,
        provider: 'banana',
        onProgress: update => {
            progress.push(update)
        }
    })
}

function generationAttempts(progress: ReferenceGenerationProgress[]) {
    return progress.filter(update => update.stage === 'generating').map(update => update.attempt)
}

describe('basic character reference generation', () => {
    it('saves the first image without quality inspection or a second generation', async () => {
        const progress: ReferenceGenerationProgress[] = []
        await expect(generate(progress)).resolves.toMatchObject({ url: 'https://example.test/reference.png' })
        expect(mocks.banana).toHaveBeenCalledOnce()
        expect(mocks.inspect).not.toHaveBeenCalled()
        expect(mocks.qwen).not.toHaveBeenCalled()
        expect(generationAttempts(progress)).toEqual([1])
        expect(progress.map(update => update.stage)).toEqual(['generating', 'uploading', 'writing_db'])
        expect(progress.every(update => update.maxAttempts === 1 && update.timings.retryCount === 0)).toBe(true)
        expect(mocks.banana.mock.calls[0][0].prompt).toContain('full-body')
    })

    it('does not save or switch models after a provider failure', async () => {
        mocks.banana.mockRejectedValue(new Error('invalid credentials'))
        await expect(generate()).rejects.toThrow('invalid credentials')
        expect(mocks.banana).toHaveBeenCalledOnce()
        expect(mocks.qwen).not.toHaveBeenCalled()
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('rejects a removed multiview role before calling a model', async () => {
        await expect(generateCharacterReference(1n, { commit: false, role: 'turnaround_sheet' as never })).rejects.toThrow()
        expect(mocks.banana).not.toHaveBeenCalled()
        expect(mocks.upload).not.toHaveBeenCalled()
    })
})
