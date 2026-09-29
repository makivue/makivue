import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('./oss', () => ({ deleteOSSObjectWithinSubdir: vi.fn() }))
import {
    clearEpisodeMergedVideoInTransaction,
    invalidationPatch,
    resetEpisodeGeneratedMedia,
    resetFollowingContinuousMediaInTransaction,
    resetStoryboardMediaInTransaction,
    StaleStoryboardMutationError
} from './artifacts'

function shot(id = 1n, order = 1, continuityMode = 'independent') {
    return {
        id,
        episodeId: 8n,
        order,
        continuityMode,
        operationVersion: 3,
        deletedAt: null,
        firstFrameUrl: 'frame.png',
        audioUrl: 'voice.mp3',
        videoUrl: 'video.mp4',
        composedVideoUrl: 'mix.mp4',
        frameStatus: 'completed',
        videoStatus: 'completed',
        audioStatus: 'completed',
        composeStatus: 'completed'
    }
}

function transaction(rows = [shot()]) {
    return {
        $queryRaw: vi.fn(),
        storyboard: {
            findUnique: vi.fn(async ({ where }) => rows.find(row => row.id === where.id)),
            findMany: vi.fn().mockResolvedValue(rows),
            update: vi.fn(async ({ where, data }) => ({ ...rows.find(row => row.id === where.id), ...data, operationVersion: 4 }))
        },
        generation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        episode: { updateMany: vi.fn() },
        videoMerge: { deleteMany: vi.fn() },
        qualityReview: { deleteMany: vi.fn() }
    }
}

describe('media dependency invalidation', () => {
    beforeEach(() => vi.clearAllMocks())

    it('clears image descendants and subtitles while preserving independent voice audio', () => {
        const patch = invalidationPatch(['frame'])
        expect(patch).toMatchObject({
            firstFrameUrl: null,
            plannedLastFrameUrl: null,
            actualVideoEndFrameUrl: null,
            videoUrl: null,
            expectedAudioMode: null,
            subtitles: null,
            composedVideoUrl: null,
            compositionMode: null
        })
        expect(patch).not.toHaveProperty('audioUrl')
    })

    it('clears subtitles and mix for new audio, but preserves images and raw video', () => {
        const patch = invalidationPatch(['audio'])
        expect(patch).toMatchObject({ audioUrl: null, subtitles: null, composedVideoUrl: null, composeStatus: 'pending' })
        expect(patch).not.toHaveProperty('firstFrameUrl')
        expect(patch).not.toHaveProperty('videoUrl')
        expect(invalidationPatch(['compose'])).not.toHaveProperty('subtitles')
    })

    it('invalidates all episode merges, their callbacks and the completed episode state', async () => {
        const tx = transaction()
        await clearEpisodeMergedVideoInTransaction(tx as never, 8n)
        expect(tx.episode.updateMany).toHaveBeenCalledWith({ where: { id: 8n, deletedAt: null }, data: { videoUrl: null, operationVersion: { increment: 1 } } })
        expect(tx.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'completed' }), data: { status: 'storyboarded' } }))
        expect(tx.videoMerge.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 8n } })
        expect(tx.qualityReview.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 8n, scope: { in: ['merge', 'subtitle'] } } })
    })

    it('keeps only the newly claimed job and binds it to the new resource version', async () => {
        const tx = transaction()
        const updated = await resetStoryboardMediaInTransaction(tx as never, shot(), ['frame'], 'regenerate', { preserveGenerationId: 20n, patch: { frameStatus: 'generating' } })
        expect(updated.operationVersion).toBe(4)
        expect(tx.generation.updateMany).toHaveBeenCalledWith({
            where: { storyboardId: 1n, status: { in: ['queued', 'processing'] }, id: { not: 20n } },
            data: { status: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null, errorMsg: 'regenerate' }
        })
        expect(tx.generation.updateMany).toHaveBeenCalledWith({ where: { id: 20n, status: { in: ['queued', 'processing'] }, resourceVersion: 3 }, data: { resourceVersion: 4 } })
        expect(tx.generation.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { storyboardId: 1n, type: 'middle_frame', status: 'completed' }, data: expect.objectContaining({ status: 'archived' }) })
        )
        expect(updated.frameStatus).toBe('generating')
        expect(updated.audioUrl).toBe('voice.mp3')
        expect(tx.videoMerge.deleteMany).toHaveBeenCalled()
    })

    it.each([{ operationVersion: 2 }, { episodeId: 9n }])('rejects obsolete or mismatched targets before cancelling new work', async patch => {
        const tx = transaction()
        await expect(resetStoryboardMediaInTransaction(tx as never, { ...shot(), ...patch }, ['frame'], 'edit')).rejects.toBeInstanceOf(StaleStoryboardMutationError)
        expect(tx.generation.updateMany).not.toHaveBeenCalled()
        expect(tx.storyboard.update).not.toHaveBeenCalled()
    })

    it('propagates through every continuous successor and stops at a cut', async () => {
        const rows = [shot(2n, 2, 'continuous'), shot(3n, 3, 'seamless'), shot(4n, 4), shot(5n, 5, 'continuous')]
        const tx = transaction(rows)
        await resetFollowingContinuousMediaInTransaction(tx as never, 8n, 1)
        expect(tx.storyboard.update.mock.calls.map(([args]) => args.where.id)).toEqual([2n, 3n])
        for (const [args] of tx.storyboard.update.mock.calls) {
            expect(args.data).toMatchObject({ firstFrameUrl: null, videoUrl: null, subtitles: null, operationVersion: { increment: 1 } })
            expect(args.data).not.toHaveProperty('audioUrl')
        }
    })

    it('does not reset a newer episode using an old regenerate-all snapshot', async () => {
        const tx = { $queryRaw: vi.fn(), episode: { findFirst: vi.fn().mockResolvedValue({ operationVersion: 4 }) }, generation: { deleteMany: vi.fn() } }
        mocks.transaction.mockImplementation(callback => callback(tx))
        await expect(resetEpisodeGeneratedMedia(8n, 3)).rejects.toBeInstanceOf(StaleStoryboardMutationError)
        expect(tx.generation.deleteMany).not.toHaveBeenCalled()
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.episode.findFirst.mock.invocationCallOrder[0])
    })
})
