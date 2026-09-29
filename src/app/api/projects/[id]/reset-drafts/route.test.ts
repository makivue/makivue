import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn(), reset: vi.fn(), finish: vi.fn(), cancel: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findFirst: mocks.find }, $transaction: mocks.transaction } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 1n }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: async () => null }))
vi.mock('@/services/episode-downstream-reset', () => ({ resetEpisodeDownstreamInTransaction: mocks.reset, finishEpisodeDownstreamReset: mocks.finish }))
vi.mock('@/lib/operation-cancellation', () => ({ cancelProjectOperationsInTransaction: mocks.cancel }))
vi.mock('@/services/extracted-entities', () => ({ clearProjectExtractedEntitiesInTransaction: mocks.clear }))
import { POST } from './route'

describe('draft reset', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mocks.find.mockResolvedValue({ id: 1n })
        mocks.reset.mockResolvedValue({ patch: { chapterContent: null, script: null, videoUrl: null, status: 'outlined' }, artifacts: [], epJobIds: [] })
        mocks.cancel.mockResolvedValue({ epJobIds: [77n] })
    })

    it('clears descendants and advances the content version so cached prose is discarded', async () => {
        const episode = { id: 2n, projectId: 1n, episodeNumber: 1, status: 'drafted', chapterContent: '旧正文' }
        const tx = {
            $queryRaw: vi.fn(),
            episode: { findMany: vi.fn().mockResolvedValue([episode]), findUnique: vi.fn().mockResolvedValue(episode), update: vi.fn() },
            project: { update: vi.fn() },
            extractJob: { deleteMany: vi.fn() }
        }
        mocks.transaction.mockImplementation(callback => callback(tx))
        const res = await POST(new NextRequest('http://localhost/api/projects/1/reset-drafts', { method: 'POST', body: JSON.stringify({ clearAllDownstream: true }) }), {
            params: Promise.resolve({ id: '1' })
        })
        expect(res.status).toBe(200)
        expect(mocks.reset).toHaveBeenCalledWith(tx, episode, 'outline')
        expect(tx.episode.update).toHaveBeenCalledWith({
            where: { id: 2n },
            data: expect.objectContaining({ chapterContent: null, script: null, sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } })
        })
        expect(mocks.finish).toHaveBeenCalledOnce()
    })

    it.each(['finalized', 'scripted', 'storyboarded'])('clears %s chapters too when the user confirms rewriting from the outline', async status => {
        const tx = {
            $queryRaw: vi.fn(),
            episode: { findMany: vi.fn().mockResolvedValue([{ id: 2n, episodeNumber: 1 }]), findUnique: vi.fn().mockResolvedValue({ id: 2n, status }), update: vi.fn() },
            project: { update: vi.fn() },
            extractJob: { deleteMany: vi.fn() }
        }
        mocks.transaction.mockImplementation(callback => callback(tx))
        const res = await POST(new NextRequest('http://localhost/api/projects/1/reset-drafts', { method: 'POST', body: JSON.stringify({ clearAllDownstream: true }) }), {
            params: Promise.resolve({ id: '1' })
        })
        expect((await res.json()).data.cleared).toBe(1)
        expect(mocks.reset).toHaveBeenCalledWith(tx, { id: 2n, status }, 'outline')
        expect(mocks.clear).toHaveBeenCalledWith(tx, 1n)
        expect(tx.extractJob.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1n } })
        expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ epJobIds: [77n] }))
    })

    it('does not clear finalized work for a legacy request that only confirmed unfinished drafts', async () => {
        const res = await POST(new NextRequest('http://localhost/api/projects/1/reset-drafts', { method: 'POST' }), { params: Promise.resolve({ id: '1' }) })
        expect(res.status).toBe(409)
        expect(mocks.transaction).not.toHaveBeenCalled()
    })
})
