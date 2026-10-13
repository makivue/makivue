'use client'

import { Clock3 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { getEpisodeFormatSpec, type EpisodeFormat } from '@/lib/novel'
import { analyzeScriptTiming } from '@/lib/script-timing'

type Props = { script?: string; episodeFormat?: EpisodeFormat; measuredSeconds?: number | null; hasScriptChanges?: boolean }
export default function ScriptRuntimeNotice({ script, episodeFormat, measuredSeconds, hasScriptChanges = false }: Props) {
    const { t } = useI18n()
    if (hasScriptChanges) return null
    if (measuredSeconds != null) {
        if (!Number.isFinite(measuredSeconds) || measuredSeconds <= 0) return null
        const rounded = Math.max(1, Math.round(measuredSeconds))
        const minutes = Math.floor(rounded / 60)
        const seconds = rounded % 60
        const duration = !minutes ? t('{seconds} 秒', { seconds }) : !seconds ? t('{minutes} 分钟', { minutes }) : t('{minutes} 分 {seconds} 秒', { minutes, seconds })
        return <div role="status" className="mb-2 flex items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/40 p-3 text-xs text-gray-300"><Clock3 className="h-4 w-4 shrink-0" /><p>{t('成片实测时长 {duration}。', { duration })}</p></div>
    }
    const value = script ?? ''
    const spec = getEpisodeFormatSpec(episodeFormat)
    const estimate = analyzeScriptTiming(value).estimatedSeconds
    if (!value.trim() || (estimate >= spec.minDurationSeconds * 0.75 && estimate <= spec.maxDurationSeconds * 1.2)) return null
    return <div role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">{t('成片时长提示')}</p><p className="mt-1 leading-relaxed">{t('本集预计 {seconds} 秒，参考时长 {min}–{max} 秒。该估算仅供参考，不影响继续生成；可在分镜阶段调整节奏。', { seconds: estimate, min: spec.minDurationSeconds, max: spec.maxDurationSeconds })}</p></div></div>
}
