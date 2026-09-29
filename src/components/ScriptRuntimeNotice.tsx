'use client'

import { Clock3 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { getEpisodeFormatSpec, type EpisodeFormat } from '@/lib/novel'
import { analyzeScriptTiming } from '@/lib/script-timing'

export default function ScriptRuntimeNotice({ script, episodeFormat }: { script: string; episodeFormat?: EpisodeFormat }) {
    const { t } = useI18n()
    const spec = getEpisodeFormatSpec(episodeFormat)
    const { estimatedSeconds } = analyzeScriptTiming(script)
    if (!script.trim() || (estimatedSeconds >= spec.minDurationSeconds * 0.75 && estimatedSeconds <= spec.maxDurationSeconds * 1.2)) return null

    return (
        <div
            role="status"
            className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
                <p className="font-medium">{t('成片时长提示')}</p>
                <p className="mt-1 leading-relaxed">
                    {t('本集预计 {seconds} 秒，参考时长 {min}–{max} 秒。该估算仅供参考，不影响继续生成；可在分镜阶段调整节奏。', {
                        seconds: estimatedSeconds,
                        min: spec.minDurationSeconds,
                        max: spec.maxDurationSeconds
                    })}
                </p>
            </div>
        </div>
    )
}
