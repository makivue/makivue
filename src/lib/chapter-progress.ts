type ChapterProgressInput = {
    status?: string | null
    chapterContent?: string | null
    hasChapterContent?: boolean
}

export function getMissingChapterOutlineNumbers(episodes: readonly { episodeNumber: number; synopsis?: string | null }[], totalEpisodes: number): number[] {
    return Array.from({ length: totalEpisodes }, (_, index) => index + 1).filter(number => !episodes.find(episode => episode.episodeNumber === number)?.synopsis?.trim())
}

export function isScriptGenerated(status: string | null | undefined): boolean {
    return status === 'scripted' || status === 'storyboarding' || status === 'storyboarded' || status === 'generating' || status === 'completed'
}

export function isChapterFinalized(status: string | null | undefined): boolean {
    return status === 'finalized' || status === 'scripting' || isScriptGenerated(status)
}

/** Summaries omit the body; later production stages also retain chapter progress, even when older APIs omit their content flag. */
export function getChapterProgress(episodes: readonly ChapterProgressInput[]) {
    const generated = episodes.filter(episode => episode.hasChapterContent || episode.chapterContent?.trim() || isChapterFinalized(episode.status)).length
    const finalized = episodes.filter(episode => isChapterFinalized(episode.status)).length
    const missing = episodes.filter(episode => !isChapterFinalized(episode.status) && !episode.hasChapterContent && !episode.chapterContent?.trim()).length
    return {
        total: episodes.length,
        generated,
        finalized,
        missing,
        allFinalized: episodes.length > 0 && finalized === episodes.length
    }
}
