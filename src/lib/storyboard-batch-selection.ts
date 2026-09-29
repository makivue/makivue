export type StoryboardBatchEpisode = {
    status: string
    _count: { storyboards: number }
}

export function shouldGenerateEpisodeStoryboards(episode: StoryboardBatchEpisode, mode: 'missing' | 'all') {
    const scriptReady = episode.status === 'scripted' || episode.status === 'storyboarded'
    if (!scriptReady) return false
    if (mode === 'all') return true
    // “生成剩余”以真实存在的未删除分镜为准，不能依赖可能滞后的 episode.status。
    return episode._count.storyboards === 0
}
