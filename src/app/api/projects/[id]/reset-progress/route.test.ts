import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { issueDestructiveOperationToken } from '@/lib/destructive-operation-token'
import { parseNovelSetup } from '@/lib/novel'

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    transaction: vi.fn(),
    cancel: vi.fn(),
    replace: vi.fn(),
    finish: vi.fn(),
    clearEntities: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({ prisma: { project: { findFirst: mocks.findFirst }, $transaction: mocks.transaction } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/lib/operation-cancellation', () => ({ cancelProjectOperationsInTransaction: mocks.cancel }))
vi.mock('@/services/episode-storyboard-replacement', () => ({ supersedeEpisodeStoryboardDataInTransaction: mocks.replace }))
vi.mock('@/services/episode-downstream-reset', () => ({ finishEpisodeDownstreamReset: mocks.finish }))
vi.mock('@/services/extracted-entities', () => ({ clearProjectExtractedEntitiesInTransaction: mocks.clearEntities }))

import { POST } from './route'

function transactionFixture() {
    const deleteOnly = () => ({ deleteMany: vi.fn() })
    return {
        $queryRaw: vi.fn(),
        project: {
            findUnique: vi.fn().mockResolvedValue({
                operationVersion: 4,
                deletedAt: null,
                novelSetup: JSON.stringify({ coreSeed: '保留设定', episodeStatePlan: [{ episodeNumber: 1 }], factLedger: [{ episodeNumber: 1 }] })
            }),
            update: vi.fn()
        },
        episode: { findMany: vi.fn().mockResolvedValue([{ id: 10n }, { id: 11n }]), deleteMany: vi.fn(), createMany: vi.fn() },
        storyboard: { findMany: vi.fn().mockResolvedValue([{ id: 1n }, { id: 9n }]), deleteMany: vi.fn() },
        characterStateEvent: { updateMany: vi.fn() },
        qualityReview: deleteOnly(),
        productionEvent: { ...deleteOnly(), create: vi.fn() },
        generation: deleteOnly(),
        storyboardCharacter: deleteOnly(),
        batchJob: deleteOnly(),
        chapterJob: deleteOnly(),
        scriptJob: deleteOnly(),
        storyboardJob: deleteOnly(),
        epJob: deleteOnly(),
        videoMerge: deleteOnly(),
        extractJob: deleteOnly()
    }
}

function confirmedRequest() {
    return new NextRequest('http://localhost:3000/api/projects/456/reset-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationToken: issueDestructiveOperationToken({ projectId: 456n, operationVersion: 4, scope: 'outline-reset' }) })
    })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertProjectOwner.mockResolvedValue(null)
    mocks.findFirst.mockResolvedValue({
        id: 456n,
        operationVersion: 4,
        totalEpisodes: 2,
        episodes: [
            { id: 10n, episodeNumber: 1, status: 'storyboarded', chapterContent: 'chapter', script: null, storyboards: [{ id: 1n }] },
            { id: 11n, episodeNumber: 2, status: 'scripted', chapterContent: null, script: 'script', storyboards: [] }
        ]
    })
    mocks.cancel.mockResolvedValue({ episodeIds: [10n, 11n], storyboardIds: [1n], epJobIds: [77n] })
    mocks.replace.mockResolvedValue({ epJobIds: [], artifacts: [{ url: '/storage/videos/old.mp4', subdir: 'videos/10' }] })
    mocks.clearEntities.mockResolvedValue({ removedCharacters: 5, removedScenes: 16 })
})

describe('POST /api/projects/[id]/reset-progress', () => {
    it('returns the confirmation challenge as a successful preparation response', async () => {
        const request = new NextRequest('http://localhost:3000/api/projects/456/reset-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })

        const response = await POST(request, { params: Promise.resolve({ id: '456' }) })
        const payload = await response.json()

        expect(response.status).toBe(200)
        expect(payload).toMatchObject({
            success: true,
            data: {
                confirmationRequired: true,
                operationVersion: 4,
                impact: { episodes: 2, storyboards: 1, chapters: 1, scripts: 1 }
            }
        })
        expect(payload.data.confirmationToken).toEqual(expect.any(String))
        expect(mocks.cancel).not.toHaveBeenCalled()
        expect(mocks.finish).not.toHaveBeenCalled()
        expect(mocks.clearEntities).not.toHaveBeenCalled()
    })

    it('clears the entire old graph including tombstones, facts and planned character states', async () => {
        const tx = transactionFixture()
        let committed = false
        mocks.transaction.mockImplementation(async callback => {
            const result = await callback(tx)
            committed = true
            return result
        })
        mocks.finish.mockImplementation(async () => {
            expect(committed).toBe(true)
        })
        const response = await POST(confirmedRequest(), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(200)
        expect(mocks.cancel).toHaveBeenCalledWith(tx, 456n, expect.any(String))
        expect(mocks.replace).toHaveBeenCalledTimes(2)
        expect(tx.extractJob.deleteMany).toHaveBeenCalledWith({ where: { projectId: 456n } })
        expect(mocks.clearEntities).toHaveBeenCalledWith(tx, 456n)
        expect((await response.json()).data).toMatchObject({ episodes: 2, storyboards: 2, characters: 5, scenes: 16 })
        // No deletedAt filter: tombstones must be removed before their parents.
        expect(tx.episode.findMany).toHaveBeenCalledWith({ where: { projectId: 456n }, select: { id: true } })
        expect(tx.storyboard.findMany).toHaveBeenCalledWith({ where: { episodeId: { in: [10n, 11n] } }, select: { id: true } })
        expect(tx.storyboard.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1n, 9n] } } })
        expect(tx.episode.createMany.mock.calls[0][0].data).toHaveLength(2)
        expect(tx.episode.createMany.mock.calls[0][0].data.every((row: Record<string, unknown>) => row.status === 'outlined' && !row.script && !row.chapterContent)).toBe(true)
        expect(tx.characterStateEvent.updateMany).toHaveBeenCalledWith({ where: { projectId: 456n, status: 'active', sourceType: 'storyboard_plan' }, data: { status: 'superseded' } })
        const update = tx.project.update.mock.calls[0][0].data
        expect(update).toMatchObject({ contentFacts: Prisma.DbNull, staleScopes: Prisma.DbNull, sourceVersion: { increment: 1 }, novelStage: 'outlined' })
        expect(parseNovelSetup(update.novelSetup)).toMatchObject({ coreSeed: '保留设定', episodeStatePlan: [], factLedger: [] })
        expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ epJobIds: [77n], artifacts: expect.any(Array) }))
    })

    it('rejects a reset when its confirmed version changes before acquiring the lock', async () => {
        const tx = transactionFixture()
        tx.project.findUnique.mockResolvedValue({ operationVersion: 5, deletedAt: null, novelSetup: null })
        mocks.transaction.mockImplementation(callback => callback(tx))
        const response = await POST(confirmedRequest(), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(409)
        expect(mocks.cancel).not.toHaveBeenCalled()
        expect(tx.episode.deleteMany).not.toHaveBeenCalled()
        expect(mocks.finish).not.toHaveBeenCalled()
    })

    it('does not return a successful challenge when a confirmed reset is already stale', async () => {
        mocks.findFirst.mockResolvedValue({ id: 456n, operationVersion: 5, totalEpisodes: 2, episodes: [] })
        const response = await POST(confirmedRequest(), { params: Promise.resolve({ id: '456' }) })
        expect(response.status).toBe(409)
        expect((await response.json()).success).toBe(false)
        expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('does not delete stored media when the reset transaction fails', async () => {
        const tx = transactionFixture()
        tx.episode.createMany.mockRejectedValue(new Error('rollback'))
        mocks.transaction.mockImplementation(callback => callback(tx))
        await expect(POST(confirmedRequest(), { params: Promise.resolve({ id: '456' }) })).rejects.toThrow('rollback')
        expect(mocks.finish).not.toHaveBeenCalled()
    })
})
