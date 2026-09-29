export interface EpisodeStatusSnapshot {
    id: string
    version: string
    status: string
    storyboards: Array<{ id: string; frameStatus: string; videoStatus: string; composeStatus: string }>
    merges: Array<{ id: string; status: string }>
}
