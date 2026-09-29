import { describe, expect, it, vi } from 'vitest'
import { markFollowingEpisodesStaleInTransaction, markReferenceDependentsStaleInTransaction } from './content-lineage'

function transaction() {
    return {
        $queryRaw: vi.fn(),
        episode: {
            findMany: vi
                .fn()
                .mockResolvedValueOnce([{ id: 2n }])
                .mockResolvedValueOnce([]),
            updateMany: vi.fn()
        },
        chapterJob: { updateMany: vi.fn() },
        scriptJob: { updateMany: vi.fn() },
        storyboardJob: { updateMany: vi.fn() },
        storyboard: { findMany: vi.fn() }
    }
}

describe('dependent narrative operations', () => {
    it('invalidates a later first generation even before it has saved any text', async () => {
        const tx = transaction()
        await markFollowingEpisodesStaleInTransaction(tx as never, 1n, 1, 'chapter')
        expect(tx.episode.updateMany).toHaveBeenCalledWith({ where: { id: { in: [2n] } }, data: { operationVersion: { increment: 1 } } })
        expect(tx.chapterJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'error', activeKey: null }) }))
        expect(tx.scriptJob.updateMany).toHaveBeenCalled()
        expect(tx.storyboardJob.updateMany).toHaveBeenCalled()
        expect(tx.storyboard.findMany).not.toHaveBeenCalled()
    })

    it('releases the storyboarding state and only cancels adaptation jobs after a script change', async () => {
        const tx = transaction()
        await markFollowingEpisodesStaleInTransaction(tx as never, 1n, 1, 'script')
        expect(tx.episode.updateMany).toHaveBeenCalledWith({ where: { id: { in: [2n] }, status: 'storyboarding' }, data: { status: 'scripted' } })
        expect(tx.chapterJob.updateMany).not.toHaveBeenCalled()
        expect(tx.scriptJob.updateMany).toHaveBeenCalled()
        expect(tx.storyboardJob.updateMany).toHaveBeenCalled()
    })
})

describe('reference media dependencies', () => {
    function referenceTransaction() {
        return {
            $queryRaw: vi.fn(),
            storyboard: {
                findMany: vi
                    .fn()
                    .mockResolvedValueOnce([{ id: 3n, episodeId: 2n, order: 1 }])
                    .mockResolvedValue([]),
                updateMany: vi.fn()
            },
            generation: { updateMany: vi.fn() },
            episode: { updateMany: vi.fn() },
            epJob: { updateMany: vi.fn() },
            batchJob: { updateMany: vi.fn() },
            videoMerge: { deleteMany: vi.fn() },
            qualityReview: { deleteMany: vi.fn() },
            project: { findUnique: vi.fn().mockResolvedValue({ staleScopes: [] }), update: vi.fn() }
        }
    }

    it('removes obsolete URLs after a reference selection and cancels queued batch work', async () => {
        const tx = referenceTransaction()
        await markReferenceDependentsStaleInTransaction(tx as never, { type: 'scene', id: 5n, projectId: 1n }, 'scene changed')
        const patch = tx.storyboard.updateMany.mock.calls.find(([args]) => args.data.operationVersion)?.[0].data
        expect(patch).toMatchObject({ firstFrameUrl: null, videoUrl: null, composedVideoUrl: null, subtitles: null, staleReason: 'scene changed' })
        expect(patch).not.toHaveProperty('audioUrl')
        expect(tx.generation.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null }) })
        )
        expect(tx.videoMerge.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 2n } })
        expect(tx.epJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'cancelled' }) }))

        // Raw locks must use MariaDB column names, not Prisma's camelCase fields.

    })
})
