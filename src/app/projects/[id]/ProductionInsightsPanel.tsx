'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, Clock3, DollarSign, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Target } from 'lucide-react'
import { clientFetch } from '@/lib/client-fetch'
import { modelDisplayName } from '@/lib/model-display'
import ModelSourceBadge from '@/components/ModelSourceBadge'
import { useI18n } from '@/i18n/I18nProvider'

interface Summary {
    attempts: number
    completed: number
    failed: number
    successRate: number | null
    reworkAttempts: number
    reworkRate: number | null
    averageDurationMs: number | null
    p95DurationMs: number | null
    estimatedCostUsd: number
    costCoverageRate: number
    episodes: number
    shots: number
    frameCompletionRate: number | null
    videoCompletionRate: number | null
    composeCompletionRate: number | null
}
interface Group {
    stage: string
    provider: string
    attempts: number
    completed: number
    failed: number
    successRate: number | null
    averageDurationMs: number | null
    costUsd: number
}

interface QualityIssue {
    code: string
    severity: 'blocker' | 'warning' | 'info'
    stage: string
    message: string
    evidence?: string
    episodeNumber?: number
    storyboardOrder?: number
}

interface Quality {
    score: number
    status: string
    issueCount: number
    blockerCount: number
    issues: QualityIssue[]
    redoPlan: Array<{ stage: string; label: string; reasonCodes: string[]; targets?: Array<{ episodeNumber?: number; storyboardOrder?: number }> }>
    createdAt: string
}

interface Insights {
    generatedAt: string
    summary: Summary
    groups: Group[]
    failureCategories: Array<{ code: string; count: number }>
    latestQuality: Quality | null
}

const stageLabels: Record<string, string> = { frame: '插图', video: '视频', compose: '合成', merge: '合并', storyboard: '分镜', reference: '参考图', unknown: '其他' }
const severityLabels: Record<QualityIssue['severity'], string> = { blocker: '阻断项', warning: '警告', info: '提示' }

function percent(value: number | null, locale: string) {
    return value === null ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

function duration(value: number | null, locale: string) {
    if (value === null) return '—'
    const amount = value < 60_000 ? value / 1000 : value / 60_000
    return new Intl.NumberFormat(locale, { style: 'unit', unit: value < 60_000 ? 'second' : 'minute', unitDisplay: 'short', maximumFractionDigits: 1 }).format(amount)
}

function usd(value: number, locale: string) {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value)
}

function scoreColor(score: number) {
    if (score >= 85) return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
    if (score >= 65) return 'text-amber-300 border-amber-500/30 bg-amber-500/10'
    return 'text-red-300 border-red-500/30 bg-red-500/10'
}

export default function ProductionInsightsPanel({ projectId }: { projectId: string }) {
    const { locale, t } = useI18n()
    const [data, setData] = useState<Insights | null>(null)
    const [loading, setLoading] = useState(true)
    const [reviewing, setReviewing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await clientFetch(`/api/projects/${projectId}/production-insights`)
            const json = await response.json()
            if (!response.ok || !json.success) throw new Error(json.error ?? '加载生产指标失败')
            setData(json.data)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
            setLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        let cancelled = false
        void (async () => {
            try {
                const response = await clientFetch(`/api/projects/${projectId}/production-insights`)
                const json = await response.json()
                if (!response.ok || !json.success) throw new Error(json.error ?? '加载生产指标失败')
                if (!cancelled) setData(json.data)
            } catch (reason) {
                if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [projectId])

    async function runQualityReview() {
        setReviewing(true)
        setError(null)
        try {
            const response = await clientFetch(`/api/projects/${projectId}/production-insights`, {
                method: 'POST',
                body: JSON.stringify({ action: 'quality-review' })
            })
            const json = await response.json()
            if (!response.ok || !json.success) throw new Error(json.error ?? '自动质检失败')
            setData(json.data.insights)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
            setReviewing(false)
        }
    }

    if (loading && !data)
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                <RefreshCw className="w-4 h-4 animate-spin me-2" />
                正在汇总生产数据...
            </div>
        )
    if (error && !data)
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-red-300">
                <AlertTriangle className="w-6 h-6" />
                <span>{error}</span>
                <button
                    onClick={load}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-200">
                    重试
                </button>
            </div>
        )
    if (!data) return null

    const { summary, latestQuality } = data
    const cards = [
        { label: '生成成功率', value: percent(summary.successRate, locale), sub: t('{completed}/{total} 次', { completed: summary.completed, total: summary.attempts }), icon: Target },
        { label: '返工率', value: percent(summary.reworkRate, locale), sub: `${summary.reworkAttempts} 次额外尝试`, icon: RotateCcw },
        { label: '平均生成耗时', value: duration(summary.averageDurationMs, locale), sub: `P95 ${duration(summary.p95DurationMs, locale)}`, icon: Clock3 },
        { label: '可计算成本', value: usd(summary.estimatedCostUsd, locale), sub: `费率覆盖 ${percent(summary.costCoverageRate, locale)}`, icon: DollarSign }
    ]

    return (
        <div className="flex-1 overflow-y-auto novel-scroll px-8 py-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <Activity className="w-5 h-5 text-cyan-400" />
                        生产数据与自动质检
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">用真实成功率、耗时、返工和成本驱动生产；质检只建议重做最小问题环节。</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={load}
                        disabled={loading}
                        className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 flex items-center gap-2 disabled:opacity-50">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        刷新数据
                    </button>
                    <button
                        onClick={runQualityReview}
                        disabled={reviewing}
                        className="px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 flex items-center gap-2 disabled:opacity-50">
                        <Sparkles className={`w-4 h-4 ${reviewing ? 'animate-pulse' : ''}`} />
                        {reviewing ? '正在逐镜检查...' : '运行自动质检'}
                    </button>
                </div>
            </div>

            {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">{error}</div>}

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {cards.map(({ label, value, sub, icon: Icon }) => (
                    <div
                        key={label}
                        className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                        <div className="flex items-center justify-between text-gray-500">
                            <span className="text-xs">{label}</span>
                            <Icon className="w-4 h-4" />
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
                        <div className="mt-1 text-[11px] text-gray-500">{sub}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
                {[
                    ['插图完成率', summary.frameCompletionRate],
                    ['视频完成率', summary.videoCompletionRate],
                    ['成片合成率', summary.composeCompletionRate]
                ].map(([label, value]) => (
                    <div
                        key={String(label)}
                        className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 flex items-center justify-between">
                        <span className="text-gray-400">{String(label)}</span>
                        <strong className="text-gray-100">{percent(value as number | null, locale)}</strong>
                    </div>
                ))}
            </div>

            <div className="grid xl:grid-cols-[1.4fr_1fr] gap-5">
                <section className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                        <h3 className="font-medium text-white">模型/环节效率</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-gray-500 bg-gray-950/50">
                                <tr>
                                    <th className="text-start px-4 py-2">环节</th>
                                    <th className="text-start px-3 py-2">供应商</th>
                                    <th className="text-end px-3 py-2">尝试</th>
                                    <th className="text-end px-3 py-2">成功率</th>
                                    <th className="text-end px-3 py-2">平均耗时</th>
                                    <th className="text-end px-4 py-2">成本</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.groups.length ? (
                                    data.groups.map(group => (
                                        <tr
                                            key={`${group.stage}:${group.provider}`}
                                            className="border-t border-gray-800/70">
                                            <td className="px-4 py-2.5 text-gray-300">{t(stageLabels[group.stage] ?? group.stage)}</td>
                                            <td className="px-3 py-2.5 text-gray-400">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <ModelSourceBadge model={group.provider} />
                                                    {modelDisplayName(group.provider)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-end">{group.attempts}</td>
                                            <td className="px-3 py-2.5 text-end">{percent(group.successRate, locale)}</td>
                                            <td className="px-3 py-2.5 text-end">{duration(group.averageDurationMs, locale)}</td>
                                            <td className="px-4 py-2.5 text-end">{usd(group.costUsd, locale)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td
                                            colSpan={6}
                                            className="px-4 py-8 text-center text-gray-600">
                                            还没有生成记录
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className={`rounded-xl border p-5 ${latestQuality ? scoreColor(latestQuality.score) : 'border-gray-800 bg-gray-900 text-gray-400'}`}>
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5" />
                            最新质量评分
                        </h3>
                        {latestQuality && <span className="text-3xl font-bold">{Math.round(latestQuality.score)}</span>}
                    </div>
                    {!latestQuality ? (
                        <p className="mt-5 text-sm">点击“运行自动质检”，生成逐镜问题和最小重做方案。</p>
                    ) : (
                        <>
                            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-lg bg-black/15 p-3">问题 {latestQuality.issueCount}</div>
                                <div className="rounded-lg bg-black/15 p-3">阻断项 {latestQuality.blockerCount}</div>
                            </div>
                            <div className="mt-4 space-y-2">
                                <div className="text-xs font-medium">最小重做路径</div>
                                {latestQuality.redoPlan?.length ? (
                                    latestQuality.redoPlan.map(action => (
                                        <div
                                            key={action.stage}
                                            className="rounded-lg bg-black/15 px-3 py-2 text-xs">
                                            <strong>{t(stageLabels[action.stage] ?? action.stage)}</strong>
                                            <span className="ms-2 opacity-80">{action.label}</span>
                                            {action.targets?.length ? <span className="ms-2 opacity-60">{action.targets.length} 个定位</span> : null}
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs opacity-80">当前无需重做</div>
                                )}
                            </div>
                        </>
                    )}
                </section>
            </div>

            {latestQuality?.issues?.length ? (
                <section className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800 font-medium text-white">质检问题</div>
                    <div className="divide-y divide-gray-800">
                        {latestQuality.issues.slice(0, 50).map((issue, index) => (
                            <div
                                key={`${issue.code}:${index}`}
                                className="px-4 py-3 flex items-start gap-3">
                                <span className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded ${issue.severity === 'blocker' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
                                    {t(severityLabels[issue.severity])}
                                </span>
                                <div className="min-w-0">
                                    <div className="text-sm text-gray-200">{issue.message}</div>
                                    <div className="text-[11px] text-gray-500 mt-0.5">
                                        {issue.episodeNumber ? t('第{number}集', { number: issue.episodeNumber }) : ''}
                                        {issue.storyboardOrder ? ` · ${t('镜头')} ${issue.storyboardOrder}` : ''} · {t(stageLabels[issue.stage] ?? issue.stage)} · {issue.code}
                                        {issue.evidence ? ` · ${issue.evidence}` : ''}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    )
}
