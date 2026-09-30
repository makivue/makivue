import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ image: vi.fn(), save: vi.fn(), generation: vi.fn(), updateGeneration: vi.fn(), storyboard: vi.fn(), updateStoryboard: vi.fn(), lock: vi.fn(), rewrite: vi.fn() }))
vi.mock('@/lib/prisma', () => {
    const prisma = {
        generation: { findUnique: mocks.generation, updateMany: mocks.updateGeneration },
        storyboard: { findFirst: mocks.storyboard, findUnique: mocks.storyboard, updateMany: mocks.updateStoryboard },
        project: { findFirst: vi.fn().mockResolvedValue({ id: 3n, novelSetup: null }) },
        aiServiceConfig: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: async (run: (tx: unknown) => unknown) => run(prisma)
    }
    return { prisma }
})
vi.mock('./banana', () => ({ BananaImageSafetyError: class extends Error {}, generateImageWithBanana: mocks.image }))
vi.mock('./llm', () => ({ rewriteImagePromptForSafety: mocks.rewrite }))
vi.mock('./billing', () => ({ chargeGenerationUsage: vi.fn() }))
vi.mock('./wallet-reservations', () => ({ releaseModelReservations: vi.fn() }))
vi.mock('./artifacts', () => ({ StaleStoryboardMutationError: class extends Error {}, lockStoryboardMediaInTransaction: mocks.lock, clearEpisodeMergedVideoInTransaction: vi.fn() }))
vi.mock('./local-media', () => ({ saveImmutableLocalImage: mocks.save, saveLocalMediaFile: mocks.save, toLocalMediaUrl: (url: string) => url }))
vi.mock('@/lib/himodels-usage-context.server', () => ({ withHiModelsUsageScope: (_scope: unknown, run: () => unknown) => run() }))
import { generateFrame } from './ai'
const shot = {
    id: 1n,
    imagePrompt: 'Mira at a desk',
    actionDesc: 'Mira opens a letter',
    negativePrompt: null,
    videoPrompt: null,
    duration: 5,
    dialogue: '',
    audioUrl: null,
    firstFrameUrl: null,
    lastFrameUrl: null,
    scene: { id: 8n, locationPrompt: 'A quiet office' },
    characters: [{ character: { id: 7n, name: 'Mira', appearancePrompt: 'Blue jacket', referenceImageUrl: '/api/local-media/mira.png' } }]
}
beforeEach(() => {
    vi.resetAllMocks()
    mocks.generation.mockResolvedValue({ status: 'processing', resourceVersion: 2, storyboard: { episode: { project: { userId: 1n } } } })
    mocks.storyboard.mockResolvedValue({ id: 1n, episodeId: 2n, order: 1, operationVersion: 2, deletedAt: null, episode: { projectId: 3n } })
    mocks.updateGeneration.mockResolvedValue({ count: 1 })
    mocks.updateStoryboard.mockResolvedValue({ count: 1 })
    mocks.save.mockResolvedValue('/api/local-media/frame.png')
    mocks.image.mockResolvedValue({ localPath: '/mock/frame.png' })
})
describe('basic storyboard illustration', () => {
    it('uses one image request with character references and saves without polishing', async () => {
        expect(await generateFrame(9n, shot, 'first_frame', { provider: 'banana' })).toBe(true)
        expect(mocks.image).toHaveBeenCalledOnce()
        expect(mocks.image.mock.calls[0][0]).toMatchObject({ referenceImages: ['/api/local-media/mira.png'], prompt: expect.stringContaining('Mira at a desk') })
        expect(mocks.rewrite).not.toHaveBeenCalled()
        expect(mocks.save).toHaveBeenCalledOnce()
        expect(mocks.lock).toHaveBeenCalledOnce()
        expect(mocks.updateStoryboard).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 1n, deletedAt: null, operationVersion: 2 }, data: expect.objectContaining({ firstFrameUrl: '/api/local-media/frame.png', videoUrl: null }) })
        )
    })
    it('does not call a model or save if the storyboard changed before generation', async () => {
        mocks.storyboard.mockResolvedValue({ id: 1n, episodeId: 2n, operationVersion: 3, episode: { projectId: 3n } })
        expect(await generateFrame(9n, shot, 'first_frame', { provider: 'banana' })).toBe(false)
        expect(mocks.image).not.toHaveBeenCalled()
        expect(mocks.save).not.toHaveBeenCalled()
        expect(mocks.updateGeneration).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }))
    })
    it('does not write a storyboard result if cancelled while the provider is running', async () => {
        mocks.image.mockImplementation(async () => {
            mocks.generation.mockResolvedValue({ status: 'cancelled', resourceVersion: 2 })
            return { localPath: '/mock/frame.png' }
        })
        expect(await generateFrame(9n, shot, 'first_frame', { provider: 'banana' })).toBe(false)
        expect(mocks.save).not.toHaveBeenCalled()
        expect(mocks.updateStoryboard).not.toHaveBeenCalled()
    })
})
