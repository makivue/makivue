import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReferenceGenerationProgress } from '@/lib/reference-generation-progress'

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
vi.mock('./local-media', async importOriginal => ({ ...(await importOriginal<typeof import('@/services/local-media')>()), saveImmutableLocalImage: mocks.upload, saveLocalMediaFile: vi.fn(), toLocalMediaUrl: (url: string) => url }))

import { generateCharacterReference } from './ai'

const accepted = {
    score: 90,
    singleCharacter: true,
    subjectTypeMatch: true,
    faceVisible: true,
    fullBodyVisible: true,
    identityReady: true,
    angleMatch: true,
    whiteBackground: true,
    frontViewVisible: true,
    leftThreeQuarterViewVisible: true,
    leftProfileViewVisible: true,
    backViewVisible: true,
    faceCloseupVisible: true,
    identityConsistentAcrossViews: true,
    fullBodyViewCount: 4,
    distinctFullBodyViewCount: 4,
    duplicateViewDetected: false,
    duplicateViewPairs: [],
    issues: []
}
const rejected = { ...accepted, faceVisible: false, faceCloseupVisible: false, issues: ['Missing face close-up'] }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.inspect.mockReset()
    vi.stubEnv('DASHSCOPE_API_KEY', 'test-dashscope-key')
    mocks.character.mockResolvedValue({ id: 1n, projectId: 2n, name: 'Mira', appearancePrompt: 'adult woman, brown hair, blue jacket', gender: '女' })
    mocks.project.mockResolvedValue({ id: 2n, title: 'Test story', novelSetup: null })
    mocks.banana.mockResolvedValue({ localPath: '/unused-mocked-reference.png' })
    mocks.qwen.mockResolvedValue({ referenceImagesApplied: false })
    mocks.inspect.mockResolvedValue(accepted)
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

describe('character reference generation attempt limit', () => {
    it('returns a valid first image without a retry and reports a two-attempt limit', async () => {
        const progress: ReferenceGenerationProgress[] = []
        await expect(generate(progress)).resolves.toMatchObject({ url: 'https://example.test/reference.png' })
        expect(mocks.banana).toHaveBeenCalledTimes(1)
        expect(mocks.inspect).toHaveBeenCalledTimes(1)
        expect(generationAttempts(progress)).toEqual([1])
        expect(progress.every(update => update.maxAttempts === 2 && update.timings.retryCount === 0)).toBe(true)
    })

    it('accepts a corrected image on the single retry', async () => {
        mocks.inspect.mockResolvedValueOnce(rejected).mockResolvedValueOnce(accepted)
        const progress: ReferenceGenerationProgress[] = []
        await expect(generate(progress)).resolves.toMatchObject({ url: 'https://example.test/reference.png' })
        expect(mocks.banana).toHaveBeenCalledTimes(2)
        expect(generationAttempts(progress)).toEqual([1, 2])
        expect(progress.at(-1)).toMatchObject({ stage: 'writing_db', attempt: 2, maxAttempts: 2, timings: { retryCount: 1 } })
    })

    it('stops after the second rejected image without generating or uploading a third', async () => {
        mocks.inspect.mockResolvedValue(rejected)
        const progress: ReferenceGenerationProgress[] = []
        await expect(generate(progress)).rejects.toThrow('角色参考图连续 2 次未通过')
        expect(mocks.banana).toHaveBeenCalledTimes(2)
        expect(mocks.inspect).toHaveBeenCalledTimes(2)
        expect(mocks.upload).not.toHaveBeenCalled()
        expect(generationAttempts(progress)).toEqual([1, 2])
        expect(progress.at(-1)).toMatchObject({ attempt: 2, maxAttempts: 2, timings: { retryCount: 1 } })
    })

    it('does not return to the original model for a third attempt if the alternate model fails', async () => {
        mocks.inspect.mockResolvedValue({ ...rejected, angleMatch: false })
        mocks.qwen.mockRejectedValue(new Error('alternate provider unavailable'))
        const progress: ReferenceGenerationProgress[] = []
        await expect(generate(progress)).rejects.toThrow('alternate provider unavailable')
        expect(mocks.banana).toHaveBeenCalledTimes(1)
        expect(mocks.qwen).toHaveBeenCalledTimes(1)
        expect(generationAttempts(progress)).toEqual([1, 2])
        expect(mocks.upload).not.toHaveBeenCalled()
    })
})
