'use client'

import { AlertTriangle, Pencil, RefreshCw, Scissors, Wrench } from 'lucide-react'
import { getGenerationErrorGuidance } from '@/lib/generation-error-guidance'
import { modelDisplayName } from '@/lib/model-display'
import ModelSourceBadge from '@/components/ModelSourceBadge'
import { useI18n } from '@/i18n/I18nProvider'

export default function GenerationFailureNotice({
    errorMessage,
    taskLabel,
    provider,
    onEdit,
    onRetry,
    onResolve,
    resolveLabel = '自动处理',
    editLabel,
    retryLabel = '重新生成当前步骤',
    resolveDisabled = false,
    retryDisabled = false
}: {
    errorMessage: string
    taskLabel?: string
    provider?: string
    onEdit?: () => void
    onRetry?: () => void | Promise<void>
    onResolve?: () => void | Promise<void>
    resolveLabel?: string
    editLabel?: string
    retryLabel?: string
    resolveDisabled?: boolean
    retryDisabled?: boolean
}) {
    const { t } = useI18n()
    const guidance = getGenerationErrorGuidance(errorMessage)
    const adminTone = guidance.adminRequired

    return (
        <div
            role="alert"
            aria-live="polite"
            data-testid={`generation-error-${guidance.kind}`}
            className={`border-t px-3 py-3 text-[11px] leading-relaxed ${adminTone ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-red-500/30 bg-red-500/10 text-red-100'}`}>
            <div className="flex items-start gap-2">
                {adminTone ? <Wrench className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{taskLabel && guidance.configurationIssue ? `${t(taskLabel)}${t(guidance.title)}` : t(guidance.title)}</span>
                        {provider && !['executor_interrupted', 'content_safety', 'translation'].includes(guidance.kind) && (
                            <span className="inline-flex items-center gap-1.5 rounded bg-black/20 px-1.5 py-0.5 text-[10px] opacity-70">
                                <ModelSourceBadge model={provider} />
                                {modelDisplayName(provider)}
                            </span>
                        )}
                        {guidance.adminRequired && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200">{t('需要管理员处理')}</span>}
                    </div>
                    <p className="mt-1 opacity-85">{t(guidance.summary)}</p>
                    <p className="mt-1 font-medium">{t(guidance.nextStep)}</p>
                    {(onResolve || onEdit || (guidance.retryable && onRetry)) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {onResolve && (
                                <button
                                    type="button"
                                    onClick={() => void onResolve()}
                                    disabled={resolveDisabled}
                                    className="inline-flex items-center gap-1 rounded border border-red-200/25 bg-red-100/15 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-100/25 disabled:cursor-wait disabled:opacity-40">
                                    <Scissors className="h-3 w-3" />
                                    {resolveDisabled ? t('正在处理...') : t(resolveLabel)}
                                </button>
                            )}
                            {onEdit && guidance.editTarget && (
                                <button
                                    type="button"
                                    onClick={onEdit}
                                    className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-medium text-white hover:bg-white/15">
                                    <Pencil className="h-3 w-3" />
                                    {t(editLabel ?? (guidance.editTarget === 'dialogue' ? '检查并修改台词' : guidance.editTarget === 'chapter' ? '返回章节修改' : '定位并修改图像描述'))}
                                </button>
                            )}
                            {guidance.retryable && onRetry && (
                                <button
                                    type="button"
                                    onClick={() => void onRetry()}
                                    disabled={retryDisabled}
                                    className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-medium text-white hover:bg-white/15 disabled:cursor-wait disabled:opacity-40">
                                    <RefreshCw className={`h-3 w-3 ${retryDisabled ? 'animate-spin' : ''}`} />
                                    {retryDisabled ? t('正在重新生成...') : t(retryLabel)}
                                </button>
                            )}
                        </div>
                    )}
                    <details className="mt-2 opacity-70">
                        <summary className="cursor-pointer select-none text-[10px] hover:opacity-100">{t('技术详情（提供给管理员）')}</summary>
                        <pre
                            data-i18n-skip
                            className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-black/20 bg-black/20 p-2 font-mono text-[10px] leading-relaxed">
                            {errorMessage}
                        </pre>
                    </details>
                </div>
            </div>
        </div>
    )
}
