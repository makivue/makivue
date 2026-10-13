import { hasMergedEpisodeVideo } from '@/lib/project-progress'

type RuntimeMerge = {
    videoUrl: string | null
    status: string | null
    videoStatus: string | null
    duration: number | string | { toNumber(): number } | null
}

/** Only report a measured duration for the episode's current delivered video. */
export function getEpisodeMeasuredDuration(videoUrl: string | null | undefined, merges: readonly RuntimeMerge[] = []): number | null {
    if (hasMergedEpisodeVideo(videoUrl)) {
        for (const merge of merges) {
            if (merge.videoUrl !== videoUrl || (merge.videoStatus !== 'completed' && merge.status !== 'completed')) continue
            const seconds = typeof merge.duration === 'object' && merge.duration !== null ? merge.duration.toNumber() : Number(merge.duration)
            if (Number.isFinite(seconds) && seconds > 0) {
                return seconds
            }
        }
    }
    return null
}
