import { GEMINI_FLASH_TEXT_MODEL_ID } from './gemini-models'
import { HIMODELS_TEXT_MODELS } from './himodels-models'
import { GENERATION_MODEL_SOURCE_LABELS } from './model-display'

export type TextModelSource = 'direct' | 'himodels'

export type TextModelOption = {
    value: string
    label: string
    source: TextModelSource
}

export const TEXT_MODEL_SOURCE_LABELS: Record<TextModelSource, string> = GENERATION_MODEL_SOURCE_LABELS

export const TEXT_MODEL_OPTIONS: readonly TextModelOption[] = [
    { value: GEMINI_FLASH_TEXT_MODEL_ID, label: 'Gemini 3.7 Flash', source: 'direct' },
    { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', source: 'himodels' }
]

const TEXT_MODEL_VALUES = new Set<string>(TEXT_MODEL_OPTIONS.map(option => option.value))

export function isAvailableTextModel(value: unknown): value is string {
    return typeof value === 'string' && TEXT_MODEL_VALUES.has(value)
}

// Keep the provider catalog and the user-facing selector in sync.
for (const model of HIMODELS_TEXT_MODELS) {
    if (!TEXT_MODEL_VALUES.has(model)) throw new Error(`Himodels 文本模型未加入用户模型选项：${model}`)
}
