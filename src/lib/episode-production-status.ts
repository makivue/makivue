import { assessEpisodeMergeReadiness, type EpisodeMergeStoryboard } from './episode-merge-readiness'
import { hasMergedEpisodeVideo } from './project-progress'

export type EpisodeProductionStatus = 'not_generated' | 'queued' | 'generating' | 'ready' | 'merging' | 'completed' | 'partial' | 'failed' | 'merge_failed'

type ProductionStoryboard = EpisodeMergeStoryboard & {
    frameStatus: string | null
    composeStatus: string | null
    firstFrameUrl: string | null
    lastFrameUrl?: string | null
}

/** A batch for replaced storyboards must not override the new storyboard set's status. */
export function getCurrentEpisodeBatchPhase(storyboards: Array<{ id: string | bigint }>, job: { phase: string | null; shots: unknown } | undefined): string | null {
    if (!job) return null
    // Keep compatibility with legacy batches that have no shot snapshot.
    if (!Array.isArray(job.shots) || job.shots.length === 0) return job.phase
    const currentIds = new Set(storyboards.map(shot => String(shot.id)))
    return job.shots.some(shot => shot && typeof shot === 'object' && currentIds.has(String(shot.storyboardId))) ? job.phase : null
}

export function getEpisodeProductionStatus(
    episode: {
        status: string | null
        videoUrl: string | null
        storyboards: ProductionStoryboard[]
        merges: Array<{ status: string | null; videoUrl: string | null }>
    },
    activity: { generating?: boolean; merging?: boolean; queued?: boolean; batchPhase?: string | null } = {}
): EpisodeProductionStatus {
    const { storyboards, merges } = episode
    const merge = merges[0]
    if (activity.merging || ['pending', 'queued', 'processing'].includes(merge?.status ?? '')) return 'merging'
    if (
        activity.generating ||
        activity.batchPhase === 'running' ||
        ['storyboarding', 'generating'].includes(episode.status ?? '') ||
        storyboards.some(shot => [shot.frameStatus, shot.videoStatus, shot.composeStatus, shot.generations[0]?.status].some(status => ['generating', 'queued', 'processing'].includes(status ?? '')))
    )
        return 'generating'
    if (activity.queued) return 'queued'
    if (merge?.status === 'failed') return 'merge_failed'
    if (hasMergedEpisodeVideo(episode.videoUrl) || merges.some(item => item.status === 'completed' && hasMergedEpisodeVideo(item.videoUrl))) return 'completed'
    if (storyboards.length > 0 && assessEpisodeMergeReadiness(storyboards).ready) return 'ready'
    if (activity.batchPhase === 'error' || storyboards.some(shot => [shot.frameStatus, shot.videoStatus, shot.composeStatus, shot.generations[0]?.status].includes('failed'))) return 'failed'
    if (
        ['cancelled', 'split_required'].includes(activity.batchPhase ?? '') ||
        merge?.status === 'cancelled' ||
        storyboards.some(shot => shot.firstFrameUrl || shot.lastFrameUrl || shot.videoUrl || shot.composedVideoUrl)
    )
        return 'partial'
    return 'not_generated'
}
