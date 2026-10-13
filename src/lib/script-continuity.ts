/** Recognize persisted predecessor invalidations, including jobs created before this release. */
export function scriptContinuityPredecessor(reason: string | null | undefined): number | null {
    const match = reason?.match(/第\s*(\d+)\s*集(?:正文|剧本)已更新，请复核本集剧情及首尾衔接/)
    return match ? Number(match[1]) : null
}

/** Older releases marked even untouched episodes; only saved content needs review. */
export function scriptContinuityReviewPredecessor(reason: string | null | undefined, content: { hasChapterContent: boolean; hasScript: boolean }): number | null {
    const predecessor = scriptContinuityPredecessor(reason)
    if (predecessor === null) return null
    const hasAffectedContent = /集正文已更新/.test(reason!.replace(/\s/g, '')) ? content.hasChapterContent : content.hasScript
    return hasAffectedContent ? predecessor : null
}

export function scriptContinuityNoticePredecessor(options: {
    staleReason?: string | null
    issueReason?: string | null
    hasChapterContent: boolean
    hasScript: boolean
    generating: boolean
    queued: boolean
}): number | null {
    if (options.generating || options.queued) return null
    // A historical review reminder must not obscure the current failure.
    if (options.issueReason?.trim()) return scriptContinuityPredecessor(options.issueReason)
    return scriptContinuityReviewPredecessor(options.staleReason, options)
}
