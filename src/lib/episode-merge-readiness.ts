import { usesEmbeddedVideoAudio } from './video-audio-policy'

export type EpisodeMergeStoryboard = {
    videoUrl: string | null
    videoStatus: string | null
    audioUrl: string | null
    composedVideoUrl: string | null
    dialogue: string | null
    expectedAudioMode: string | null
    compositionMode: string | null
    generations: Array<{ provider: string; status: string | null }>
}

export type EpisodeMergeReadiness =
    { ready: true } | { ready: false; stage: 'video'; count: number } | { ready: false; stage: 'video_audio'; count: number } | { ready: false; stage: 'composition'; count: number }

function latestVideoGeneration(storyboard: EpisodeMergeStoryboard) {
    return storyboard.generations[0]
}

function storyboardUsesConfirmedEmbeddedAudio(storyboard: EpisodeMergeStoryboard) {
    const latest = latestVideoGeneration(storyboard)
    if (latest) return latest.status === 'completed' && usesEmbeddedVideoAudio(latest.provider)
    return storyboard.videoStatus === 'completed' && ['native_dialogue', 'native_ambience'].includes(storyboard.expectedAudioMode ?? '')
}

export function effectiveEpisodeMergeVideoPath(storyboard: EpisodeMergeStoryboard) {
    if (storyboardUsesConfirmedEmbeddedAudio(storyboard)) return storyboard.composedVideoUrl ?? storyboard.videoUrl
    if (storyboard.dialogue?.trim()) return storyboard.composedVideoUrl
    return storyboard.composedVideoUrl ?? storyboard.videoUrl
}

export function assessEpisodeMergeReadiness(storyboards: EpisodeMergeStoryboard[]): EpisodeMergeReadiness {
    const incompleteVideos = storyboards.filter(storyboard => {
        const latest = latestVideoGeneration(storyboard)
        return !storyboard.videoUrl || storyboard.videoStatus !== 'completed' || (!!latest && latest.status !== 'completed')
    })
    if (incompleteVideos.length > 0) return { ready: false, stage: 'video', count: incompleteVideos.length }

    const videosNeedingNativeAudio = storyboards.filter(storyboard => {
        if (!storyboard.dialogue?.trim() || storyboardUsesConfirmedEmbeddedAudio(storyboard)) return false
        return !storyboard.audioUrl || !storyboard.composedVideoUrl || !['audio_mix', 'audio_replace'].includes(storyboard.compositionMode ?? '')
    })
    if (videosNeedingNativeAudio.length > 0) return { ready: false, stage: 'video_audio', count: videosNeedingNativeAudio.length }

    const uncomposed = storyboards.filter(storyboard => !effectiveEpisodeMergeVideoPath(storyboard))
    if (uncomposed.length > 0) return { ready: false, stage: 'composition', count: uncomposed.length }

    return { ready: true }
}
