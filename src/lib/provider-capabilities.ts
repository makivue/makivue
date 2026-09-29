import { getHiModelsImageModelCapability, isHiModelsImageModel, isHiModelsVideoModel, type HiModelsImageModel, type HiModelsVideoApiModel, type HiModelsVideoModel } from './himodels-models'

export type ProductionVideoProvider = 'seedance' | 'seedance25' | 'wanx' | 'wan3' | 'wan3prime' | 'veo3' | HiModelsVideoModel
export type ProductionImageProvider = 'banana' | 'doubao' | 'qwen-image-3.0-pro' | HiModelsImageModel
export type VideoReferenceMode = 'text' | 'single' | 'first_last'

export const DEFAULT_VIDEO_PROVIDER = 'wan3' as const satisfies ProductionVideoProvider

export const SEEDANCE_20_LABEL = 'Seedance 2.0'
export const SEEDANCE_20_BASE_URL = 'https://ark.cn-beijing.volces.com'
export const SEEDANCE_20_ENDPOINT_ID = 'ep-configure-1'
export const SEEDANCE_25_LABEL = 'Seedance 2.5'
export const SEEDANCE_25_BASE_URL = 'https://ark.cn-beijing.volces.com'
export const SEEDANCE_25_ENDPOINT_ID = 'ep-configure-2'
export const WAN_3_LABEL = 'Wan 3.0'
export const WAN_3_MODEL = 'wan3.0-video'
export const WAN_3_PRIME_LABEL = 'Wan 3.0 Prime'
export const WAN_3_PRIME_MODEL = 'wan3.0-video-prime'
export const WAN_3_RESOLUTION = '1080P'
export const QWEN_IMAGE_MAX_REFERENCES = 3
export const SEEDANCE_20_REFERENCE_VIDEO_DURATION = { min: 2, max: 15, totalMax: 15 } as const
export const SEEDANCE_25_REFERENCE_VIDEO_DURATION = { min: 2, max: 30, totalMax: 30 } as const
const WAN_3_REFERENCE_VIDEO_DURATION = { min: 1, max: 30 } as const
const HIMODELS_SEEDANCE_20_PROVIDER = 'seedance-2.0-global' as const
const HIMODELS_SEEDANCE_25_PROVIDER = 'seedance-2.5-global' as const
const HIMODELS_MINIMAX_H3_PROVIDER = 'MiniMax-H3' as const
const HIMODELS_VEO_31_PROVIDER = 'veo-3.1-generate-001' as const
const HIMODELS_VEO_31_FAST_PROVIDER = 'veo-3.1-fast-generate-001' as const
const HIMODELS_VEO_31_LITE_PROVIDER = 'veo-3.1-lite-generate-001' as const

export type VideoProviderCapability = {
    label: string
    referenceModes: readonly VideoReferenceMode[]
    nativeDialogue: boolean
    embeddedAudio: boolean
    supportsNegativeParam: boolean
    maxImageReferences: number
    maxVideoReferences: number
    referenceVideoDuration?: {
        min: number
        max: number
        totalMax?: number
    }
    supportsMultiKeyframe: boolean
    duration: {
        min: number
        max: number
        values?: readonly number[]
    }
}

export type ImageProviderCapability = {
    label: string
    supportsNegativeParam: boolean
    maxImageReferences: number
}

export const VIDEO_PROVIDER_CAPABILITIES: Record<ProductionVideoProvider, VideoProviderCapability> = {
    seedance: {
        label: SEEDANCE_20_LABEL,
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 2,
        maxVideoReferences: 3,
        referenceVideoDuration: SEEDANCE_20_REFERENCE_VIDEO_DURATION,
        supportsMultiKeyframe: true,
        duration: { min: 4, max: 15, values: [4, 5, 6, 8, 10, 12, 15] }
    },
    seedance25: {
        label: SEEDANCE_25_LABEL,
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 2,
        maxVideoReferences: 3,
        referenceVideoDuration: SEEDANCE_25_REFERENCE_VIDEO_DURATION,
        supportsMultiKeyframe: true,
        // Seedance 2.5 accepts whole-second durations up to 30 seconds in one request.
        duration: { min: 4, max: 30, values: Array.from({ length: 27 }, (_, index) => index + 4) }
    },
    wanx: {
        label: 'Happy Horse 1.1',
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: false,
        embeddedAudio: false,
        supportsNegativeParam: false,
        maxImageReferences: 7,
        maxVideoReferences: 0,
        supportsMultiKeyframe: true,
        duration: { min: 3, max: 15 }
    },
    wan3: {
        label: WAN_3_LABEL,
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 4,
        maxVideoReferences: 3,
        // Wan's r2v API documents a 1–30 second input-video range and no aggregate limit.
        referenceVideoDuration: WAN_3_REFERENCE_VIDEO_DURATION,
        supportsMultiKeyframe: false,
        duration: { min: 5, max: 30 }
    },
    wan3prime: {
        label: WAN_3_PRIME_LABEL,
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 4,
        maxVideoReferences: 3,
        referenceVideoDuration: WAN_3_REFERENCE_VIDEO_DURATION,
        supportsMultiKeyframe: false,
        duration: { min: 5, max: 30 }
    },
    veo3: {
        label: 'Veo 3.1',
        referenceModes: ['text'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 0,
        maxVideoReferences: 0,
        supportsMultiKeyframe: false,
        duration: { min: 4, max: 8, values: [4, 6, 8] }
    },
    [HIMODELS_SEEDANCE_20_PROVIDER]: {
        label: 'Seedance 2.0 Global',
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 2,
        maxVideoReferences: 3,
        referenceVideoDuration: SEEDANCE_20_REFERENCE_VIDEO_DURATION,
        supportsMultiKeyframe: true,
        duration: { min: 4, max: 15, values: [4, 5, 6, 8, 10, 12, 15] }
    },
    [HIMODELS_SEEDANCE_25_PROVIDER]: {
        label: 'Seedance 2.5 Global',
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 2,
        maxVideoReferences: 3,
        referenceVideoDuration: SEEDANCE_25_REFERENCE_VIDEO_DURATION,
        supportsMultiKeyframe: true,
        // Start with the documented 2.0 contract until 2.5 limits are published.
        duration: { min: 4, max: 15, values: [4, 5, 6, 8, 10, 12, 15] }
    },
    [HIMODELS_MINIMAX_H3_PROVIDER]: {
        label: 'MiniMax H3',
        referenceModes: ['text', 'single', 'first_last'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        // The creator currently accepts at most three references per request.
        // H3 treats additional images as omni-modal references rather than frames.
        maxImageReferences: 3,
        maxVideoReferences: 3,
        supportsMultiKeyframe: true,
        duration: { min: 5, max: 15, values: Array.from({ length: 11 }, (_, index) => index + 5) }
    },
    [HIMODELS_VEO_31_PROVIDER]: {
        label: 'Veo 3.1',
        referenceModes: ['text'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 0,
        maxVideoReferences: 0,
        supportsMultiKeyframe: false,
        duration: { min: 4, max: 8, values: [4, 6, 8] }
    },
    [HIMODELS_VEO_31_FAST_PROVIDER]: {
        label: 'Veo 3.1 Fast',
        referenceModes: ['text'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 0,
        maxVideoReferences: 0,
        supportsMultiKeyframe: false,
        duration: { min: 4, max: 8, values: [4, 6, 8] }
    },
    [HIMODELS_VEO_31_LITE_PROVIDER]: {
        label: 'Veo 3.1 Lite',
        referenceModes: ['text'],
        nativeDialogue: true,
        embeddedAudio: true,
        supportsNegativeParam: false,
        maxImageReferences: 0,
        maxVideoReferences: 0,
        supportsMultiKeyframe: false,
        duration: { min: 4, max: 8, values: [4, 6, 8] }
    }
}

export const IMAGE_PROVIDER_CAPABILITIES: Record<ProductionImageProvider, ImageProviderCapability> = {
    banana: { label: 'Nano Banana', supportsNegativeParam: false, maxImageReferences: 14 },
    doubao: { label: 'Seedream 5.0 Lite', supportsNegativeParam: false, maxImageReferences: 0 },
    'qwen-image-3.0-pro': { label: 'Qwen-Image 3.0 Pro', supportsNegativeParam: true, maxImageReferences: QWEN_IMAGE_MAX_REFERENCES },
    'gemini-3.1-flash-image': {
        label: 'Gemini 3.1 Flash Image',
        supportsNegativeParam: false,
        maxImageReferences: getHiModelsImageModelCapability('gemini-3.1-flash-image').maxReferenceImages
    },
    'seedream-5-0-lite': {
        label: 'Seedream 5.0 Lite',
        supportsNegativeParam: false,
        maxImageReferences: getHiModelsImageModelCapability('seedream-5-0-lite').maxReferenceImages
    }
}

export function isProductionVideoProvider(value: unknown): value is ProductionVideoProvider {
    return value === 'seedance' || value === 'seedance25' || value === 'wanx' || value === 'wan3' || value === 'wan3prime' || value === 'veo3' || isHiModelsVideoModel(value)
}

/**
 * Veo remains recognizable so historical generations can still be displayed
 * and polled, but it is no longer available for new selections or jobs.
 */
export function isAvailableProductionVideoProvider(value: unknown): value is ProductionVideoProvider {
    return isProductionVideoProvider(value) && value !== 'wanx' && !isHiModelsVeoProvider(value)
}

export function isProductionImageProvider(value: unknown): value is ProductionImageProvider {
    return value === 'banana' || value === 'doubao' || value === 'qwen-image-3.0-pro' || isHiModelsImageModel(value)
}

export function getHiModelsVideoApiModel(provider: ProductionVideoProvider): HiModelsVideoApiModel | null {
    if (provider === 'veo3') return 'veo-3.1-generate-001'
    return isHiModelsVideoModel(provider) ? provider : null
}

export function isHiModelsVeoProvider(provider: string | null | undefined): boolean {
    return provider === 'veo3' || (isHiModelsVideoModel(provider) && provider.startsWith('veo-'))
}

export function isHiModelsH3Provider(provider: string | null | undefined): provider is typeof HIMODELS_MINIMAX_H3_PROVIDER {
    return provider === HIMODELS_MINIMAX_H3_PROVIDER
}

export function getVideoProviderCapability(provider: string | null | undefined): VideoProviderCapability | null {
    return isProductionVideoProvider(provider) ? VIDEO_PROVIDER_CAPABILITIES[provider] : null
}

export function getImageProviderCapability(provider: string | null | undefined): ImageProviderCapability | null {
    return isProductionImageProvider(provider) ? IMAGE_PROVIDER_CAPABILITIES[provider] : null
}

export function supportsVideoReferenceMode(provider: string | null | undefined, mode: VideoReferenceMode): boolean {
    return getVideoProviderCapability(provider)?.referenceModes.includes(mode) ?? false
}

export function normalizeVideoDuration(provider: ProductionVideoProvider, requestedDuration: number | null | undefined): number {
    const capability = VIDEO_PROVIDER_CAPABILITIES[provider]
    const requested = Number.isFinite(requestedDuration) ? Math.round(requestedDuration as number) : isHiModelsVeoProvider(provider) ? 8 : 5
    if (capability.duration.values?.length) {
        return capability.duration.values.reduce((best, value) => (Math.abs(value - requested) < Math.abs(best - requested) ? value : best))
    }
    return Math.min(capability.duration.max, Math.max(capability.duration.min, requested))
}

/**
 * Resolve the provider-side timeline before prompt rewriting or billing.  A
 * segmented request must respect the minimum duration of every child request,
 * even when that makes the provider plan longer than the storyboard draft.
 */
export function planVideoDuration(provider: ProductionVideoProvider, requestedDuration: number | null | undefined, segmentCount = 1) {
    const requested = Number.isFinite(requestedDuration) ? Math.max(1, Math.round(requestedDuration as number)) : isHiModelsVeoProvider(provider) ? 8 : 5
    const normalized = normalizeVideoDuration(provider, requested)
    const count = Math.max(1, Math.round(segmentCount))
    if (count === 1 || !VIDEO_PROVIDER_CAPABILITIES[provider].supportsMultiKeyframe) {
        return { requestedDuration: requested, plannedDuration: normalized, segmentDurations: [normalized] }
    }

    const min = VIDEO_PROVIDER_CAPABILITIES[provider].duration.min
    const plannedDuration = Math.max(normalized, min * count)
    const base = Math.floor(plannedDuration / count)
    let remainder = plannedDuration - base * count
    const segmentDurations = Array.from({ length: count }, () => {
        const duration = base + (remainder > 0 ? 1 : 0)
        remainder = Math.max(0, remainder - 1)
        return Math.max(min, duration)
    })
    return {
        requestedDuration: requested,
        plannedDuration: segmentDurations.reduce((sum, duration) => sum + duration, 0),
        segmentDurations
    }
}

/** Negative lists are only sent through a native parameter. */
export function resolveImagePromptChannels(provider: ProductionImageProvider, prompt: string, negativePrompt?: string) {
    const capability = IMAGE_PROVIDER_CAPABILITIES[provider]
    return {
        prompt,
        negativePrompt: capability.supportsNegativeParam ? negativePrompt : undefined
    }
}
