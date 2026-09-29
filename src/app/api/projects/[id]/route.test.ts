import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    transaction: vi.fn(),
    markStale: vi.fn(),
    projectFindFirst: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction, project: { findFirst: mocks.projectFindFirst } } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/services/content-lineage', () => ({ markProjectDownstreamStaleInTransaction: mocks.markStale }))
vi.mock('@/lib/operation-cancellation', () => ({ cancelProjectOperations: vi.fn() }))
vi.mock('@/services/setup-characters', () => ({ syncSetupCharactersInTransaction: vi.fn() }))

import { GET, PATCH } from './route'
import { parseNovelSetup, stringifyNovelSetup } from '@/lib/novel'
import { getChapterProgress } from '@/lib/chapter-progress'

function transactionFixture() {
    return {
        projectAiJob: { updateMany: vi.fn() },
        extractJob: { updateMany: vi.fn() },
        outlineJob: { updateMany: vi.fn() },
        episode: { createMany: vi.fn(), updateMany: vi.fn() },
        project: { update: vi.fn().mockResolvedValue({ id: 456n, title: '雨夜追凶' }) }
    }
}

function patchRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost:3000/api/projects/456', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertProjectOwner.mockResolvedValue(null)
})

describe('PATCH /api/projects/[id]', () => {
    it('renames a project without cancelling work or invalidating generated content', async () => {
        const tx = transactionFixture()
        mocks.transaction.mockImplementation(callback => callback(tx))

        const response = await PATCH(patchRequest({ title: '  雨夜追凶  ' }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(200)
        expect(tx.project.update).toHaveBeenCalledWith({
            where: { id: 456n },
            data: { title: '雨夜追凶' }
        })
        expect(tx.projectAiJob.updateMany).not.toHaveBeenCalled()
        expect(tx.extractJob.updateMany).not.toHaveBeenCalled()
        expect(tx.outlineJob.updateMany).not.toHaveBeenCalled()
        expect(mocks.markStale).not.toHaveBeenCalled()
    })

    it('still invalidates downstream content when story settings change', async () => {
        const tx = transactionFixture()
        mocks.transaction.mockImplementation(callback => callback(tx))

        const response = await PATCH(patchRequest({ description: '新的故事简介' }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(200)
        expect(tx.projectAiJob.updateMany).toHaveBeenCalledOnce()
        expect(tx.extractJob.updateMany).toHaveBeenCalledOnce()
        expect(tx.outlineJob.updateMany).toHaveBeenCalledOnce()
        expect(mocks.markStale).toHaveBeenCalledWith(tx, 456n, expect.any(String))
        expect(tx.project.update).toHaveBeenCalledWith({
            where: { id: 456n },
            data: {
                description: '新的故事简介',
                operationVersion: { increment: 1 },
                sourceVersion: { increment: 1 }
            }
        })
    })

    it('persists the complete novel setup and returns the stored value', async () => {
        const novelSetup = JSON.stringify({ primaryGenre: '奇幻', perspective: '第三人称', outline: '少年进入森林寻找失踪的伙伴。' })
        const persistedNovelSetup = stringifyNovelSetup(parseNovelSetup(novelSetup))
        const tx = transactionFixture()
        tx.project.update.mockResolvedValue({ id: 456n, novelSetup: persistedNovelSetup })
        mocks.transaction.mockImplementation(callback => callback(tx))

        const response = await PATCH(patchRequest({ novelSetup }), { params: Promise.resolve({ id: '456' }) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.novelSetup).toBe(persistedNovelSetup)
        expect(tx.project.update).toHaveBeenCalledWith({
            where: { id: 456n },
            data: {
                novelSetup: persistedNovelSetup,
                videoAspectRatio: '9:16',
                visualStyle: 'cinematic',
                contentLanguage: 'zh',
                episodeFormat: 'micro',
                operationVersion: { increment: 1 },
                sourceVersion: { increment: 1 }
            }
        })
    })

    it('changes the episode rows and saved episode count in one transaction', async () => {
        mocks.projectFindFirst.mockResolvedValue({ id: 456n, totalEpisodes: 1, episodes: [{ id: 11n, episodeNumber: 1, status: 'draft', chapterContent: null, script: null }] })
        const tx = transactionFixture()
        tx.project.update.mockResolvedValue({ id: 456n, totalEpisodes: 3 })
        mocks.transaction.mockImplementation(callback => callback(tx))

        const response = await PATCH(patchRequest({ totalEpisodes: 3 }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(200)
        expect(tx.episode.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ projectId: 456n, episodeNumber: 2, title: '第2章' }), expect.objectContaining({ projectId: 456n, episodeNumber: 3, title: '第3章' })]
        })
        expect(tx.project.update).toHaveBeenCalledWith({
            where: { id: 456n },
            data: {
                totalEpisodes: 3,
                operationVersion: { increment: 1 },
                sourceVersion: { increment: 1 }
            }
        })
    })
})

describe('GET /api/projects/[id]', () => {
    it('preserves chapter and script progress for all 12 finished episodes without returning long text', async () => {
        mocks.projectFindFirst.mockResolvedValue({
            id: 456n,
            status: 'in_production',
            totalEpisodes: 12,
            episodes: Array.from({ length: 12 }, (_, index) => ({
                id: BigInt(index + 1),
                episodeNumber: index + 1,
                status: 'completed',
                videoUrl: `https://media.example.test/episode-${index + 1}.mp4`
            }))
        })

        const response = await GET(new NextRequest('http://localhost:3000/api/projects/456'), { params: Promise.resolve({ id: '456' }) })
        const { data } = await response.json()

        expect(response.status).toBe(200)
        expect(data.episodes).toHaveLength(12)
        expect(data).toMatchObject({ status: 'completed', completedEpisodes: 12 })
        for (const episode of data.episodes) {
            expect(episode).toMatchObject({ hasChapterContent: true, hasScript: true, hasMergedVideo: true, chapterContent: null, script: null })
            expect(episode).not.toHaveProperty('videoUrl')
        }
        expect(getChapterProgress(data.episodes)).toEqual({ total: 12, generated: 12, finalized: 12, missing: 0, allFinalized: true })
    })

    it.each([
        ['outlined', false, false],
        ['drafted', true, false],
        ['scripting', true, false],
        ['storyboarding', true, true],
        ['generating', true, true]
    ])('reports the upstream content stages while an episode is %s', async (status, hasChapterContent, hasScript) => {
        mocks.projectFindFirst.mockResolvedValue({ id: 456n, episodes: [{ id: 1n, status }] })

        const response = await GET(new NextRequest('http://localhost:3000/api/projects/456'), { params: Promise.resolve({ id: '456' }) })
        const { data } = await response.json()

        expect(response.status).toBe(200)
        expect(data.episodes[0]).toMatchObject({ hasChapterContent, hasScript, chapterContent: null, script: null })
    })

    it('prevents stale project settings from being cached', async () => {
        mocks.projectFindFirst.mockResolvedValue({
            id: 456n,
            novelSetup: JSON.stringify({ primaryGenre: '奇幻', outline: '森林冒险' }),
            episodes: []
        })

        const response = await GET(new NextRequest('http://localhost:3000/api/projects/456'), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    })
})
