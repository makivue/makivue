import { describe, expect, it } from 'vitest'
import { outlineRepairEpisodeNumbers, parseOutlineSeriesReview } from './outline-series-review'

const passingScores = {
    arcProgression: 82,
    escalationCurve: 80,
    setupPayoff: 78,
    informationRelease: 84,
    relationshipProgression: 76,
    episodeDistinctness: 81
}

describe('outline series review', () => {
    it('normalizes targeted episode numbers and computes the overall score', () => {
        const review = parseOutlineSeriesReview(
            {
                scores: passingScores,
                issues: [{ dimension: 'setupPayoff', episodeNumbers: [4, '2', 4, 99], message: '第二集伏笔没有在第四集回收' }],
                notes: ['调整伏笔链']
            },
            6
        )
        expect(review.scores.overall).toBe(80)
        expect(outlineRepairEpisodeNumbers(review, 6)).toEqual([2, 4])
    })

    it('turns an unlocalized low score into a whole-series repair', () => {
        const review = parseOutlineSeriesReview({ scores: { ...passingScores, escalationCurve: 50 }, issues: [] }, 3)
        expect(outlineRepairEpisodeNumbers(review, 3)).toEqual([1, 2, 3])
    })

    it('rejects missing score dimensions', () => {
        expect(() => parseOutlineSeriesReview({ scores: {}, issues: [] }, 2)).toThrow('全剧统稿缺少有效评分')
    })
})
