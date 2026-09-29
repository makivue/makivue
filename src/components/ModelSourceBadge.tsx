'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { GENERATION_MODEL_SOURCE_LABELS, generationModelSource, type GenerationModelSource } from '@/lib/model-display'

export default function ModelSourceBadge({ model, source, className = '' }: { model?: string | null; source?: GenerationModelSource; className?: string }) {
    const { t } = useI18n()
    const resolvedSource = source ?? generationModelSource(model)
    if (!resolvedSource) return null

    return (
        <span
            className={`inline-flex flex-shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none ${
                resolvedSource === 'direct' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-violet-400/25 bg-violet-400/10 text-violet-300'
            } ${className}`}>
            {t(GENERATION_MODEL_SOURCE_LABELS[resolvedSource])}
        </span>
    )
}
