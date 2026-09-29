type EpisodeProgress = { status?: string | null; videoUrl?: string | null }

/** A merge must have a deliverable URL, not a legacy container-local path. */
export function hasMergedEpisodeVideo(videoUrl: string | null | undefined): boolean {
    if (!videoUrl?.trim()) return false
    try {
        const url = new URL(videoUrl.trim())
        return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
        return false
    }
}

/** Derive progress on reads so historical projects and invalidated merges stay consistent. */
export function getProjectProductionProgress(project: { status?: string | null; totalEpisodes?: number | null; episodes: readonly EpisodeProgress[] }) {
    const completedEpisodes = project.episodes.filter(episode => hasMergedEpisodeVideo(episode.videoUrl)).length
    const expectedEpisodes = Math.max(project.totalEpisodes ?? 0, project.episodes.length)
    const allCompleted = expectedEpisodes > 0 && completedEpisodes === expectedEpisodes
    const started = project.episodes.some(episode => hasMergedEpisodeVideo(episode.videoUrl) || (episode.status && episode.status !== 'draft'))
    const status = allCompleted ? 'completed' : started || project.status === 'in_production' || project.status === 'completed' ? 'in_production' : 'draft'
    return { status, completedEpisodes, expectedEpisodes }
}
