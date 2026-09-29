const OUTLINE_SERIES_DIMENSIONS = ['arcProgression', 'escalationCurve', 'setupPayoff', 'informationRelease', 'relationshipProgression', 'episodeDistinctness'] as const

type OutlineSeriesDimension = (typeof OUTLINE_SERIES_DIMENSIONS)[number]

type OutlineSeriesIssue = {
    dimension: OutlineSeriesDimension
    episodeNumbers: number[]
    message: string
}

export type OutlineSeriesReview = {
    scores: Record<OutlineSeriesDimension, number> & { overall: number }
    issues: OutlineSeriesIssue[]
    notes: string[]
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function parseOutlineSeriesReview(raw: unknown, totalEpisodes: number): OutlineSeriesReview {
    const source = record(raw)
    const scoreSource = record(source.scores)
    const scores = Object.fromEntries(
        OUTLINE_SERIES_DIMENSIONS.map(dimension => {
            const score = Number(scoreSource[dimension])
            if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error(`全剧统稿缺少有效评分：${dimension}`)
            return [dimension, Math.round(score)]
        })
    ) as Record<OutlineSeriesDimension, number>
    const issues = (Array.isArray(source.issues) ? source.issues : []).map(value => {
        const issue = record(value)
        const dimension = String(issue.dimension) as OutlineSeriesDimension
        if (!OUTLINE_SERIES_DIMENSIONS.includes(dimension)) throw new Error('全剧统稿返回了未知问题维度')
        if (typeof issue.message !== 'string' || !issue.message.trim()) throw new Error('全剧统稿返回了无效问题')
        const episodeNumbers = [
            ...new Set((Array.isArray(issue.episodeNumbers) ? issue.episodeNumbers : []).map(Number).filter(number => Number.isInteger(number) && number >= 1 && number <= totalEpisodes))
        ].sort((a, b) => a - b)
        return { dimension, episodeNumbers, message: issue.message.trim() }
    })
    for (const dimension of OUTLINE_SERIES_DIMENSIONS) {
        if (scores[dimension] < 65 && !issues.some(issue => issue.dimension === dimension)) {
            issues.push({ dimension, episodeNumbers: [], message: `${dimension} 仅 ${scores[dimension]} 分，需要进行全局修订` })
        }
    }
    return {
        scores: { ...scores, overall: Math.round(OUTLINE_SERIES_DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension], 0) / OUTLINE_SERIES_DIMENSIONS.length) },
        issues,
        notes: Array.isArray(source.notes) ? source.notes.filter((note): note is string => typeof note === 'string' && !!note.trim()).slice(0, 8) : []
    }
}

export function outlineRepairEpisodeNumbers(review: OutlineSeriesReview, totalEpisodes: number): number[] {
    const all = Array.from({ length: totalEpisodes }, (_, index) => index + 1)
    if (review.issues.some(issue => issue.episodeNumbers.length === 0)) return all
    return [...new Set(review.issues.flatMap(issue => issue.episodeNumbers))].sort((a, b) => a - b)
}
