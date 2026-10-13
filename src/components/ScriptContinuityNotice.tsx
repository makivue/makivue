'use client'

import { AlertTriangle } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'

export default function ScriptContinuityNotice({ predecessor, paused = false, onReviewChapter }: { predecessor: number; paused?: boolean; onReviewChapter?: () => void }) {
    const { t } = useI18n()
    return (
        <div
            role={paused ? 'alert' : 'status'}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
            <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {paused ? t('第 {episode} 集已修改，本集任务已暂停', { episode: predecessor }) : t('第 {episode} 集已修改，请检查本集衔接', { episode: predecessor })}
            </p>
            <p className="mt-1">{t('已有内容已保留，请检查本集与前集的衔接。')}</p>
            {onReviewChapter && (
                <button
                    type="button"
                    onClick={onReviewChapter}
                    className="mt-2 rounded border border-amber-400/30 px-2.5 py-1.5 hover:bg-amber-400/10">
                    {t('检查章节正文')}
                </button>
            )}
        </div>
    )
}
