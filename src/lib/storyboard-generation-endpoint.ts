export type StoryboardGenerationRequestType = 'illustrations' | 'first_frame' | 'last_frame' | 'video'

export function storyboardGenerationEndpoint(storyboardId: string, type: StoryboardGenerationRequestType) {
    const base = `/api/storyboards/${storyboardId}`
    if (type === 'video') return `${base}/video/generate`
    return `${base}/images/generate`
}
