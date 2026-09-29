import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NarrativeReview } from './narrative-review'
import { repairChapterDraft } from './chapter-repair'
import { BillingError } from '@/lib/billing-error'

function passingReview(content: string): NarrativeReview {
    return {
        issues: [],
        facts: {
            kind: 'observed',
            sourceStage: 'chapter',
            sourceHash: `hash-${content.length}`,
            episodeNumber: 1,
            sourceVersion: 1,
            summary: '摘要',
            openingState: '开场',
            endingState: '结尾',
            characterStateChanges: '状态变化',
            continuityBridge: '承接',
            events: [{ description: '事件', evidence: '证据' }]
        },
        quality: {
            causality: 80,
            characterAgency: 80,
            escalation: 80,
            emotionalProgression: 80,
            dialogueSubtext: 80,
            hookStrength: 80,
            visualDramatization: 80,
            overall: 80,
            notes: []
        }
    }
}

describe('chapter repair policy', () => {
    afterEach(() => vi.useRealTimers())
    it('repairs the best draft progressively instead of starting over', async () => {
        const repair = vi.fn(async (content: string) => content + '新'.repeat(25))
        const result = await repairChapterDraft({ content: '旧'.repeat(40), targetWords: 100, review: async content => passingReview(content), repair })

        expect(repair).toHaveBeenCalledTimes(2)
        expect(repair.mock.calls[0][0]).toHaveLength(40)
        expect(repair.mock.calls[1][0]).toHaveLength(65)
        expect(result.content).toHaveLength(90)
        expect(result.warningIssues).toEqual([])
        expect(result.blockingIssues).toEqual([])
    })

    it('never replaces a short draft with an even shorter repair', async () => {
        const repair = vi.fn().mockResolvedValueOnce('短'.repeat(20)).mockResolvedValueOnce('长'.repeat(90))
        const result = await repairChapterDraft({ content: '原'.repeat(60), targetWords: 100, review: async content => passingReview(content), repair, maxLengthRepairs: 2 })

        expect(repair.mock.calls[1][0]).toHaveLength(60)
        expect(result.content).toHaveLength(90)
        expect(result.warningIssues).toEqual([])
    })

    it('returns a non-blocking warning when only the length target remains unmet', async () => {
        const result = await repairChapterDraft({
            content: '正文'.repeat(20),
            targetWords: 100,
            review: async content => passingReview(content),
            repair: async content => content,
            maxLengthRepairs: 2
        })

        expect(result.blockingIssues).toEqual([])
        expect(result.warningIssues).toEqual([expect.objectContaining({ code: 'too_short' })])
        expect(result.repairAttempts).toBe(2)
    })

    it('keeps narrative review failures blocking even when length is only advisory', async () => {
        const result = await repairChapterDraft({
            content: '正文'.repeat(20),
            targetWords: 100,
            review: async content => ({ ...passingReview(content), issues: [{ path: 'chapter', code: 'narrative_conflict', message: '关键事件缺失' }] }),
            repair: async content => content,
            maxLengthRepairs: 0,
            maxNarrativeRepairs: 0
        })

        expect(result.warningIssues).toEqual([])
        expect(result.blockingIssues.map(issue => issue.code)).toEqual(['too_short', 'narrative_conflict'])
    })

    it('accepts a verified factual correction even if removing the contradiction makes a short draft shorter', async () => {
        const original = '矛盾'.repeat(30)
        const corrected = '正确'.repeat(25)
        const review = vi.fn(async (text: string) => ({
            ...passingReview(text),
            issues: text === original ? [{ path: 'chapter', code: 'narrative_conflict', message: '道具尚未交接' }] : []
        }))
        const result = await repairChapterDraft({ content: original, targetWords: 100, review, repair: async () => corrected, maxLengthRepairs: 0 })
        expect(result.content).toBe(corrected)
        expect(result.review.facts.sourceHash).toBe(`hash-${corrected.length}`)
        expect(result.blockingIssues).toEqual([])
        expect(result.warningIssues).toEqual([expect.objectContaining({ code: 'too_short' })])
    })

    it('retries only the failed repair with the existing draft', async () => {
        vi.useFakeTimers()
        const repair = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce('新'.repeat(90))
        const pending = repairChapterDraft({ content: '旧'.repeat(60), targetWords: 100, review: async text => passingReview(text), repair })
        await vi.runAllTimersAsync()
        expect((await pending).content).toHaveLength(90)
        expect(repair).toHaveBeenCalledTimes(2)
        expect(repair.mock.calls.map(call => call[0])).toEqual(['旧'.repeat(60), '旧'.repeat(60)])
    })

    it('does not repeatedly request a repair when the wallet has insufficient coins', async () => {
        const error = new BillingError('可用金币不足')
        const repair = vi.fn().mockRejectedValue(error)
        await expect(repairChapterDraft({ content: '旧'.repeat(60), targetWords: 100, review: async text => passingReview(text), repair })).rejects.toBe(error)
        expect(repair).toHaveBeenCalledOnce()
    })
})
