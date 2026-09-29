export type StoryboardGenerationMode = 'missing' | 'overwrite'

type StoryboardGenerationRequestInput = {
    episodeId: string
    videoProvider?: ProductionVideoProvider
    mode: StoryboardGenerationMode
}

export type StoryboardGenerationRequest = {
    episodeId: string
    generationMode: StoryboardGenerationMode
    /**
     * Compatibility field for a browser tab that is briefly talking to an
     * older API instance during a rolling deployment.
     */
    overwriteExisting: boolean
    videoProvider?: ProductionVideoProvider
}

export function buildStoryboardGenerationRequest({ episodeId, videoProvider, mode }: StoryboardGenerationRequestInput): StoryboardGenerationRequest {
    return {
        episodeId,
        generationMode: mode,
        overwriteExisting: mode === 'overwrite',
        ...(videoProvider === undefined ? {} : { videoProvider })
    }
}

export function resolveStoryboardGenerationMode(generationMode: unknown, overwriteExisting: unknown): StoryboardGenerationMode | null {
    if (generationMode !== undefined) {
        if (generationMode !== 'missing' && generationMode !== 'overwrite') return null
        if (overwriteExisting !== undefined && (overwriteExisting === true) !== (generationMode === 'overwrite')) return null
        return generationMode
    }

    // Keep accepting the previous request shape while cached clients age out.
    return overwriteExisting === true ? 'overwrite' : 'missing'
}
import type { ProductionVideoProvider } from './provider-capabilities'
