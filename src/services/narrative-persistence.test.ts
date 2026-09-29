import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), review: vi.fn(), reset: vi.fn(), finish: vi.fn(), following: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: async (callback: (tx: unknown) => unknown) =>
            callback({
                $queryRaw: vi.fn(),
                episode: { findUnique: mocks.find, update: mocks.update },
                qualityReview: { create: mocks.review }
            })
    }
}))
vi.mock('./content-lineage', () => ({ markFollowingEpisodesStaleInTransaction: mocks.following }))
vi.mock('./episode-downstream-reset', async importOriginal => ({
    ...(await importOriginal<typeof import('./episode-downstream-reset')>()),
    resetEpisodeDownstreamInTransaction: mocks.reset,
    finishEpisodeDownstreamReset: mocks.finish
}))
vi.mock('@/lib/id', () => ({ genId: () => 99n }))

import { saveReviewedNarrative } from './narrative-persistence'
import type { ObservedEpisodeFacts } from './narrative-facts'
import { episodeDownstreamResetPatch } from './episode-downstream-reset'

const episode = {
    id: 1n,
    projectId: 2n,
    episodeNumber: 1,
    sourceVersion: 3,
    operationVersion: 4,
    title: '原大纲标题',
    synopsis: '详细事件和动机'.repeat(60),
    script: '旧剧本',
    chapterContent: '定稿正文',
    finalizedAt: new Date('2026-09-01'),
    contentFacts: { adaptation: { title: '旧改编标题' } },
    deletedAt: null
}
const facts: ObservedEpisodeFacts = {
    kind: 'observed',
    sourceStage: 'script',
    sourceHash: 'hash',
    episodeNumber: 1,
    sourceVersion: 1,
    summary: '新摘要',
    openingState: '门口',
    endingState: '室内',
    characterStateChanges: '收到信封',
    continuityBridge: '推门',
    events: [{ description: '推门', evidence: '新剧本' }]
}

describe('reviewed narrative persistence', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mocks.find.mockResolvedValue(episode)
        mocks.update.mockImplementation(async ({ data }) => ({ ...episode, ...data }))
        mocks.reset.mockImplementation(async (_tx, row, stage) => ({ patch: episodeDownstreamResetPatch(stage, row.contentFacts), artifacts: [], epJobIds: [] }))
    })

    it('retains the source outline and invalidates dependent media when a script is regenerated', async () => {
        await saveReviewedNarrative({ episode, stage: 'script', content: '新剧本', facts, adaptation: { title: '改编标题', synopsis: '改编摘要' } })
        const data = mocks.update.mock.calls[0][0].data
        expect(data).not.toHaveProperty('title')
        expect(data).not.toHaveProperty('synopsis')
        expect(data.contentFacts.adaptation).toEqual({ title: '改编标题', synopsis: '改编摘要' })
        expect(data.videoUrl).toBeNull()
        expect(data).not.toHaveProperty('chapterContent')
        expect(mocks.reset).toHaveBeenCalledWith(expect.anything(), episode, 'script')
        expect(mocks.finish).toHaveBeenCalledOnce()
        expect(mocks.following).toHaveBeenCalledWith(expect.anything(), 2n, 1, 'script')
    })

    it('never overwrites an edit made while the model was generating', async () => {
        mocks.find.mockResolvedValue({ ...episode, sourceVersion: 4 })
        const settleUsage = vi.fn()
        await expect(saveReviewedNarrative({ episode, stage: 'script', content: '过期结果', facts, settleUsage })).rejects.toThrow('未覆盖新版本')
        expect(settleUsage).not.toHaveBeenCalled()
        expect(mocks.update).not.toHaveBeenCalled()
        expect(mocks.reset).not.toHaveBeenCalled()
        expect(mocks.finish).not.toHaveBeenCalled()
    })

    it('clears the old adaptation, script, and finalization when a chapter is regenerated', async () => {
        await saveReviewedNarrative({ episode, stage: 'chapter', content: '新正文', facts: { ...facts, sourceStage: 'chapter' } })
        expect(mocks.update.mock.calls[0][0].data).toMatchObject({
            chapterContent: '新正文',
            script: null,
            videoUrl: null,
            finalizedAt: null,
            status: 'drafted',
            contentFacts: { adaptation: null, script: null }
        })
    })

    it('persists an unmet length target as a review warning instead of a blocker', async () => {
        const issues = [{ path: 'chapterContent', code: 'too_short', message: '正文低于建议下限' }]
        await saveReviewedNarrative({ episode, stage: 'chapter', content: '较短正文', facts: { ...facts, sourceStage: 'chapter' }, issues })

        expect(mocks.review).toHaveBeenCalledWith({
            data: expect.objectContaining({
                status: 'needs_review',
                issueCount: 1,
                blockerCount: 0,
                issues,
                redoPlan: expect.objectContaining({ lengthWarning: true })
            })
        })
    })

    it('resets explicit regenerations even when the model returns identical script text', async () => {
        await saveReviewedNarrative({ episode, stage: 'script', content: episode.script, facts })
        expect(mocks.reset).toHaveBeenCalledOnce()
        expect(mocks.following).not.toHaveBeenCalled()
    })

    it('does not clean stored files when the transaction fails', async () => {
        mocks.review.mockRejectedValue(new Error('transaction failed'))
        await expect(saveReviewedNarrative({ episode, stage: 'script', content: '新剧本', facts })).rejects.toThrow('transaction failed')
        expect(mocks.finish).not.toHaveBeenCalled()
    })

    it('settles using the result transaction and rejects delivery when settlement fails', async () => {
        const settleUsage = vi.fn().mockRejectedValue(new Error('usage missing'))
        await expect(saveReviewedNarrative({ episode, stage: 'script', content: '新剧本', facts, settleUsage })).rejects.toThrow('usage missing')
        expect(settleUsage).toHaveBeenCalledWith(expect.objectContaining({ episode: expect.objectContaining({ update: mocks.update }) }))
        expect(mocks.update).not.toHaveBeenCalled()
        expect(mocks.reset).not.toHaveBeenCalled()
        expect(mocks.finish).not.toHaveBeenCalled()
    })
})
