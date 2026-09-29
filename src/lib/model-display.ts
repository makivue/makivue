import { isHiModelsImageModel, isHiModelsTextModel, isHiModelsVideoModel, normalizeLegacyHiModelsModelId, replaceLegacyHiModelsTextModel } from './himodels-models'

export const GENERATION_MODEL_SOURCES = ['direct', 'himodels'] as const
export type GenerationModelSource = (typeof GENERATION_MODEL_SOURCES)[number]

export const GENERATION_MODEL_SOURCE_LABELS: Record<GenerationModelSource, string> = {
    direct: '厂商直连',
    himodels: 'Himodels'
}

const DIRECT_MODEL_IDS = new Set(['gpt-4o', 'banana', 'qwen-image-3.0-pro', 'seedance', 'seedance25', 'wanx', 'wan3', 'wan3prime', 'gemini:gemini-3.7-flash', 'gpt-5.4-shortdrama', 'gpt-5.5-shortdrama'])

const DIRECT_PROVIDER_IDS = new Set(['google', 'gemini', 'openai', 'azure'])

const HIMODELS_DISPLAY_NAMES: Readonly<Record<string, string>> = {
    banana: 'Nano Banana',
    'qwen-image-3.0-pro': 'Qwen-Image 3.0 Pro',
    seedance: 'Seedance 2.0',
    seedance25: 'Seedance 2.5',
    wan3: 'Wan 3.0',
    wan3prime: 'Wan 3.0 Prime',
    'gemini:gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
    'seedream-5-0-lite': 'Seedream 5.0 Lite',
    'seedance-2.0-global': 'Seedance 2.0 Global',
    'seedance-2.5-global': 'Seedance 2.5 Global',
    'MiniMax-H3': 'MiniMax H3',
    'veo-3.1-generate-001': 'Veo 3.1',
    'veo-3.1-fast-generate-001': 'Veo 3.1 Fast',
    'veo-3.1-lite-generate-001': 'Veo 3.1 Lite'
}

export function modelDisplayName(value: string): string {
    const normalized = normalizeLegacyHiModelsModelId(value)
    return HIMODELS_DISPLAY_NAMES[normalized] ?? normalized
}

export function isGenerationModelVisible(value: string): boolean {
    if (value !== 'seedance' && value !== 'seedance25') return true
    // Test deployments also use optimized Next builds, so use the public
    // deployment environment instead of relying on the bundled NODE_ENV.
    const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() || process.env.NODE_ENV
    return environment !== 'prod' && environment !== 'production'
}

export function generationModelSource(value: string | null | undefined): GenerationModelSource | null {
    if (!value?.trim()) return null
    if (value.trim().endsWith(`_${'trans'}`)) return 'himodels'
    const normalized = normalizeLegacyHiModelsModelId(value)
    const normalizedLower = normalized.toLowerCase()
    const normalizedTextModel = replaceLegacyHiModelsTextModel(normalizedLower)
    if (
        normalizedLower === 'himodels' ||
        normalizedLower === 'doubao' ||
        normalizedLower === 'veo3' ||
        isHiModelsImageModel(normalized) ||
        isHiModelsVideoModel(normalized) ||
        isHiModelsTextModel(normalizedTextModel)
    ) {
        return 'himodels'
    }
    if (DIRECT_MODEL_IDS.has(normalizedLower) || DIRECT_PROVIDER_IDS.has(normalizedLower) || normalizedLower.startsWith('gemini:')) return 'direct'
    return null
}

export function modelDisplayNameWithSource(value: string, translate: (source: string) => string = source => source): string {
    const source = generationModelSource(value)
    if (!source) return modelDisplayName(value)
    const sourceLabel = translate(GENERATION_MODEL_SOURCE_LABELS[source])
    const normalized = normalizeLegacyHiModelsModelId(value).toLowerCase()
    if (normalized === 'himodels' || DIRECT_PROVIDER_IDS.has(normalized)) return sourceLabel
    return `${sourceLabel} · ${modelDisplayName(value)}`
}
