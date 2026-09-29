import { HIMODELS_VIDEO_MODELS } from './himodels-models'

// Retired providers stay here so jobs submitted before retirement can finish.
const RESUMABLE_VIDEO_PROVIDERS = new Set(['wan3', 'wan3prime', 'wanx', 'veo3', 'seedance', 'seedance25', ...HIMODELS_VIDEO_MODELS])

export function hasRecoverableVideoCheckpoint(generation: {
    type: string
    provider: string
    taskId: string | null
}) {
    const taskId = generation.taskId?.trim()
    if (generation.type !== 'video' || !taskId || !RESUMABLE_VIDEO_PROVIDERS.has(generation.provider)) return false

    // Segmented Seedance stores several task IDs separated by commas. Its
    // already-downloaded segment files are pod-local, so that workflow cannot
    // safely continue on a different instance yet.
    return !((generation.provider === 'seedance' || generation.provider === 'seedance25') && taskId.includes(','))
}
