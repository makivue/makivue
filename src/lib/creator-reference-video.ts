import type { StoryboardReferenceVideo } from './storyboard-reference-videos'

// Reserve enough image inputs for several sampled frames and an optional image.
export const MAX_IMAGE_REFERENCE_VIDEOS = 1

// Saved works already carry a trusted URL and duration; they are not new uploads.
export type CreatorReferenceVideo = Pick<StoryboardReferenceVideo, 'id' | 'url' | 'name' | 'durationSeconds'>
