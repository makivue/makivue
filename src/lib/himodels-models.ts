const HIMODELS_IMAGE_API_MODELS = ['gemini-3.1-flash-image', 'seedream-5-0-lite'] as const
const HIMODELS_AVAILABLE_VIDEO_API_MODELS = ['seedance-2.0-global', 'seedance-2.5-global', 'MiniMax-H3'] as const
const HIMODELS_RETIRED_VIDEO_API_MODELS = ['veo-3.1-generate-001', 'veo-3.1-fast-generate-001', 'veo-3.1-lite-generate-001'] as const
// Retired models remain known so existing jobs and historical records can be
// decoded, but they are not offered or accepted for new generation requests.
const HIMODELS_VIDEO_API_MODELS = [...HIMODELS_AVAILABLE_VIDEO_API_MODELS, ...HIMODELS_RETIRED_VIDEO_API_MODELS] as const
const HIMODELS_TEXT_API_MODELS = ['gemini-3.7-flash'] as const

export type HiModelsImageApiModel = (typeof HIMODELS_IMAGE_API_MODELS)[number]
export type HiModelsVideoApiModel = (typeof HIMODELS_VIDEO_API_MODELS)[number]
export type HiModelsRetiredVideoApiModel = (typeof HIMODELS_RETIRED_VIDEO_API_MODELS)[number]
type HiModelsTextApiModel = (typeof HIMODELS_TEXT_API_MODELS)[number]
export type HiModelsImageModel = HiModelsImageApiModel
export type HiModelsVideoModel = HiModelsVideoApiModel
export type HiModelsTextModel = HiModelsTextApiModel

export type HiModelsImageModelCapability = {
    requestFamily: 'gemini' | 'seedream'
    maxReferenceImages: number
    supportedImageSizes: readonly ('1K' | '2K' | '4K')[]
    defaultImageSize: '1K' | '2K' | '4K'
    sequentialImageGeneration: boolean
}

/**
 * HiModels exposes different upstream image APIs behind one endpoint. Keep an
 * exhaustive model capability map so a newly added model cannot silently
 * inherit incompatible parameters from another model family.
 */
const HIMODELS_IMAGE_MODEL_CAPABILITIES = {
    'gemini-3.1-flash-image': {
        requestFamily: 'gemini',
        maxReferenceImages: 14,
        supportedImageSizes: ['1K', '2K', '4K'],
        defaultImageSize: '2K',
        sequentialImageGeneration: false
    },
    'seedream-5-0-lite': {
        requestFamily: 'seedream',
        maxReferenceImages: 0,
        supportedImageSizes: ['2K'],
        defaultImageSize: '2K',
        sequentialImageGeneration: false
    }
} as const satisfies Record<HiModelsImageApiModel, HiModelsImageModelCapability>

export function getHiModelsImageModelCapability(model: HiModelsImageApiModel): HiModelsImageModelCapability {
    return HIMODELS_IMAGE_MODEL_CAPABILITIES[model]
}

export function normalizeHiModelsImageSize(model: HiModelsImageApiModel, requested?: '1K' | '2K' | '4K'): '1K' | '2K' | '4K' {
    const capability = getHiModelsImageModelCapability(model)
    return requested && capability.supportedImageSizes.includes(requested) ? requested : capability.defaultImageSize
}

export const HIMODELS_IMAGE_MODELS = HIMODELS_IMAGE_API_MODELS
export const HIMODELS_VIDEO_MODELS = HIMODELS_VIDEO_API_MODELS
export const HIMODELS_TEXT_MODELS = HIMODELS_TEXT_API_MODELS

const LEGACY_HIMODELS_TEXT_MODEL_REPLACEMENTS: Readonly<Record<string, HiModelsTextModel>> = {
    'gemini-3.1-pro-preview': 'gemini-3.7-flash',
    'gemini-3.1-flash-lite-preview': 'gemini-3.7-flash',
    'gemini-3.6-flash': 'gemini-3.7-flash',
    'gemini-3.5-flash': 'gemini-3.7-flash',
    'gemini-2.5-pro': 'gemini-3.7-flash',
    'gemini-2.5-flash': 'gemini-3.7-flash',
    'claude-opus-4-7': 'gemini-3.7-flash',
    'deepseek-v4-flash': 'gemini-3.7-flash',
    'deepseek-v4-pro': 'gemini-3.7-flash',
    'gpt-5.6-terra': 'gemini-3.7-flash',
    'gpt-5.6-sol': 'gemini-3.7-flash'
}

const IMAGE_MODEL_SET = new Set<string>(HIMODELS_IMAGE_MODELS)
const VIDEO_MODEL_SET = new Set<string>(HIMODELS_VIDEO_MODELS)
const RETIRED_VIDEO_API_MODEL_SET = new Set<string>(HIMODELS_RETIRED_VIDEO_API_MODELS)
const TEXT_MODEL_SET = new Set<string>(HIMODELS_TEXT_MODELS)
const LEGACY_TRANSPORT_SUFFIX = `_${'trans'}`

export function normalizeLegacyHiModelsModelId(value: string): string {
    const normalized = value.trim()
    return normalized.endsWith(LEGACY_TRANSPORT_SUFFIX) ? normalized.slice(0, -LEGACY_TRANSPORT_SUFFIX.length) : normalized
}

export function isHiModelsImageModel(value: unknown): value is HiModelsImageModel {
    return typeof value === 'string' && IMAGE_MODEL_SET.has(value)
}

export function isHiModelsVideoModel(value: unknown): value is HiModelsVideoModel {
    return typeof value === 'string' && VIDEO_MODEL_SET.has(value)
}

export function isRetiredHiModelsVideoApiModel(value: unknown): value is HiModelsRetiredVideoApiModel {
    return typeof value === 'string' && RETIRED_VIDEO_API_MODEL_SET.has(value)
}

export function isHiModelsTextModel(value: unknown): value is HiModelsTextModel {
    return typeof value === 'string' && TEXT_MODEL_SET.has(value)
}

export function replaceLegacyHiModelsTextModel(value: string): string {
    const normalized = normalizeLegacyHiModelsModelId(value)
    return LEGACY_HIMODELS_TEXT_MODEL_REPLACEMENTS[normalized] ?? normalized
}
