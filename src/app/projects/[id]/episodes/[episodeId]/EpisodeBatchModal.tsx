'use client'

import WalletBalance from '@/components/WalletBalance'
import { useI18n } from '@/i18n/I18nProvider'
import { clientFetch } from '@/lib/client-fetch'
import {
    isEpisodeBatchExecutorInterrupted,
    normalizeTerminalBatchShots,
    resolveEpisodeBatchFailureStage,
    summarizeEpisodeBatchShots,
    type EpisodeBatchPhase,
    type EpisodeBatchShot,
    type EpisodeBatchShotStatus
} from '@/lib/episode-batch-progress'
import type { ImageQuality } from '@/lib/image-quality'
import { getPollingDelay } from '@/lib/polling'
import type { ProductionImageProvider, ProductionVideoProvider } from '@/lib/provider-capabilities'
import { AlertCircle, CheckCircle2, ImageIcon, RefreshCw, StopCircle, Video, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type Phase = EpisodeBatchPhase
type ShotStatus = EpisodeBatchShotStatus
type ImageProvider = ProductionImageProvider
type VideoProvider = ProductionVideoProvider

interface ShotProgress extends EpisodeBatchShot {
    status: ShotStatus
}

interface Props {
    episodeId: string
    requestId: number
    mode: 'missing' | 'all'
    imageProvider: ImageProvider
    imageQuality: ImageQuality
    videoProvider: VideoProvider
    onClose: () => void
    onDone: () => void // 关闭时调，让父组件 refetch
    onStarted?: (jobId: string, resetApplied: boolean) => void
    onProgress?: (snapshot: { phase: Phase; shots: ShotProgress[] }) => void
}

type BatchStartResponse = { success: boolean; data?: Record<string, unknown>; error?: string }
const batchStartRequestCache = new Map<string, Promise<BatchStartResponse>>()

function startBatchOnce(key: string, request: () => Promise<BatchStartResponse>) {
    const existing = batchStartRequestCache.get(key)
    if (existing) return existing
    const pending = request()
    batchStartRequestCache.set(key, pending)
    const expire = () => {
        setTimeout(() => {
            if (batchStartRequestCache.get(key) === pending) batchStartRequestCache.delete(key)
        }, 5000)
    }
    pending.then(expire, expire)
    return pending
}

class ApiResponseError extends Error {
    constructor(
        message: string,
        readonly payload: Record<string, unknown>
    ) {
        super(message)
    }
}

async function readApiResponse(response: Response): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    const raw = await response.text()
    if (!raw.trim()) {
        throw new Error(`一键生成请求失败（HTTP ${response.status}，服务器未返回错误详情）`)
    }
    let json: { success?: boolean; data?: Record<string, unknown>; error?: string } & Record<string, unknown>
    try {
        json = JSON.parse(raw) as typeof json
    } catch {
        throw new Error(`一键生成请求失败（HTTP ${response.status}）：${raw.slice(0, 180)}`)
    }
    if (!response.ok || json.success !== true) {
        throw new ApiResponseError(json.error || `一键生成请求失败（HTTP ${response.status}）`, json)
    }
    return { success: json.success === true, data: json.data, error: json.error }
}

export default function EpisodeBatchModal({ episodeId, requestId, mode, imageProvider, imageQuality, videoProvider, onClose, onDone, onStarted, onProgress }: Props) {
    const { t } = useI18n()
    const onStartedRef = useRef(onStarted)
    const onProgressRef = useRef(onProgress)
    const [jobId, setJobId] = useState<string | null>(null)
    const [phase, setPhase] = useState<Phase>('running')
    const [total, setTotal] = useState(0)
    const [shots, setShots] = useState<ShotProgress[]>([])
    const [err, setErr] = useState<string | null>(null)
    const [cancelling, setCancelling] = useState(false)
    const [retryKey, setRetryKey] = useState(0)
    const [requestMode, setRequestMode] = useState<'missing' | 'all'>(mode)
    const executorRecoveryAttemptsRef = useRef(0)

    useEffect(() => {
        onStartedRef.current = onStarted
    }, [onStarted])

    useEffect(() => {
        onProgressRef.current = onProgress
    }, [onProgress])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const startKey = `${episodeId}:${requestId}:${retryKey}:${requestMode}:${imageProvider}:${imageQuality}:${videoProvider}`
                const json = await startBatchOnce(startKey, async () => {
                    const res = await clientFetch(`/api/episodes/${episodeId}/generate-all`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: requestMode, imageProvider, imageQuality, videoProvider })
                    })
                    return readApiResponse(res)
                })
                if (cancelled) return
                const nextJobId = String(json.data?.jobId ?? '')
                if (!nextJobId) throw new Error('一键生成接口未返回任务 ID')
                const initialShots = Array.isArray(json.data?.shots) ? (json.data.shots as ShotProgress[]) : []
                setJobId(nextJobId)
                setTotal(Number(json.data?.totalShots ?? 0))
                setShots(initialShots)
                onStartedRef.current?.(nextJobId, json.data?.resetApplied === true)
                if (initialShots.length > 0) onProgressRef.current?.({ phase: 'running', shots: initialShots })
            } catch (e) {
                if (cancelled) return
                setPhase('error')
                setErr(e instanceof Error ? e.message : String(e))
            }
        })()
        return () => {
            cancelled = true
        }
    }, [episodeId, requestId, imageProvider, imageQuality, videoProvider, requestMode, retryKey])

    useEffect(() => {
        if (!jobId) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let consecutiveFailures = 0
        const poll = async () => {
            try {
                const res = await clientFetch(`/api/episodes/${episodeId}/generate-all/status/${jobId}?view=progress`)
                const json = await readApiResponse(res)
                if (cancelled) return
                const d = json.data as { phase: Phase; total: number; shots: ShotProgress[]; errorMsg?: string }
                if (isEpisodeBatchExecutorInterrupted(d) && executorRecoveryAttemptsRef.current < 1) {
                    executorRecoveryAttemptsRef.current += 1
                    setRequestMode('missing')
                    setJobId(null)
                    setPhase('running')
                    setErr('生成服务刚刚发布或重启，正在自动继续未完成镜头…')
                    setRetryKey(value => value + 1)
                    return
                }
                setPhase(d.phase)
                setTotal(d.total)
                setShots(d.shots)
                onProgressRef.current?.({ phase: d.phase, shots: d.shots })
                setErr(d.errorMsg ?? null)
                consecutiveFailures = 0
                if (d.phase === 'running') {
                    timer = setTimeout(poll, getPollingDelay({ baseMs: 7_500, failureCount: consecutiveFailures }))
                }
            } catch (e) {
                if (cancelled) return
                setErr(e instanceof Error ? e.message : String(e))
                // 状态接口短暂 503/504 不代表生成任务失败；保留已知进度并继续重试。
                consecutiveFailures += 1
                timer = setTimeout(poll, getPollingDelay({ baseMs: 7_500, failureCount: consecutiveFailures }))
            }
        }
        poll()
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }, [jobId, episodeId])

    const displayShots = normalizeTerminalBatchShots(shots, phase)
    const { completed, failed, skipped, running } = summarizeEpisodeBatchShots(displayShots)
    const pct = total > 0 ? Math.round(((completed + failed + skipped) / total) * 100) : 0
    const queueWaitingMessage = displayShots.map(shot => shot.errorMsg).find(message => message && /生成队列已满|生成队列正在检查|任务已进入队列/.test(message))

    function handleClose() {
        onDone()
        onClose()
    }

    async function handleCancel() {
        if (!jobId || cancelling) return
        if (!confirm(t('确认暂停一键生成？当前正在跑的镜头会被中断。'))) return
        setCancelling(true)
        try {
            const res = await clientFetch(`/api/episodes/${episodeId}/generate-all/cancel/${jobId}`, { method: 'POST' })
            await readApiResponse(res)
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setCancelling(false)
        }
    }

    function handleRetryMissing() {
        onDone()
        executorRecoveryAttemptsRef.current = 0
        setJobId(null)
        setShots([])
        setTotal(0)
        setErr(null)
        setPhase('running')
        setRequestMode('missing')
        setRetryKey(value => value + 1)
    }

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
                {/* 顶栏 */}
                <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
                    <div className="flex-1">
                        <h2 className="text-white font-semibold text-base flex items-center gap-2">
                            {phase === 'running' && <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />}

                            {phase === 'done' && (failed === 0 && skipped === 0 ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <AlertCircle className="w-4 h-4 text-yellow-400" />)}
                            {phase === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                            {phase === 'cancelled' && <StopCircle className="w-4 h-4 text-yellow-400" />}
                            {requestMode === 'all' ? '全部重新生成本集（插图 + 图生视频）' : t('一键生成本集（插图 + 图生视频）')}
                        </h2>
                        <div className="text-xs text-gray-400 mt-1">
                            {phase === 'running' && total > 0 && (
                                <>
                                    {t('共')} {total} {t('个分镜')} · {t('已完成')} {completed} · {t('进行中')} {running}
                                    {failed > 0 ? ` · ${t('失败')} ${failed}` : ''}
                                    {skipped > 0 ? ` · ${t('未完成')} ${skipped}` : ''}
                                </>
                            )}
                            {phase === 'done' && (
                                <>
                                    {failed === 0 && skipped === 0 ? t('全部完成') : '处理结束'} · {completed}/{total} {t('成功')}
                                    {failed > 0 ? ` · ${t('失败')} ${failed}` : ''}
                                    {skipped > 0 ? ` · 未完成 ${skipped}` : ''}
                                </>
                            )}
                            {phase === 'error' && (err ?? t('出错了'))}

                            {phase === 'cancelled' && (
                                <>
                                    {t('已取消')} · {t('已完成')} {completed}/{total}
                                    {failed > 0 ? ` · ${t('失败')} ${failed}` : ''}
                                </>
                            )}
                            {phase === 'running' && total === 0 && t('正在启动任务...')}
                        </div>
                    </div>
                    <WalletBalance compact />
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 总进度条 */}
                {total > 0 && (
                    <div className="h-1 bg-gray-800">
                        <div
                            className="progress-flow h-full bg-gradient-to-r from-purple-500 to-pink-500"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}

                {/* 列表 */}
                <div className="flex-1 min-h-0 overflow-y-auto novel-scroll px-5 py-4 space-y-2">
                    {phase === 'running' && queueWaitingMessage && (
                        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs leading-relaxed text-yellow-100">
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-300" />
                            <span>{queueWaitingMessage}</span>
                        </div>
                    )}
                    {shots.length === 0 && phase === 'running' && <p className="text-sm text-gray-500 text-center py-8">{t('正在准备任务...')}</p>}

                    {displayShots.map(sh => {
                        const isRunning = sh.status === 'frame_running' || sh.status === 'video_running'
                        const isDone = sh.status === 'video_done'
                        const isFailed = sh.status === 'failed'
                        const isSkipped = sh.status === 'skipped'
                        const failureStage = resolveEpisodeBatchFailureStage(sh)
                        const frameCompleted = sh.status === 'frame_done' || sh.status === 'video_running' || sh.status === 'video_done' || (isFailed && failureStage === 'video')
                        return (
                            <div
                                key={sh.storyboardId}
                                className={`border rounded-lg p-3 flex items-center gap-3 ${
                                    isDone
                                        ? 'border-green-700/40 bg-green-950/10'
                                        : isFailed
                                          ? 'border-red-700/40 bg-red-950/10'
                                          : isSkipped
                                            ? 'border-yellow-700/40 bg-yellow-950/10'
                                            : isRunning
                                              ? 'border-fuchsia-500/70 bg-fuchsia-500/15 shadow-[0_0_16px_rgba(217,70,239,0.2)]'
                                              : 'border-gray-800 bg-gray-950/50'
                                }`}>
                                <span
                                    className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                        isDone
                                            ? 'bg-green-900/40 text-green-400'
                                            : isFailed
                                              ? 'bg-red-900/40 text-red-400'
                                              : isSkipped
                                                ? 'bg-yellow-900/40 text-yellow-300'
                                                : isRunning
                                                  ? 'bg-fuchsia-500/30 text-fuchsia-100'
                                                  : 'bg-gray-800 text-gray-500'
                                    }`}>
                                    {sh.order}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-white flex items-center gap-2">
                                        {t('镜头')} {sh.order}
                                        <div className="flex items-center gap-1 text-xs text-gray-400">
                                            <span
                                                className={`flex items-center gap-0.5 ${
                                                    sh.status === 'frame_running' ? 'text-fuchsia-200' : frameCompleted ? 'text-green-400' : isFailed && failureStage === 'frame' ? 'text-red-400' : ''
                                                }`}>
                                                <ImageIcon className="w-3 h-3" />
                                                {sh.status === 'frame_running'
                                                    ? t('生成中')
                                                    : frameCompleted
                                                      ? `${t('插图')} ✓`
                                                      : isFailed && failureStage === 'frame'
                                                        ? `${t('插图')}失败`
                                                        : t('插图')}
                                            </span>
                                            <span className="text-gray-600">→</span>
                                            <span
                                                className={`flex items-center gap-0.5 ${
                                                    sh.status === 'video_running'
                                                        ? 'text-fuchsia-200'
                                                        : sh.status === 'video_done'
                                                          ? 'text-green-400'
                                                          : isFailed && failureStage === 'video'
                                                            ? 'text-red-400'
                                                            : ''
                                                }`}>
                                                <Video className="w-3 h-3" />
                                                {sh.status === 'video_running'
                                                    ? t('生成中')
                                                    : sh.status === 'video_done'
                                                      ? `${t('视频')} ✓`
                                                      : isFailed && failureStage === 'video'
                                                        ? `${t('视频')}失败`
                                                        : t('视频')}
                                            </span>
                                        </div>
                                    </div>
                                    {sh.errorMsg && (
                                        <div
                                            className={`mt-0.5 truncate text-[11px] ${isFailed ? 'text-red-400' : 'text-yellow-400'}`}
                                            title={sh.errorMsg}>
                                            {sh.errorMsg}
                                        </div>
                                    )}
                                </div>
                                {isRunning && <RefreshCw className="w-4 h-4 animate-spin text-fuchsia-300 flex-shrink-0" />}
                                {isDone && <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />}
                                {isFailed && <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                                {isSkipped && <StopCircle className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
                            </div>
                        )
                    })}
                </div>

                {/* 底部 */}
                <div className="px-5 py-3 border-t border-gray-800 flex items-center gap-3">
                    <div className="flex-1 text-xs text-gray-400">
                        {phase === 'running' && t('任务可以关闭弹窗在后台运行，稍后回来查看结果。')}
                        {phase === 'cancelled' && t('已暂停。下次再点「一键生成」会从未完成的镜头继续。')}

                        {(phase === 'done' || phase === 'error') && (failed > 0 || skipped > 0 ? t('已完成素材会保留；重试只处理未完成镜头。') : t('生成完成后可以在本集查看和导出成片。'))}
                    </div>
                    {phase === 'running' && jobId && (
                        <button
                            onClick={handleCancel}
                            disabled={cancelling}
                            className="px-4 py-2 text-sm bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5">
                            <StopCircle className="w-4 h-4" />
                            {cancelling ? t('正在停止...') : t('暂停生成')}
                        </button>
                    )}

                    {(phase === 'done' || phase === 'error') && (failed > 0 || skipped > 0) && (
                        <button
                            onClick={handleRetryMissing}
                            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
                            <RefreshCw className="h-4 w-4" />
                            {t('重试未完成')}
                        </button>
                    )}
                    <button
                        onClick={handleClose}
                        className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded-lg">
                        {phase === 'running' ? t('后台运行') : t('关闭')}
                    </button>
                </div>
            </div>
        </div>
    )
}
