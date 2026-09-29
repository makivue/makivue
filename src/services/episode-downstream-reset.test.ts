import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@/generated/prisma/client'

const replace = vi.hoisted(() => vi.fn().mockResolvedValue({ storyboardIds: [9n], epJobIds: [], artifacts: [] }))
const clearEntities = vi.hoisted(() => vi.fn())
vi.mock('./episode-storyboard-replacement', () => ({ supersedeEpisodeStoryboardDataInTransaction: replace }))
vi.mock('./extracted-entities', () => ({ clearProjectExtractedEntitiesInTransaction: clearEntities }))
import { episodeDownstreamResetPatch, resetEpisodeDownstreamInTransaction } from './episode-downstream-reset'

describe('stage-specific descendant resets', () => {
    const facts = { chapter: { summary: '正文事实' }, script: { summary: '旧剧本事实' }, adaptation: { title: '旧摘要' } }

    it('clears all text descendants after an outline changes', () => {
        expect(episodeDownstreamResetPatch('outline', facts)).toMatchObject({
            chapterContent: null,
            script: null,
            finalizedAt: null,
            videoUrl: null,
            stateSnapshot: Prisma.DbNull,
            contentFacts: Prisma.DbNull,
            status: 'outlined'
        })
    })

    it('preserves finalized prose when only the script changes', () => {
        const patch = episodeDownstreamResetPatch('script', facts)
        expect(patch).not.toHaveProperty('chapterContent')
        expect(patch).not.toHaveProperty('finalizedAt')
        expect(patch.contentFacts).toMatchObject({ chapter: facts.chapter, script: null, adaptation: null })
        expect(patch).toMatchObject({ videoUrl: null, status: 'scripted' })
    })

    it.each(['chapter', 'script'] as const)('cancels downstream jobs without cancelling the running %s generation', async stage => {
        const tx = {
            chapterJob: { updateMany: vi.fn() },
            scriptJob: { updateMany: vi.fn() },
            storyboardJob: { updateMany: vi.fn() },
            extractJob: { deleteMany: vi.fn() },
            qualityReview: { deleteMany: vi.fn() },
            project: { update: vi.fn() }
        }
        await resetEpisodeDownstreamInTransaction(tx as never, { id: 1n, projectId: 2n, contentFacts: facts, chapterContent: '旧正文', script: '旧剧本' }, stage)
        expect(tx.chapterJob.updateMany).not.toHaveBeenCalled()
        expect(tx.scriptJob.updateMany).toHaveBeenCalledTimes(stage === 'chapter' ? 1 : 0)
        expect(tx.storyboardJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'error', activeKey: null }) }))
        expect(replace).toHaveBeenCalledWith(tx, 1n, expect.any(String))
        expect(tx.extractJob.deleteMany).toHaveBeenCalledWith({ where: { projectId: 2n } })
        expect(clearEntities).toHaveBeenCalledWith(tx, 2n)
    })
})
