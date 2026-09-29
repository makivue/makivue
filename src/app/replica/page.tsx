'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Film, Loader2, Play, RefreshCw, Scissors, Sparkles, Upload, Video, WandSparkles, XCircle } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import AuthBar from '@/components/AuthBar'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import HomeLogoLink from '@/components/HomeLogoLink'
import WalletBalance from '@/components/WalletBalance'
import CustomSelect from '@/components/CustomSelect'
import { isLoggedIn, onAuthChange } from '@/lib/auth'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getPollingDelay } from '@/lib/polling'
import { MAX_REFERENCE_VIDEO_BYTES, resolveReferenceVideoMimeType } from '@/lib/storyboard-reference-videos'
import { useI18n } from '@/i18n/I18nProvider'
import { localeDisplayName } from '@/i18n/config'
import {
    DEFAULT_VIDEO_PROVIDER,
    getVideoProviderCapability,
    normalizeVideoDuration,
    SEEDANCE_20_LABEL,
    SEEDANCE_25_LABEL,
    WAN_3_PRIME_LABEL,
    type ProductionVideoProvider
} from '@/lib/provider-capabilities'

type ReplicaMode = 'full' | 'analyze' | 'clip'
type ReplicaVideoProvider = Extract<ProductionVideoProvider, 'seedance' | 'seedance25' | 'wan3' | 'wan3prime'>

interface ReplicaJob {
    taskId: string
    status: string
    mode: string
    progress: number
    currentStage?: string
    message?: string
    stageMessage?: string
    createdAt?: string
    updatedAt?: string
    errorMessage?: string
    resultJson?: string
}

const MODE_OPTIONS: Array<{
    value: ReplicaMode
    title: string
    description: string
    Icon: typeof Sparkles
}> = [
    { value: 'full', title: '同款生成', description: '抽帧分析后生成新脚本和单段视频', Icon: WandSparkles },
    { value: 'clip', title: '智能剪辑', description: '按画面分析选取片段，本机完成剪辑', Icon: Scissors },
    { value: 'analyze', title: '视频 DNA', description: '分析抽样画面的结构和内容特征', Icon: BrainCircuit }
]

const INPUT_CLASS = 'w-full rounded-xl border border-gray-700 bg-gray-900/80 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-violet-500 placeholder:text-gray-600'
const SELECT_BUTTON_CLASS = 'min-h-10.5 rounded-xl bg-gray-900/80 px-3.5 py-2.5'
const TERMINAL_STATUSES = new Set(['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled'])
const SUCCESS_STATUSES = new Set(['completed', 'complete', 'succeeded', 'success'])

const RATIO_OPTIONS = [
    { value: '9:16', label: '9:16 竖屏' },
    { value: '16:9', label: '16:9 横屏' },
    { value: '1:1', label: '1:1 方形' }
]

const CONTENT_LANGUAGES = ['zh-CN', 'en', 'ja', 'ko', 'es'] as const

function normalizeProgress(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.min(100, Math.round(value <= 1 ? value * 100 : value))
}

function modeLabel(mode: string) {
    return mode === 'full' ? '同款生成' : mode === 'clip' ? '智能剪辑' : mode === 'analyze' ? '视频 DNA' : mode || '未知模式'
}

function statusLabel(status: string) {
    const value = status.toLowerCase()
    if (SUCCESS_STATUSES.has(value)) return '已完成'
    if (value === 'failed' || value === 'error') return '生成失败'
    if (value === 'cancelled' || value === 'canceled') return '已取消'
    if (value === 'pending' || value === 'queued') return '等待处理'
    if (value === 'processing' || value === 'running') return '生成中'
    return status || '等待处理'
}

function statusTone(status: string) {
    const value = status.toLowerCase()
    if (SUCCESS_STATUSES.has(value)) return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    if (value === 'failed' || value === 'error') return 'border-red-400/20 bg-red-400/10 text-red-300'
    if (value === 'processing' || value === 'running') return 'border-violet-400/20 bg-violet-400/10 text-violet-300'
    return 'border-gray-600/60 bg-gray-700/30 text-gray-300'
}

function formatDate(value: string | undefined, locale: string) {
    if (!value) return '刚刚'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function resultData(raw?: string): unknown {
    if (!raw) return null
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

function findVideoUrl(value: unknown, key = ''): string | null {
    if (typeof value === 'string' && (value.startsWith('/api/local-media/') || /^https?:\/\//i.test(value)) && (/video|output|result/i.test(key) || /\.(mp4|webm|mov)(\?|$)/i.test(value))) return value
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findVideoUrl(item, key)
            if (found) return found
        }
    }
    if (value && typeof value === 'object') {
        for (const [childKey, child] of Object.entries(value)) {
            const found = findVideoUrl(child, childKey)
            if (found) return found
        }
    }
    return null
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-gray-300">
                {label}
                {hint ? <span className="font-normal text-gray-600">{hint}</span> : null}
            </span>
            {children}
        </label>
    )
}

function JobStatusIcon({ status }: { status: string }) {
    const value = status.toLowerCase()
    if (SUCCESS_STATUSES.has(value)) return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    if (value === 'failed' || value === 'error') return <XCircle className="h-4 w-4 text-red-400" />
    if (!TERMINAL_STATUSES.has(value)) return <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
    return <Clock3 className="h-4 w-4 text-gray-500" />
}

export default function ReplicaPage() {
    const router = useRouter()
    const { locale, t } = useI18n()
    const languageOptions = useMemo(() => CONTENT_LANGUAGES.map(value => ({ value, label: localeDisplayName(locale, value === 'zh-CN' ? 'zh-Hans' : value) })), [locale])
    const [authReady, setAuthReady] = useState(false)
    const [mode, setMode] = useState<ReplicaMode>('full')
    const [videoUrl, setVideoUrl] = useState('')
    const [uploadedVideo, setUploadedVideo] = useState<{ url: string; name: string; sizeBytes: number } | null>(null)
    const [uploadingVideo, setUploadingVideo] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const videoInputRef = useRef<HTMLInputElement>(null)
    const videoUploadRef = useRef<AbortController | null>(null)
    const [topic, setTopic] = useState('')
    const numScenes = '8'
    const [aspectRatio, setAspectRatio] = useState('9:16')
    const [maxDuration, setMaxDuration] = useState('60')
    const [videoProvider, setVideoProvider] = useState<ReplicaVideoProvider>(DEFAULT_VIDEO_PROVIDER)
    const [videoDuration, setVideoDuration] = useState('5')
    const videoDurationOptions = useMemo(() => {
        const values = getVideoProviderCapability(videoProvider)?.duration.values
        return values?.length ? [...values] : [5]
    }, [videoProvider])
    const platform = 'tiktok'
    const voice = ''
    const [language, setLanguage] = useState('zh-CN')
    const [generateScript, setGenerateScript] = useState(true)
    const subMode = 'replica'
    const subtitleStrategy = 'auto'
    const audioMode = 'original'
    const translate = false
    const speechRate = '1'
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [jobs, setJobs] = useState<ReplicaJob[]>([])
    const [jobsLoading, setJobsLoading] = useState(false)
    const [selectedJob, setSelectedJob] = useState<ReplicaJob | null>(null)
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [downloading, setDownloading] = useState<string | null>(null)
    const perPage = 12

    useEffect(() => () => videoUploadRef.current?.abort(), [])

    useEffect(() => {
        const sync = () => {
            if (!isLoggedIn()) {
                router.replace('/')
                return
            }
            setAuthReady(true)
        }
        sync()
        return onAuthChange(sync)
    }, [router])

    const loadJobs = useCallback(
        async (targetPage = page, quiet = false) => {
            if (!quiet) setJobsLoading(true)
            try {
                const response = await clientFetch(`/api/replica/jobs?page=${targetPage}&perPage=${perPage}`, { timeoutMs: 25_000 })
                const json = await readApiJson(response)
                if (!response.ok || !json.success) throw new Error(json.error || '任务列表加载失败')
                setJobs(json.data.items)
                setTotal(json.data.total)
            } catch (loadError) {
                if (!quiet) setError(loadError instanceof Error ? loadError.message : '任务列表加载失败')
            } finally {
                if (!quiet) setJobsLoading(false)
            }
        },
        [page]
    )

    const loadJob = useCallback(async (taskId: string, quiet = false) => {
        try {
            const response = await clientFetch(`/api/replica/jobs/${encodeURIComponent(taskId)}`, { timeoutMs: 25_000 })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error || '任务状态查询失败')
            const detail = json.data as ReplicaJob
            setSelectedJob(current => (current?.taskId === taskId ? detail : current))
            setJobs(current => current.map(item => (item.taskId === taskId ? { ...item, ...detail } : item)))
            return detail
        } catch (loadError) {
            if (!quiet) setError(loadError instanceof Error ? loadError.message : '任务状态查询失败')
            return null
        }
    }, [])

    useEffect(() => {
        if (!authReady) return
        const timer = window.setTimeout(() => void loadJobs(page), 0)
        return () => window.clearTimeout(timer)
    }, [authReady, loadJobs, page])

    useEffect(() => {
        if (!selectedJob || TERMINAL_STATUSES.has(selectedJob.status.toLowerCase())) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let consecutiveFailures = 0
        const poll = async () => {
            const detail = await loadJob(selectedJob.taskId, true)
            if (cancelled) return
            if (detail && TERMINAL_STATUSES.has(detail.status.toLowerCase())) {
                void loadJobs(page, true)
                return
            }
            consecutiveFailures = detail ? 0 : consecutiveFailures + 1
            timer = setTimeout(poll, getPollingDelay({ baseMs: 6_000, failureCount: consecutiveFailures }))
        }
        timer = setTimeout(poll, getPollingDelay({ baseMs: 6_000 }))
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }, [loadJob, loadJobs, page, selectedJob])

    const parsedResult = useMemo(() => resultData(selectedJob?.resultJson), [selectedJob?.resultJson])
    const resultVideo = useMemo(() => findVideoUrl(parsedResult), [parsedResult])
    const totalPages = Math.max(1, Math.ceil(total / perPage))

    async function uploadReferenceVideo(file: File) {
        if (videoUploadRef.current || submitting) return
        setUploadError(null)
        if (!file.size) {
            setUploadError('请选择参考视频')
            return
        }
        if (file.size > MAX_REFERENCE_VIDEO_BYTES) {
            setUploadError('参考视频最大 300MB')
            return
        }
        if (!resolveReferenceVideoMimeType(file.type, file.name)) {
            setUploadError('参考视频仅支持 MP4、MOV、WebM 格式')
            return
        }

        const controller = new AbortController()
        videoUploadRef.current = controller
        setUploadingVideo(true)
        try {
            const form = new FormData()
            form.append('file', file)
            const response = await clientFetch('/api/replica/reference-video', {
                method: 'POST',
                body: form,
                signal: controller.signal,
                timeoutMs: 120_000
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error || '参考视频上传失败，请稍后重试')
            const url = json.data?.url
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('参考视频地址无效')
            if (controller.signal.aborted) return
            setUploadedVideo({ url, name: file.name, sizeBytes: file.size })
            setVideoUrl(url)
        } catch (uploadFailure) {
            if (!controller.signal.aborted) setUploadError(uploadFailure instanceof Error ? uploadFailure.message : '参考视频上传失败，请稍后重试')
        } finally {
            if (videoUploadRef.current === controller) {
                videoUploadRef.current = null
                setUploadingVideo(false)
            }
        }
    }

    async function submit() {
        if (submitting || videoUploadRef.current) return
        if (!videoUrl.trim()) {
            setError('请先上传本地参考视频')
            return
        }

        setSubmitting(true)
        setError(null)
        try {
            const base = { mode, videoUrl: videoUrl.trim(), videoFile: '' }
            const payload =
                mode === 'full'
                    ? {
                          ...base,
                          topic: topic.trim(),
                          numScenes: Number(numScenes),
                          aspectRatio,
                          maxDuration: Number(maxDuration),
                          videoProvider,
                          videoDuration: Number(videoDuration),
                          platform,
                          voice: voice.trim(),
                          language,
                          generateScript
                      }
                    : mode === 'clip'
                      ? {
                            ...base,
                            subMode,
                            subtitleStrategy,
                            aspectRatio,
                            maxClipDuration: Number(maxDuration),
                            translate,
                            targetLanguage: language,
                            contentMapId: '',
                            audioMode,
                            voice: voice.trim(),
                            speechRate: Number(speechRate)
                        }
                      : base
            const response = await clientFetch('/api/replica/jobs', {
                method: 'POST',
                body: JSON.stringify(payload),
                timeoutMs: 45_000
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error || '任务提交失败')
            const job: ReplicaJob = { ...json.data, mode, progress: 0, createdAt: new Date().toISOString() }
            setSelectedJob(job)
            setJobs(current => [job, ...current.filter(item => item.taskId !== job.taskId)])
            setPage(1)
            window.setTimeout(() => void loadJob(job.taskId, true), 800)
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : '任务提交失败')
        } finally {
            setSubmitting(false)
        }
    }

    async function openJob(job: ReplicaJob) {
        setSelectedJob(job)
        setError(null)
        await loadJob(job.taskId)
    }

    async function download(format: 'json' | 'script' | 'srt') {
        if (!selectedJob) return
        setDownloading(format)
        setError(null)
        try {
            const response = await clientFetch(`/api/replica/jobs/${encodeURIComponent(selectedJob.taskId)}/export?format=${format}`, { timeoutMs: 30_000 })
            if (!response.ok) {
                const json = await readApiJson(response)
                throw new Error(json.error || '导出失败')
            }
            const blob = await response.blob()
            const href = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = href
            const disposition = response.headers.get('Content-Disposition') || ''
            anchor.download = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `replica-${selectedJob.taskId}.${format}`
            anchor.click()
            URL.revokeObjectURL(href)
        } catch (downloadError) {
            setError(downloadError instanceof Error ? downloadError.message : '导出失败')
        } finally {
            setDownloading(null)
        }
    }

    if (!authReady) {
        return (
            <div className="app-page relative flex min-h-screen items-center justify-center">
                <HomeLogoLink className="absolute start-4 top-3" />
                <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
            </div>
        )
    }

    return (
        <div className="app-page flex min-h-screen flex-col text-gray-100">
            <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_50%_-10%,rgba(124,58,237,0.18),transparent_58%)]" />
            <SiteHeader
                sticky
                className="z-40"
                contentClassName="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <HomeLogoLink />
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-950/40">
                        <Video className="h-4.5 w-4.5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-sm font-semibold text-white">同款视频生成</h1>
                        <p className="hidden text-[11px] text-gray-500 sm:block">从参考内容到全新成片</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <WalletBalance compact />
                    <AuthBar variant="compact" />
                </div>
            </SiteHeader>

            <main className="relative mx-auto w-full max-w-[1500px] flex-1 px-4 py-7 sm:px-6 lg:py-10">
                <section className="mb-7">
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-300">
                        <Sparkles className="h-3 w-3" /> AI Video Replica
                    </div>
                    <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">给一个参考视频，生成同类型新内容</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">AI 会拆解原片的叙事结构、节奏和视觉表达，再根据你的主题生成新脚本、配音与成片。</p>
                </section>

                {error ? (
                    <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/8 px-4 py-3 text-sm text-red-300">
                        <span>{error}</span>
                        <button
                            type="button"
                            onClick={() => setError(null)}
                            className="shrink-0 text-red-400/70 hover:text-red-200">
                            ×
                        </button>
                    </div>
                ) : null}

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.9fr)]">
                    <section className="rounded-2xl border border-gray-800 bg-gray-900/55 p-4 shadow-2xl shadow-black/10 sm:p-6">
                        <div className="grid gap-2 sm:grid-cols-3">
                            {MODE_OPTIONS.map(option => {
                                const active = option.value === mode
                                return (
                                    <button
                                        key={option.value}
                                        type="button"

                                        onClick={() => setMode(option.value)}
                                        className={`rounded-xl border p-3 text-start transition ${active ? 'border-violet-500/60 bg-violet-500/12 shadow-inner shadow-violet-500/5' : 'border-gray-800 bg-gray-950/45 hover:border-gray-700 hover:bg-gray-800/70'}`}>
                                        <div className="flex items-center gap-2">
                                            <option.Icon className={`h-4 w-4 ${active ? 'text-violet-300' : 'text-gray-500'}`} />
                                            <span className={`text-sm font-medium ${active ? 'text-white' : 'text-gray-300'}`}>{option.title}</span>
                                        </div>
                                        <p className="mt-1.5 text-[11px] leading-4 text-gray-500">{option.description}</p>
                                    </button>
                                )
                            })}
                        </div>

                        <div className="my-5 h-px bg-gray-800" />
                        <div className="mb-4 space-y-3">
                            <input
                                ref={videoInputRef}
                                type="file"
                                accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                                aria-label="上传参考视频"
                                className="hidden"
                                disabled={uploadingVideo || submitting}
                                onChange={event => {
                                    const file = event.target.files?.[0]
                                    event.target.value = ''
                                    if (file) void uploadReferenceVideo(file)
                                }}
                            />
                            <button
                                type="button"

                                onClick={() => videoInputRef.current?.click()}
                                disabled={uploadingVideo || submitting}
                                className="flex w-full items-center justify-center gap-3 rounded-xl border border-dashed border-violet-500/45 bg-violet-500/5 px-4 py-5 text-sm text-violet-200 transition hover:border-violet-400 hover:bg-violet-500/10 disabled:cursor-wait disabled:opacity-60">
                                {uploadingVideo ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Upload className="h-5 w-5 shrink-0" />}
                                <span className="text-start">
                                    <span className="block font-medium">{uploadingVideo ? '上传中...' : uploadedVideo ? '更换参考视频' : '上传参考视频'}</span>
                                    <span className="mt-1 block text-xs text-gray-500">支持 MP4、MOV、WebM，最大 300MB</span>
                                </span>
                            </button>
                            {uploadingVideo ? (
                                <div
                                    className="flex items-center justify-between gap-3 text-xs text-gray-400"
                                    role="status">
                                    <span>上传完成后将自动填入视频链接</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            videoUploadRef.current?.abort()
                                            videoUploadRef.current = null
                                            setUploadingVideo(false)
                                        }}
                                        className="shrink-0 text-violet-300 hover:text-violet-200">
                                        取消上传
                                    </button>
                                </div>
                            ) : null}
                            {uploadError ? (
                                <p
                                    role="alert"
                                    className="text-xs text-red-300">
                                    {uploadError}
                                </p>
                            ) : null}
                            {uploadedVideo ? (
                                <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/40">
                                    <video
                                        key={uploadedVideo.url}
                                        src={uploadedVideo.url}
                                        controls
                                        playsInline
                                        preload="metadata"
                                        aria-label="参考视频预览"
                                        className="max-h-56 w-full bg-black"
                                    />
                                    <div className="flex items-center gap-2 px-3 py-2.5 text-xs">
                                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                        <span
                                            className="min-w-0 flex-1 truncate text-gray-300"
                                            data-i18n-skip>
                                            {uploadedVideo.name}
                                        </span>
                                        <span className="shrink-0 text-gray-500">{(uploadedVideo.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                                        <button
                                            type="button"
                                            disabled={uploadingVideo || submitting}
                                            onClick={() => {
                                                setUploadedVideo(null)
                                                setVideoUrl('')
                                                setUploadError(null)
                                            }}
                                            className="shrink-0 text-gray-400 hover:text-white disabled:opacity-50">
                                            移除
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        <Field
                            label="参考视频链接"
                            hint="可上传视频或填写链接">
                            <div className="relative">
                                <Play className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
                                <input
                                    value={videoUrl}
                                    onChange={event => {
                                        setVideoUrl(event.target.value)
                                        setUploadedVideo(null)
                                        setUploadError(null)
                                    }}
                                    disabled={uploadingVideo || submitting}
                                    placeholder="https://example.com/reference-video.mp4"
                                    inputMode="url"
                                    className={`${INPUT_CLASS} ps-10`}
                                />
                            </div>
                        </Field>
                        <p className="mt-1.5 text-[11px] text-gray-600">请使用服务端可访问的视频地址，并确认你拥有该内容的使用权。</p>

                        {mode === 'full' ? (
                            <div className="mt-5 space-y-4">
                                <Field
                                    label="新视频主题"
                                    hint="留空则由 AI 延展">
                                    <textarea
                                        value={topic}
                                        onChange={event => setTopic(event.target.value)}
                                        rows={3}
                                        placeholder="例如：把原片的职场故事改为校园创业主题，但保留紧凑反转节奏"
                                        className={`${INPUT_CLASS} resize-none`}
                                    />
                                </Field>
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    <Field label="视频模型">
                                        <CustomSelect
                                            value={videoProvider}
                                            onChange={value => {
                                                const next = value as ReplicaVideoProvider
                                                setVideoProvider(next)
                                                setVideoDuration(String(normalizeVideoDuration(next, Number(videoDuration))))
                                            }}
                                            options={[
                                                { value: 'seedance25', label: SEEDANCE_25_LABEL, description: '支持 4-30 秒逐秒选择' },
                                                { value: 'seedance', label: SEEDANCE_20_LABEL, description: '支持 4/5/6/8/10/12/15 秒单镜头' },
                                                { value: 'wan3', label: 'Wan 3.0', description: '使用阿里百炼 Wan 3.0，最长 30 秒' },
                                                { value: 'wan3prime', label: WAN_3_PRIME_LABEL, description: '使用阿里百炼 Wan 3.0 Prime，1080P、最长 30 秒、生成速度更快' }
                                            ]}
                                            ariaLabel="选择同款视频生成模型"
                                            buttonClassName={SELECT_BUTTON_CLASS}
                                        />
                                    </Field>
                                    <Field label="单镜头时长">
                                        <CustomSelect
                                            value={videoDuration}
                                            onChange={setVideoDuration}
                                            options={videoDurationOptions.map(value => ({ value: String(value), label: t('{seconds} 秒', { seconds: value }) }))}
                                            ariaLabel="选择同款视频单镜头时长"
                                            buttonClassName={SELECT_BUTTON_CLASS}
                                        />
                                    </Field>
                                    <Field label="画面比例">
                                        <CustomSelect
                                            value={aspectRatio}
                                            onChange={setAspectRatio}
                                            options={RATIO_OPTIONS}
                                            ariaLabel="画面比例"
                                            buttonClassName={SELECT_BUTTON_CLASS}
                                        />
                                    </Field>

                                    <Field label="内容语言">
                                        <CustomSelect
                                            value={language}
                                            onChange={setLanguage}
                                            options={languageOptions}
                                            ariaLabel="内容语言"
                                            buttonClassName={SELECT_BUTTON_CLASS}
                                        />
                                    </Field>
                                </div>
                                <label className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-950/40 px-3.5 py-3 text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={generateScript}
                                        onChange={event => setGenerateScript(event.target.checked)}
                                        className="h-4 w-4 accent-violet-500"
                                    />
                                    同时生成可编辑的新脚本
                                </label>
                            </div>
                        ) : null}

                        {mode === 'clip' ? (
                            <div className="mt-5 space-y-4">
                                <p className="text-sm text-gray-400">根据抽样画面选择高光片段，保留原片画幅与原声。原片内嵌字幕会随画面保留。</p>
                                <Field label="最长时长（秒）">
                                    <input
                                        type="number"
                                        min="1"
                                        max="600"
                                        value={maxDuration}
                                        onChange={event => setMaxDuration(event.target.value)}
                                        className={INPUT_CLASS}
                                    />
                                </Field>
                            </div>
                        ) : null}

                        {mode === 'analyze' ? (
                            <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-4 text-xs leading-5 text-cyan-100/65">
                                分析任务会输出原片的内容结构、镜头节奏和可复用创作特征，不会生成新视频。完成后可导出 JSON 或脚本文档。
                            </div>
                        ) : null}

                        <button
                            type="button"
                            onClick={submit}
                            disabled={submitting || uploadingVideo}
                            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-55">
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {submitting ? '正在提交任务…' : mode === 'full' ? '开始生成同款视频' : mode === 'clip' ? '开始智能剪辑' : '开始分析视频 DNA'}
                        </button>
                    </section>

                    <section className="min-h-[520px] overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/55 shadow-2xl shadow-black/10">
                        {selectedJob ? (
                            <div className="flex h-full flex-col">
                                <div className="border-b border-gray-800 p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <JobStatusIcon status={selectedJob.status} />
                                                <h3 className="font-medium text-white">{modeLabel(selectedJob.mode)}</h3>
                                            </div>
                                            <p className="mt-1.5 font-mono text-[10px] text-gray-600">{selectedJob.taskId}</p>
                                        </div>
                                        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusTone(selectedJob.status)}`}>{statusLabel(selectedJob.status)}</span>
                                    </div>
                                    <div className="mt-5">
                                        <div className="mb-2 flex items-center justify-between text-xs">
                                            <span className="text-gray-400">{selectedJob.stageMessage || selectedJob.currentStage || statusLabel(selectedJob.status)}</span>
                                            <span className="font-medium text-violet-300">{normalizeProgress(selectedJob.progress)}%</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                                            <div
                                                className="progress-flow h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                                                style={{ width: `${normalizeProgress(selectedJob.progress)}%` }}
                                            />
                                        </div>
                                    </div>
                                    {selectedJob.errorMessage ? <p className="mt-3 rounded-lg bg-red-400/8 px-3 py-2 text-xs text-red-300">{selectedJob.errorMessage}</p> : null}
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                                    {resultVideo ? (
                                        <div className="mb-4 overflow-hidden rounded-xl border border-gray-800 bg-black">
                                            <video
                                                src={resultVideo}
                                                controls
                                                playsInline
                                                className="max-h-[360px] w-full"
                                            />
                                        </div>
                                    ) : null}
                                    {parsedResult ? (
                                        <div>
                                            <div className="mb-2 flex items-center justify-between">
                                                <h4 className="text-xs font-medium text-gray-300">生成结果</h4>
                                                <span className="text-[10px] text-gray-600">JSON 预览</span>
                                            </div>
                                            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-gray-800 bg-gray-950/70 p-4 text-[11px] leading-5 text-gray-400">
                                                {typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult, null, 2)}
                                            </pre>
                                        </div>
                                    ) : (
                                        <div className="flex min-h-[250px] flex-col items-center justify-center text-center">
                                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/15 bg-violet-400/8">
                                                <Film className="h-6 w-6 text-violet-300/70" />
                                            </div>
                                            <p className="text-sm text-gray-300">
                                                {TERMINAL_STATUSES.has(selectedJob.status.toLowerCase()) ? '任务已结束，暂未返回可预览结果' : 'AI 正在处理参考视频'}
                                            </p>
                                            <p className="mt-1 max-w-xs text-xs leading-5 text-gray-600">任务会在后台继续运行，可以离开页面后从历史任务再次查看。</p>
                                        </div>
                                    )}
                                </div>

                                {SUCCESS_STATUSES.has(selectedJob.status.toLowerCase()) ? (
                                    <div className="flex flex-wrap gap-2 border-t border-gray-800 p-4">
                                        {(['json', 'script', 'srt'] as const).map(format => (
                                            <button
                                                key={format}
                                                type="button"
                                                onClick={() => download(format)}
                                                disabled={downloading !== null}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50">
                                                {downloading === format ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{' '}
                                                {format === 'script' ? '脚本' : format.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="flex h-full min-h-[520px] flex-col items-center justify-center p-8 text-center">
                                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-800 bg-gray-950/60">
                                    <Video className="h-7 w-7 text-gray-600" />
                                </div>
                                <h3 className="text-base font-medium text-gray-300">生成结果会显示在这里</h3>
                                <p className="mt-2 max-w-sm text-xs leading-5 text-gray-600">提交参考视频后，可以实时查看处理进度、播放生成的视频并导出脚本或字幕。</p>
                            </div>
                        )}
                    </section>
                </div>

                <section className="mt-7 overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/45">
                    <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3.5 sm:px-5">
                        <div>
                            <h3 className="text-sm font-medium text-white">历史任务</h3>
                            <p className="mt-0.5 text-[11px] text-gray-600">共 {total} 个任务</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => loadJobs(page)}
                            disabled={jobsLoading}
                            className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                            aria-label="刷新任务">
                            <RefreshCw className={`h-4 w-4 ${jobsLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                    {jobsLoading && jobs.length === 0 ? (
                        <div className="flex h-36 items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="py-14 text-center text-sm text-gray-600">还没有同款视频任务</div>
                    ) : (
                        <div className="divide-y divide-gray-800/80">
                            {jobs.map(job => (
                                <button
                                    key={job.taskId}
                                    type="button"
                                    onClick={() => openJob(job)}
                                    className={`grid w-full gap-3 px-4 py-3.5 text-start transition hover:bg-gray-800/55 sm:grid-cols-[minmax(0,1.4fr)_140px_180px_100px] sm:items-center sm:px-5 ${selectedJob?.taskId === job.taskId ? 'bg-violet-500/6' : ''}`}>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <JobStatusIcon status={job.status} />
                                            <span className="truncate text-sm text-gray-200">{job.message || job.currentStage || modeLabel(job.mode)}</span>
                                        </div>
                                        <p className="mt-1 truncate ps-6 font-mono text-[10px] text-gray-600">{job.taskId}</p>
                                    </div>
                                    <span className="text-xs text-gray-500">{modeLabel(job.mode)}</span>
                                    <div className="flex items-center gap-2">
                                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-800">
                                            <div
                                                className="progress-flow h-full rounded-full bg-violet-500"
                                                style={{ width: `${normalizeProgress(job.progress)}%` }}
                                            />
                                        </div>
                                        <span className="w-8 text-end text-[10px] text-gray-600">{normalizeProgress(job.progress)}%</span>
                                    </div>
                                    <span className="text-end text-[11px] text-gray-600">{formatDate(job.createdAt, locale)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {totalPages > 1 ? (
                        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3">
                            <button
                                type="button"
                                onClick={() => setPage(value => Math.max(1, value - 1))}
                                disabled={page <= 1}
                                className="rounded-lg border border-gray-800 p-1.5 text-gray-400 hover:bg-gray-800 disabled:opacity-30">
                                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                            </button>
                            <span className="text-xs text-gray-600">
                                {page} / {totalPages}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPage(value => Math.min(totalPages, value + 1))}
                                disabled={page >= totalPages}
                                className="rounded-lg border border-gray-800 p-1.5 text-gray-400 hover:bg-gray-800 disabled:opacity-30">
                                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                            </button>
                        </div>
                    ) : null}
                </section>
            </main>
            <SiteFooter />
        </div>
    )
}
