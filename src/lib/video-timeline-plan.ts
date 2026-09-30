import type { VideoReferenceMode } from './provider-capabilities'

export const VIDEO_TIMELINE_PLAN_VERSION = 'basic-v1'

export function minimumReferenceImageCount(mode: VideoReferenceMode) {
    if (mode === 'first_last') return 2
    if (mode === 'single') return 1
    return 0
}

export function hasRequiredReferenceFrames(mode: VideoReferenceMode, frames: { firstFrameUrl?: string | null; plannedLastFrameUrl?: string | null; lastFrameUrl?: string | null }) {
    if (mode === 'text') return true
    if (!frames.firstFrameUrl) return false
    if (mode === 'first_last') {
        const endingFrame = frames.plannedLastFrameUrl ?? frames.lastFrameUrl
        return !!endingFrame && endingFrame !== frames.firstFrameUrl
    }
    return true
}
