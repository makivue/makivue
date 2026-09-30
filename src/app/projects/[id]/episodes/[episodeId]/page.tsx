'use client'

import { useConfirmDialog } from '@/components/ConfirmDialog'
import CreationJourney from '@/components/CreationJourney'
import CustomSelect from '@/components/CustomSelect'
import GenerationFailureNotice from '@/components/GenerationFailureNotice'
import HomeLogoLink from '@/components/HomeLogoLink'
import ModelSwitcher from '@/components/ModelSwitcher'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import { pushToast } from '@/components/Toast'
import WalletBalance from '@/components/WalletBalance'
import { useI18n } from '@/i18n/I18nProvider'
import { isLocale, localeDisplayName, localizePath } from '@/i18n/config'
import Link, { useParams } from '@/i18n/navigation'
import { getAuthToken } from '@/lib/auth'
import { clientFetch, isRequestAbortError, readApiJson } from '@/lib/client-fetch'
import {
    isEpisodeBatchExecutorInterrupted,
    resolveEpisodeBatchFailureStage,
    type EpisodeBatchFailureStage,
    type EpisodeBatchPhase,
    type EpisodeBatchShot,
    type EpisodeBatchShotStatus
} from '@/lib/episode-batch-progress'
import { createEpisodeNavigationLoader } from '@/lib/episode-navigation-loader'
import type { EpisodeStatusSnapshot } from '@/lib/episode-status'
import { episodeWorkspaceRoute, neighbouringEpisodeIds } from '@/lib/episode-workspace-navigation'
import { releaseGenerationCapacityReservation, tryReserveGenerationCapacity, type GenerationCapacityReservations } from '@/lib/generation-capacity-reservations'
import { isUnavailablePageStatus, isValidRouteResourceId, redirectToHomepage } from '@/lib/home-redirect'
import type { ImageProviderSwitch } from '@/lib/image-generation-recovery'
import { normalizeImageQuality, type ImageQuality } from '@/lib/image-quality'
import { GENERATION_MODEL_SOURCE_LABELS, GENERATION_MODEL_SOURCES, generationModelSource, isGenerationModelVisible, modelDisplayNameWithSource } from '@/lib/model-display'
import { getPollingDelay } from '@/lib/polling'
import {
    DEFAULT_VIDEO_PROVIDER,
    getVideoProviderCapability,
    isAvailableProductionVideoProvider,
    isProductionImageProvider,
    normalizeVideoDuration,
    SEEDANCE_20_LABEL,
    SEEDANCE_25_LABEL,
    supportsVideoReferenceMode,
    WAN_3_PRIME_LABEL,
    type ProductionImageProvider,
    type ProductionVideoProvider
} from '@/lib/provider-capabilities'
import { shouldGenerateEpisodeStoryboards } from '@/lib/storyboard-batch-selection'
import { resolveVideoFailureDisplay } from '@/lib/storyboard-failure-display'
import { storyboardGenerationEndpoint, type StoryboardGenerationRequestType } from '@/lib/storyboard-generation-endpoint'
import { collectStoryboardGenerationFailureNotices, generationFeedbackStageForRequest, generationFeedbackWatchKey } from '@/lib/storyboard-generation-feedback'
import { buildStoryboardGenerationRequest } from '@/lib/storyboard-generation-request'
import {
    formatReferenceVideoDurationViolation,
    getReferenceVideoDurationViolation,
    MAX_REFERENCE_VIDEO_BYTES,
    MAX_STORYBOARD_REFERENCE_VIDEOS,
    parseStoryboardReferenceVideos,
    resolveReferenceVideoMimeType,
    type StoryboardReferenceVideo
} from '@/lib/storyboard-reference-videos'
import { extractStoryboardBoundaryStates } from '@/lib/storyboard-state'
import { getVideoSpeechCapability, usesEmbeddedVideoAudio } from '@/lib/video-audio-policy'
import { normalizeVideoLanguage, type VideoLanguage } from '@/lib/video-language'
import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    BookOpen,
    Check,
    CheckCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    X as CloseIcon,
    Film as FilmIcon,
    Globe,
    Image as ImageIcon,
    Info,
    Languages,
    Layers,
    MapPin,
    Merge,
    Minus,
    Play,
    Plus,
    RefreshCw,
    Settings,
    Sparkles,
    StopCircle,
    Trash2,
    Upload,
    Users,
    Video,
    Wand2,
    XCircle
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import EpisodeBatchModal from './EpisodeBatchModal'

// 短剧生成阶段开放视频模型选择；顶部选择作为新分镜和一键生成的默认模型。
const SHOW_SHORT_DRAMA_VIDEO_MODEL_CONTROLS = true
const MAX_ILLUSTRATION_COUNT = 10

type ImageProvider = ProductionImageProvider
type ModelOption<T extends string> = {
    value: T
    label: string
    description: string
}

function ModelSelect<T extends string>({
    value,
    options,
    onChange,
    disabled,
    label,
    title,
    icon
}: {
    value: T
    options: readonly ModelOption<T>[]
    onChange: (value: T) => void
    disabled?: boolean
    label: string
    title: string
    icon: ReactNode
}) {
    const { t } = useI18n()
    const [open, setOpen] = useState(false)
    const visibleOptions = options.filter(option => isGenerationModelVisible(option.value))
    const selected = visibleOptions.find(option => option.value === value) ?? visibleOptions[0]
    const optionGroups = GENERATION_MODEL_SOURCES.map(source => ({
        source,
        options: visibleOptions.filter(option => generationModelSource(option.value) === source)
    })).filter(group => group.options.length > 0)

    useEffect(() => {
        if (!open) return
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', closeOnEscape)
        return () => document.removeEventListener('keydown', closeOnEscape)
    }, [open])

    return (
        <div className="relative flex-shrink-0 whitespace-nowrap">
            <button
                type="button"
                onClick={() => setOpen(current => !current)}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                title={title}
                className="flex h-9 min-w-[180px] items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 text-start transition-colors hover:border-gray-600 hover:bg-gray-800 disabled:cursor-wait disabled:opacity-50">
                {icon}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">{selected.label}</span>
                {disabled ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-gray-500" /> : <ChevronDown className={`h-3.5 w-3.5 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />}
            </button>

            {open && (
                <>
                    <button
                        type="button"
                        aria-label="关闭模型选择"
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        role="listbox"
                        aria-label={label}
                        className="absolute left-0 top-full z-50 mt-2 w-full min-w-[260px] overflow-hidden rounded-xl border border-gray-700 bg-gray-900 p-1.5 shadow-2xl shadow-black/50">
                        {optionGroups.map(group => (
                            <div key={group.source}>
                                <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium tracking-wider text-gray-500">{t(GENERATION_MODEL_SOURCE_LABELS[group.source])}</div>
                                {group.options.map(option => {
                                    const active = option.value === value
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="option"
                                            aria-selected={active}
                                            onClick={() => {
                                                onChange(option.value)
                                                setOpen(false)
                                            }}
                                            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors ${
                                                active ? 'bg-purple-500/15 text-purple-100' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                                            }`}>
                                            <span
                                                className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${active ? 'border-purple-400 bg-purple-500 text-white' : 'border-gray-600'}`}>
                                                {active && <Check className="h-3 w-3" />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xs font-medium">{option.label}</span>
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

function readBrowserVideoDuration(file: File): Promise<number | null> {
    return new Promise(resolve => {
        const video = document.createElement('video')
        const objectUrl = URL.createObjectURL(file)
        let settled = false
        const finish = (duration: number | null) => {
            if (settled) return
            settled = true
            window.clearTimeout(timeout)
            video.removeAttribute('src')
            video.load()
            URL.revokeObjectURL(objectUrl)
            resolve(duration)
        }
        const timeout = window.setTimeout(() => finish(null), 10_000)
        video.preload = 'metadata'
        video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null)
        video.onerror = () => finish(null)
        video.src = objectUrl
    })
}

function parseSubtitleUrls(raw: string | null | undefined): Array<{ lang: string; url: string }> {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return Object.entries(parsed)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
            .map(([lang, url]) => ({ lang, url }))
    } catch {
        return []
    }
}

function parseSubtitleProgress(raw: Episode['merges'][number]['subtitleProgress']) {
    if (!raw) return null
    if (typeof raw !== 'string') return raw
    try {
        const parsed = JSON.parse(raw) as unknown
        return parsed && typeof parsed === 'object' ? (parsed as { expected?: string[]; completed?: string[]; failed?: string[] }) : null
    } catch {
        return null
    }
}

interface Character {
    id: string
    name: string
    appearancePrompt: string | null
    referenceImageUrl: string | null
}
interface Scene {
    id: string
    name: string
    referenceImageUrl: string | null
}
interface StoryboardCharacter {
    character: Character
}

interface Illustration {
    id: string
    type: 'first_frame' | 'middle_frame' | 'last_frame'
    label: string
    url: string
    createdAt: string
}

interface VideoGenerationRequest {
    id: string
    provider: string
    status: string
    taskId: string | null
    requestBody: string | null
    createdAt: string
}

interface KlingComparison {
    id: string
    status: string
    resultUrl: string | null
    errorMsg: string | null
    createdAt: string
}

interface SpeechComparison extends KlingComparison {
    provider: 'seedance' | 'wanx'
}

interface Storyboard {
    id: string
    order: number
    shotType: string | null
    duration: number
    dialogue: string | null
    narration: string | null
    actionDesc: string | null
    imagePrompt: string | null
    videoPrompt: string | null
    motionOverride: string | null
    fullPromptOverride: string | null
    continuityMode: 'independent' | 'stateful' | 'continuous' | 'seamless'
    continuityGroup: number | null
    continuityReason: string | null
    firstFrameUrl: string | null
    lastFrameUrl: string | null
    plannedLastFrameUrl: string | null
    actualVideoEndFrameUrl: string | null
    referenceVideoAssets?: StoryboardReferenceVideo[] | null
    videoUrl: string | null
    audioUrl: string | null
    composedVideoUrl: string | null
    frameStatus: string
    videoStatus: string
    composeStatus: string
    expectedAudioMode: string | null
    compositionMode: string | null
    polishStatus: string | null
    normalizationMetadata?: { productionWarnings?: string[]; sourceBeatIds?: string[] } | null
    promptVersion: string | null
    generationModel: string | null
    scene: Scene | null
    characters: StoryboardCharacter[]
    illustrations?: Illustration[]
    latestErrors?: Record<string, { errorMsg: string; provider: string; createdAt: string }>
    latestFrameRecovery?: {
        generationId: string
        generationType: string
        recovery: 'fallback_provider' | 'safety_rewrite'
        requestedProvider: string
        actualProvider: string
        safetyRewriteCount: number
        providerSwitch?: ImageProviderSwitch
    } | null
    latestVideoRequest?: VideoGenerationRequest | null
    latestHimodelsUsage?: {
        generationId: string
        provider: string
        usage: Record<string, number | string | boolean> | null
    } | null
    latestKlingComparison?: KlingComparison | null
    latestSpeechComparisons?: SpeechComparison[]
}

function storyboardUsesEmbeddedVideoAudio(storyboard: Storyboard): boolean {
    if (!storyboard.videoUrl) return false
    if (storyboard.latestVideoRequest) {
        return usesEmbeddedVideoAudio(storyboard.latestVideoRequest.provider) && storyboard.latestVideoRequest.status === 'completed'
    }
    // 兼容已经清理 generation 明细、但仍保留原生音频契约的旧数据。
    return storyboard.videoStatus === 'completed' && ['native_dialogue', 'native_ambience'].includes(storyboard.expectedAudioMode ?? '')
}

function storyboardNeedsVideoAudioRegeneration(storyboard: Storyboard): boolean {
    if (!storyboard.dialogue?.trim() || storyboardUsesEmbeddedVideoAudio(storyboard)) return false
    return !storyboard.audioUrl || !storyboard.composedVideoUrl || !['audio_mix', 'audio_replace'].includes(storyboard.compositionMode ?? '')
}

interface Episode {
    statusVersion?: string
    id: string
    sourceVersion?: number
    episodeNumber: number
    title: string | null
    script: string | null
    status: string
    videoUrl: string | null
    storyboards: Storyboard[]
    merges: Array<{
        id: string
        status: string
        videoUrl: string | null
        subtitleUrls: string | null
        videoStatus: string | null
        subtitleStatus: string | null
        subtitleProgress: { expected?: string[]; completed?: string[]; failed?: string[] } | string | null
        targetWidth: number | null
        targetHeight: number | null
    }>
}

interface EpisodeSummary {
    id: string
    episodeNumber: number
    title: string | null
    synopsis?: string | null
    status: string
    hasMergedVideo?: boolean
    _count: { storyboards: number }
}

interface ProjectSlim {
    id: string
    title: string
    genre: string | null
    totalEpisodes: number
    novelSetup?: string | null
    episodes: EpisodeSummary[]
    // 项目接口已经返回角色/场景详情，章节页直接复用，避免每次轮询再发两次请求。
    characters: Character[]
    scenes: Scene[]
}

type GenerationCapacityCategory = 'image' | 'video'

interface GenerationCapacity {
    category: GenerationCapacityCategory
    active: number
    limit: number
    remaining: number
    available: boolean
    message: string | null
}

interface ApiPayload<T> {
    success?: boolean
    data: T
    error?: string
}

type EpisodeRefreshResult = 'success' | 'redirected' | 'transient-error' | 'error'

type EpisodeWorkspaceTab = 'script' | 'storyboard' | 'preview' | 'finished'

function episodeWorkspaceTabFromHash(hash: string): EpisodeWorkspaceTab | null {
    if (hash === '#episode-script') return 'script'
    if (hash === '#production-overview' || /^#shot-\d+$/.test(hash)) return 'storyboard'
    if (hash === '#episode-preview') return 'preview'
    if (hash === '#episode-finished') return 'finished'
    return null
}

type EpisodeWorkspaceCache = {
    project: ProjectSlim | null
    episodes: Map<string, Episode>
    lastEpisode: Episode | null
    characters: Character[]
    scenes: Scene[]
    globalNavCollapsed: boolean
    progressNavCollapsed: boolean
    progressNavScrollTop: number
}

// Episode-local state remounts on navigation. Keep the latest workspace in memory
// so the shell paints immediately while the destination's data is validated.
const episodeWorkspaceCache = new Map<string, EpisodeWorkspaceCache>()
const episodeNavigationLoader = createEpisodeNavigationLoader<Episode>({
    getScope: getAuthToken,
    fetchDetail: async id => (await fetchJson<Episode>(`/api/episodes/${id}`, false)).data,
    fetchStatus: async id => (await fetchJson<EpisodeStatusSnapshot>(`/api/episodes/${id}/status`, false)).data
})

function readEpisodeWorkspaceCache(projectId: string, episodeId: string) {
    if (typeof window === 'undefined') return null
    const cached = episodeWorkspaceCache.get(projectId)
    if (!cached) return null
    return {
        project: cached.project,
        episode: cached.episodes.get(episodeId) ?? cached.lastEpisode,
        characters: cached.characters,
        scenes: cached.scenes,
        globalNavCollapsed: cached.globalNavCollapsed,
        progressNavCollapsed: cached.progressNavCollapsed,
        progressNavScrollTop: cached.progressNavScrollTop
    }
}

function rememberEpisodeWorkspace(
    projectId: string,
    snapshot: {
        project: ProjectSlim | null
        episode: Episode | null
        characters: Character[]
        scenes: Scene[]
        globalNavCollapsed: boolean
        progressNavCollapsed: boolean
        progressNavScrollTop: number
    }
) {
    if (typeof window === 'undefined') return
    const cached = episodeWorkspaceCache.get(projectId) ?? {
        project: null,
        episodes: new Map<string, Episode>(),
        lastEpisode: null,
        characters: [],
        scenes: [],
        globalNavCollapsed: true,
        progressNavCollapsed: true,
        progressNavScrollTop: 0
    }
    if (snapshot.project) cached.project = snapshot.project
    if (snapshot.episode) {
        cached.episodes.delete(snapshot.episode.id)
        cached.episodes.set(snapshot.episode.id, snapshot.episode)
        if (cached.episodes.size > 8) cached.episodes.delete(cached.episodes.keys().next().value!)
        cached.lastEpisode = snapshot.episode
    }
    cached.characters = snapshot.characters
    cached.scenes = snapshot.scenes
    cached.globalNavCollapsed = snapshot.globalNavCollapsed
    cached.progressNavCollapsed = snapshot.progressNavCollapsed
    cached.progressNavScrollTop = snapshot.progressNavScrollTop
    episodeWorkspaceCache.set(projectId, cached)
}

async function fetchJson<T>(url: string, redirectIfUnavailable = true): Promise<ApiPayload<T>> {
    const res = await clientFetch(url)
    const text = await res.text()
    if (isUnavailablePageStatus(res.status)) {
        if (!redirectIfUnavailable) throw new PageUnavailableError()
        redirectToHomepage()
        throw new PageRedirectError()
    }
    if (!res.ok) throw new Error(`${url} ${res.status}: ${text.slice(0, 200)}`)
    const json = JSON.parse(text) as ApiPayload<T>
    if (json.success === false) throw new Error(json.error ?? `${url} failed`)
    return json
}

class PageUnavailableError extends Error {}

class PageRedirectError extends Error {
    constructor() {
        super('Redirecting to homepage')
        this.name = 'PageRedirectError'
    }
}

function isPageRedirectError(error: unknown): error is PageRedirectError {
    return error instanceof PageRedirectError
}

const STORYBOARD_JOB_POLL_STEPS = [1500, 3000, 5000, 8000, 12000, 20000]

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function getRetryDelayMs(res: Response, attempt: number) {
    const retryAfter = Number(res.headers.get('Retry-After'))
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
    return [2000, 4000, 8000][Math.min(attempt, 2)]
}

async function postStoryboardGenerateWithRetry(storyboardId: string, body: Record<string, unknown> & { type: StoryboardGenerationRequestType }, maxRetries = 3) {
    const endpoint = storyboardGenerationEndpoint(storyboardId, body.type)
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await clientFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            // 该流程会按 Retry-After 自动重试，并在重试/最终失败时给出专用提示。
            suppressRateLimitToast: true
        })
        if (res.ok || res.status !== 429 || attempt === maxRetries) return res
        const errorPayload = await res
            .clone()
            .json()
            .catch(() => null)
        if (errorPayload?.code === 'GENERATION_CONCURRENCY_LIMIT' || errorPayload?.code === 'GENERATION_QUEUE_FULL') return res
        if (attempt === 0) pushToast('info', '提交请求较多，系统正在自动重试。')
        await sleep(getRetryDelayMs(res, attempt))
    }
    throw new Error('生成请求重试失败')
}

function friendlyGenerateError(status: number, fallback: string) {
    if (status === 429) return '请求过于频繁，本次暂未进入生成队列。系统已自动重试，请稍后再次提交。'
    if (status === 502 || status === 503 || status === 504) {
        return '生成请求经过网关时中断，后台任务可能已经创建。页面正在自动刷新任务状态，请不要连续重复点击；若状态未变化，再点击一次重试。'
    }
    return fallback
}

async function fetchGenerationCapacity(category: GenerationCapacityCategory): Promise<GenerationCapacity> {
    const response = await clientFetch(`/api/generate/capacity?category=${category}`, { timeoutMs: 10_000, suppressRateLimitToast: true })
    const json = await readApiJson(response)
    if (!response.ok || !json.success) throw new Error(json.error ?? '服务暂时不可用，请稍后重试')
    return json.data as GenerationCapacity
}

function nextStoryboardPollInterval(attempt: number): number {
    return getPollingDelay({ baseMs: STORYBOARD_JOB_POLL_STEPS[Math.min(attempt, STORYBOARD_JOB_POLL_STEPS.length - 1)] })
}

interface StoryboardJobResult {
    episodeId: string
    count: number
    cancelled: boolean
}

async function pollStoryboardJob(jobId: string, timeoutMs = 35 * 60 * 1000): Promise<StoryboardJobResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    while (Date.now() < deadline) {
        const res = await clientFetch(`/api/ai/storyboard/status/${jobId}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? '轮询分镜任务失败')
        const data = json.data ?? {}
        if (data.phase === 'done') {
            if (!data.result) throw new Error('分镜任务已完成但未返回结果')
            return data.result as StoryboardJobResult
        }
        if (data.phase === 'cancelled') {
            return (data.result as StoryboardJobResult) ?? { episodeId: '', count: 0, cancelled: true }
        }
        if (data.phase === 'error') throw new Error(data.error ?? '分镜任务失败')
        await new Promise(r => setTimeout(r, nextStoryboardPollInterval(attempt++)))
    }
    throw new Error('等待分镜任务超时，请刷新查看后台进度')
}

type VideoReferenceMode = 'text' | 'single' | 'first_last'
const VIDEO_REFERENCE_MODES: Array<{ key: VideoReferenceMode; label: string; hint: string }> = [
    { key: 'text', label: '文生视频', hint: '只用镜头描述生成，适合没有参考图的试做' },
    { key: 'single', label: '首帧', hint: '使用第一张插图作为视频开场画面' },
    { key: 'first_last', label: '首尾帧', hint: '使用第一张和最后一张插图约束视频起点与终点，至少需要两张插图' }
]

type AutoGrowTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
    value: string
    minRows?: number
    maxRows?: number
}

function AutoGrowTextarea({ value, minRows = 2, maxRows, className, ...props }: AutoGrowTextareaProps) {
    const ref = useRef<HTMLTextAreaElement | null>(null)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        el.style.height = 'auto'
        const styles = window.getComputedStyle(el)
        const lineHeight = Number.parseFloat(styles.lineHeight) || 18
        const verticalChrome = el.offsetHeight - el.clientHeight
        const minHeight = lineHeight * minRows + verticalChrome
        const maxHeight = maxRows ? lineHeight * maxRows + verticalChrome : Number.POSITIVE_INFINITY
        const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)

        el.style.height = `${nextHeight}px`
        el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
    }, [value, minRows, maxRows])

    return (
        <textarea
            {...props}
            ref={ref}
            value={value}
            rows={minRows}
            className={`novel-scroll overflow-hidden resize-none [color-scheme:dark] ${className ?? ''}`}
        />
    )
}

function ShotSettingsField({ id, title, toolbar, children }: { id: string; title: string; toolbar?: ReactNode; children: ReactNode }) {
    const { t } = useI18n()
    return (
        <section
            aria-labelledby={`${id}-title`}
            className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3
                    id={`${id}-title`}
                    className="text-xs font-medium text-gray-300">
                    {t(title)}
                </h3>
                {toolbar && <div className="flex items-center gap-3">{toolbar}</div>}
            </div>
            {children}
        </section>
    )
}

function GenerationCapacityDialog({ category, message, onClose }: { category: GenerationCapacityCategory; message: string; onClose: () => void }) {
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', closeOnEscape)
        return () => document.removeEventListener('keydown', closeOnEscape)
    }, [onClose])

    const taskLabel = category === 'video' ? '视频' : '图片'

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/80 px-4 py-6 backdrop-blur-sm"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose()
            }}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="generation-capacity-title"
                aria-describedby="generation-capacity-message"
                className="relative w-full max-w-[480px] overflow-hidden rounded-2xl border border-purple-500/30 bg-gray-950 shadow-2xl shadow-black/70">
                <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-purple-500/20 via-purple-500/5 to-transparent" />
                <div className="relative p-6">
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-100 ring-1 ring-purple-500/30">
                            <Info className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">Generation capacity</div>
                            <h2
                                id="generation-capacity-title"
                                className="text-base font-semibold leading-snug text-white">
                                {taskLabel}生成任务已达上限
                            </h2>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="关闭"
                            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-white">
                            <CloseIcon className="h-4 w-4" />
                        </button>
                    </div>

                    <div
                        id="generation-capacity-message"
                        className="mt-5 rounded-xl border border-purple-500/20 bg-purple-500/10 px-4 py-3 text-sm leading-6 text-purple-100 shadow-inner shadow-black/10">
                        {message}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-gray-500">本次不会改变分镜状态，也不会提交生成请求。</p>

                    <button
                        type="button"
                        autoFocus
                        onClick={onClose}
                        className="mt-6 flex w-full items-center justify-center rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-950/50 transition-colors hover:bg-purple-500">
                        知道了
                    </button>
                </div>
            </div>
        </div>
    )
}

function EpisodeGenerationSettings({
    imageProvider,
    onImageProviderChange,
    savingImageProvider,
    videoProvider,
    onVideoProviderChange,
    savingVideoProvider,
    videoLanguage,
    onVideoLanguageChange,
    savingVideoLanguage,
    showEpisodeActions,
    hasStoryboards,
    canAddStoryboard,
    addingStoryboard,
    onAddStoryboard,
    canRegenerateStoryboards,
    hasGeneratedMedia,
    onRegenerateStoryboards,
    onRegenerateAll
}: {
    imageProvider: ImageProvider
    onImageProviderChange: (provider: ImageProvider) => void
    savingImageProvider: boolean
    videoProvider: ProductionVideoProvider
    onVideoProviderChange: (provider: ProductionVideoProvider) => void
    savingVideoProvider: boolean
    videoLanguage: VideoLanguage
    onVideoLanguageChange: (language: VideoLanguage) => void
    savingVideoLanguage: boolean
    showEpisodeActions: boolean
    hasStoryboards: boolean
    canAddStoryboard: boolean
    addingStoryboard: boolean
    onAddStoryboard: () => void | Promise<void>
    canRegenerateStoryboards: boolean
    hasGeneratedMedia: boolean
    onRegenerateStoryboards: () => void | Promise<void>
    onRegenerateAll: () => void | Promise<void>
}) {
    const { t } = useI18n()
    const [open, setOpen] = useState(false)

    return (
        <div
            className={`studio-generation-settings order-[40] ${open ? 'is-open' : ''}`}
            onKeyDown={event => {
                if (event.key === 'Escape') {
                    setOpen(false)
                    event.currentTarget.querySelector<HTMLButtonElement>('[data-settings-trigger]')?.focus()
                }
            }}>
            <button
                type="button"
                data-settings-trigger
                className="studio-secondary studio-episode-action"
                aria-label={t('生成设置')}
                title={t('生成设置')}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="episode-generation-settings"
                onClick={() => setOpen(value => !value)}>
                <Settings className="h-4 w-4" />
            </button>
            <button
                type="button"
                aria-label="关闭生成设置"
                className="fixed inset-0 z-30 cursor-default"
                hidden={!open}
                onClick={() => setOpen(false)}
            />
            <div
                id="episode-generation-settings"
                role="dialog"
                aria-label="生成设置"
                className="studio-settings-panel"
                hidden={!open}>
                <div className="studio-settings-heading text-sm font-semibold">生成设置</div>
                <div className="studio-settings-control">
                    <ModelSelect<ImageProvider>
                        value={imageProvider}
                        onChange={onImageProviderChange}
                        disabled={savingImageProvider}
                        label="图片"
                        title="全局默认图片生成模型，用于镜头插图和角色/场景参考图"
                        icon={<ImageIcon className="h-3.5 w-3.5 flex-shrink-0 text-purple-400" />}
                        options={[
                            { value: 'banana', label: 'Nano Banana', description: '适合角色与场景一致性、参考图生成' },
                            { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', description: 'Himodels Gemini Flash，支持参考图' },
                            { value: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite', description: 'Himodels Seedream 5.0 Lite，2K 文生图；不读取参考图' },
                            { value: 'qwen-image-3.0-pro', label: 'Qwen-Image-3.0-Pro', description: '阿里百炼图片模型，支持文生图和参考图' }
                        ]}
                    />
                </div>
                {SHOW_SHORT_DRAMA_VIDEO_MODEL_CONTROLS && (
                    <div className="studio-settings-control">
                        <ModelSelect<ProductionVideoProvider>
                            value={videoProvider}
                            onChange={onVideoProviderChange}
                            disabled={savingVideoProvider}
                            label="视频"
                            title="全局默认视频生成模型，所有新分镜和「一键生成」都用它"
                            icon={<Video className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />}
                            options={[
                                { value: 'seedance25', label: SEEDANCE_25_LABEL, description: '多模态参考与同步原声；支持 4-30 秒逐秒时长' },
                                { value: 'seedance', label: SEEDANCE_20_LABEL, description: 'Seedance 2.0，支持首尾帧和同步原声；时长档位 4/5/6/8/10/12/15 秒' },
                                { value: 'wan3', label: 'Wan 3.0', description: '阿里百炼 Wan 3.0，多模态参考与同步原声；最长 30 秒' },
                                { value: 'wan3prime', label: WAN_3_PRIME_LABEL, description: '阿里百炼 Wan 3.0 Prime，1080P、最长 30 秒、生成速度更快' },
                                { value: 'seedance-2.0-global', label: 'Seedance 2.0 Global', description: 'Himodels Seedance 2.0 文生视频与同步原声' },
                                { value: 'seedance-2.5-global', label: 'Seedance 2.5 Global', description: 'Himodels Seedance 2.5 文生视频与同步原声' },
                                { value: 'MiniMax-H3', label: 'MiniMax H3', description: 'Himodels 全模态参考、原生音频与多镜头，最高 2K / 15 秒' }
                            ]}
                        />
                    </div>
                )}
                <div
                    className="studio-settings-language flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800/60 p-1 whitespace-nowrap"
                    role="radiogroup"
                    aria-label="全局视频原声语言"
                    title="所有项目共用；控制支持原生音频的视频模型所生成的对白与口型语言">
                    <Languages className="mx-1 h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
                    <span className="hidden text-[10px] text-gray-400 xl:inline">{t('原声语言')}</span>
                    {(
                        [
                            { value: 'zh', label: '中文' },
                            { value: 'en', label: 'EN' }
                        ] as const
                    ).map(option => (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={videoLanguage === option.value}
                            disabled={savingVideoLanguage}
                            onClick={() => onVideoLanguageChange(option.value)}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                                videoLanguage === option.value ? 'bg-cyan-500/20 text-cyan-100 shadow-sm' : 'text-gray-500 hover:bg-gray-700 hover:text-gray-200'
                            }`}>
                            {option.label}
                        </button>
                    ))}
                </div>
                {showEpisodeActions && (
                    <div className="studio-settings-actions border-t border-white/[0.08] pt-3">
                        <div className="mb-2 text-xs font-medium text-slate-400">本集操作</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false)
                                    void onAddStoryboard()
                                }}
                                disabled={!canAddStoryboard || addingStoryboard}
                                className="flex items-start gap-2 rounded-lg border border-white/[0.08] px-3 py-2.5 text-start text-slate-200 transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-45">
                                {addingStoryboard ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Plus className="h-4 w-4 shrink-0" />}
                                <strong className="text-xs font-medium">{t('添加分镜')}</strong>
                            </button>
                            {hasStoryboards && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpen(false)
                                        void onRegenerateStoryboards()
                                    }}
                                    disabled={!canRegenerateStoryboards}
                                    className="flex items-start gap-2 rounded-lg border border-white/[0.08] px-3 py-2.5 text-start text-slate-200 transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-45">
                                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span className="grid gap-0.5">
                                        <strong className="text-xs font-medium">重新生成本集分镜</strong>
                                        <small className="text-[10px] text-slate-500">重新拆解当前剧本</small>
                                    </span>
                                </button>
                            )}
                            {hasGeneratedMedia && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpen(false)
                                        void onRegenerateAll()
                                    }}
                                    className="flex items-start gap-2 rounded-lg border border-rose-400/15 px-3 py-2.5 text-start text-rose-300 transition-colors hover:bg-rose-400/[0.06]">
                                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span className="grid gap-0.5">
                                        <strong className="text-xs font-medium">全部重新生成</strong>
                                        <small className="text-[10px] text-rose-200/55">清空插图和视频后重新计费</small>
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function EpisodePage() {
    const params = useParams<{ id: string; episodeId: string }>()
    const pathname = usePathname()
    // Native history updates usePathname, while useParams still describes the
    // last server navigation. Read the URL to support instant switches and Back/Forward.
    const route = episodeWorkspaceRoute(pathname) ?? { projectId: params.id, episodeId: params.episodeId }
    return (
        <EpisodeWorkspace
            key={`${route.projectId}:${route.episodeId}`}
            projectId={route.projectId}
            episodeId={route.episodeId}
        />
    )
}

function EpisodeWorkspace({ projectId, episodeId }: { projectId: string; episodeId: string }) {
    const { locale, t } = useI18n()
    const routeParamsValid = isValidRouteResourceId(projectId) && isValidRouteResourceId(episodeId)
    const cachedWorkspace = readEpisodeWorkspaceCache(projectId, episodeId)
    const [project, setProject] = useState<ProjectSlim | null>(() => cachedWorkspace?.project ?? null)
    const [episode, setEpisode] = useState<Episode | null>(() => cachedWorkspace?.episode ?? null)
    const [verifiedEpisodeId, setVerifiedEpisodeId] = useState<string | null>(null)
    const episodeFetchSequence = useRef(0)
    const episodePrefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const activeEpisodeId = useRef<string | null>(episodeId)
    useEffect(() => {
        activeEpisodeId.current = episodeId
        return () => {
            activeEpisodeId.current = null
            if (episodePrefetchTimer.current) clearTimeout(episodePrefetchTimer.current)
        }
    }, [episodeId])
    const [failedEpisodeLoadId, setFailedEpisodeLoadId] = useState<string | null>(null)
    const [characters, setCharacters] = useState<Character[]>(() => cachedWorkspace?.characters ?? [])
    const [scenes, setScenes] = useState<Scene[]>(() => cachedWorkspace?.scenes ?? [])
    const [activeTab, setActiveTab] = useState<EpisodeWorkspaceTab>('storyboard')
    // 分镜工作区优先留给内容，左侧导航默认收起；需要时可通过顶部按钮展开。
    const [globalNavCollapsed, setGlobalNavCollapsed] = useState(() => cachedWorkspace?.globalNavCollapsed ?? true)
    const [expandedShot, setExpandedShot] = useState<string | null>(null)
    const [scriptText, setScriptText] = useState('')
    const [savingScript, setSavingScript] = useState(false)
    const [merging, setMerging] = useState(false)
    const [progressNavCollapsed, setProgressNavCollapsed] = useState(() => cachedWorkspace?.progressNavCollapsed ?? true)
    const [generatingStoryboards, setGeneratingStoryboards] = useState(false)
    const [addingStoryboard, setAddingStoryboard] = useState(false)
    const [deletingStoryboardId, setDeletingStoryboardId] = useState<string | null>(null)
    const [aiMsg, setAiMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    // 桥接到右上角 toast，替代原来的行内红/绿卡片。
    useEffect(() => {
        if (!aiMsg) return
        pushToast(aiMsg.type, aiMsg.text)
    }, [aiMsg])
    const episodeLoaded = episode !== null
    useEffect(() => {
        let scrollFrame: number | undefined
        const syncTabFromHash = () => {
            const hash = window.location.hash
            const targetTab = episodeWorkspaceTabFromHash(hash)
            if (targetTab) setActiveTab(targetTab)
            if (/^#shot-\d+$/.test(hash)) {
                scrollFrame = window.requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }))
            }
        }
        const animationFrame = window.requestAnimationFrame(syncTabFromHash)
        window.addEventListener('hashchange', syncTabFromHash)
        return () => {
            window.cancelAnimationFrame(animationFrame)
            if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
            window.removeEventListener('hashchange', syncTabFromHash)
        }
    }, [episodeId, episodeLoaded])
    const [, setPollingIds] = useState<Set<string>>(new Set())
    const [batchGenIds, setBatchGenIds] = useState<Set<string>>(new Set())
    const [batchGenQueue, setBatchGenQueue] = useState<Set<string>>(new Set())
    const [batchRunning, setBatchRunning] = useState(false)
    const [batchDone, setBatchDone] = useState(0)
    const [batchTotal, setBatchTotal] = useState(0)
    const [batchFailed, setBatchFailed] = useState(0)
    const [showBatchModal, setShowBatchModal] = useState(false)
    const [episodeBatchRequestId, setEpisodeBatchRequestId] = useState(0)
    const [episodeBatchMode, setEpisodeBatchMode] = useState<'missing' | 'all'>('missing')
    const [episodeBatchShotStatuses, setEpisodeBatchShotStatuses] = useState<Record<string, EpisodeBatchShotStatus>>({})
    const [episodeBatchShotErrors, setEpisodeBatchShotErrors] = useState<Record<string, string>>({})
    const [episodeBatchShotFailureStages, setEpisodeBatchShotFailureStages] = useState<Record<string, EpisodeBatchFailureStage>>({})
    const [activeEpisodeBatchJobId, setActiveEpisodeBatchJobId] = useState<string | null>(null)
    const [globalVideoProvider, setGlobalVideoProvider] = useState<ProductionVideoProvider>(DEFAULT_VIDEO_PROVIDER)
    const [savingVideoProvider, setSavingVideoProvider] = useState(false)
    const [globalVideoLanguage, setGlobalVideoLanguage] = useState<VideoLanguage>('zh')
    const [savingVideoLanguage, setSavingVideoLanguage] = useState(false)
    const [globalImageProvider, setGlobalImageProvider] = useState<ImageProvider>('banana')
    const [savingImageProvider, setSavingImageProvider] = useState(false)
    const [globalImageQuality, setGlobalImageQuality] = useState<ImageQuality>('standard')
    const [batchComposing, setBatchComposing] = useState(false)
    const [batchComposeProgress, setBatchComposeProgress] = useState({ done: 0, total: 0, failed: 0 })
    const [batchComposeIds, setBatchComposeIds] = useState<Set<string>>(new Set())
    const [batchComposeRequestFailed, setBatchComposeRequestFailed] = useState(0)
    const [generationCapacityNotice, setGenerationCapacityNotice] = useState<{ category: GenerationCapacityCategory; message: string } | null>(null)
    // 轮询间隔小于接口响应时间时，禁止同一页面叠加多个完整刷新。
    // 否则 episode/characters/scenes 会并发堆积，网关容易返回 503/504。
    const fetchAllInFlight = useRef<{ id: string; promise: Promise<EpisodeRefreshResult> } | null>(null)
    const lastBatchEpisodeRefreshAt = useRef(0)
    const episodeStatusVersion = useRef(cachedWorkspace?.episode?.statusVersion)
    const episodeStatusDetailAt = useRef(0)
    const episodeStatusInFlight = useRef<{ id: string; promise: Promise<EpisodeStatusSnapshot | null> } | null>(null)
    const recoveredEpisodeBatchJobIds = useRef<Set<string>>(new Set())
    const cancelComposeQueueRef = useRef(false)
    const generationCapacityReservationsRef = useRef<GenerationCapacityReservations>(new Map())
    const watchedGenerationStagesRef = useRef<Set<string>>(new Set())
    const shownGenerationFailureKeysRef = useRef<Set<string>>(new Set())
    const generationFailureSnapshotRef = useRef<{ episodeId: string; storyboards: Storyboard[] } | null>(
        cachedWorkspace?.episode ? { episodeId: cachedWorkspace.episode.id, storyboards: cachedWorkspace.episode.storyboards } : null
    )
    const progressNavScrollTopRef = useRef(cachedWorkspace?.progressNavScrollTop ?? 0)
    const bindProgressNavScroll = useCallback((node: HTMLDivElement | null) => {
        if (node) node.scrollTop = progressNavScrollTopRef.current
    }, [])
    const { confirm, confirmDialog } = useConfirmDialog()

    const fetchProject = useCallback(async () => {
        const json = await fetchJson<ProjectSlim>(`/api/projects/${projectId}`)
        setProject(json.data)
        setCharacters(json.data.characters ?? [])
        setScenes(json.data.scenes ?? [])
    }, [projectId])

    const fetchEpisode = useCallback(
        async (navigation = false) => {
            if (activeEpisodeId.current !== episodeId) return
            const sequence = ++episodeFetchSequence.current
            const data = await (navigation ? episodeNavigationLoader.load(episodeId) : episodeNavigationLoader.refresh(episodeId))
            if (activeEpisodeId.current !== episodeId || sequence !== episodeFetchSequence.current) return
            episodeStatusVersion.current = data.statusVersion
            episodeStatusDetailAt.current = Date.now()
            setEpisode(data)
            setVerifiedEpisodeId(episodeId)
            setScriptText(data.script ?? '')
            setFailedEpisodeLoadId(null)
        },
        [episodeId]
    )

    const fetchAll = useCallback(
        async (navigation = false) => {
            if (fetchAllInFlight.current?.id === episodeId) return fetchAllInFlight.current.promise
            const request = (async () => {
                try {
                    // 轮询只需要更新本集任务状态；项目详情（尤其角色/场景长文本）只在项目切换时读取。
                    await fetchEpisode(navigation)
                    return 'success' as const
                } catch (err) {
                    if (activeEpisodeId.current !== episodeId) return 'transient-error' as const
                    if (err instanceof PageUnavailableError) {
                        redirectToHomepage()
                        return 'redirected' as const
                    }
                    if (isPageRedirectError(err)) return 'redirected' as const
                    // 页面切换、Fast Refresh 和请求期限都可能中止自动轮询。
                    // 这不是用户操作失败：保持当前数据并让轮询自动重试即可。
                    if (isRequestAbortError(err)) return 'transient-error' as const
                    const msg = err instanceof Error ? err.message : String(err)
                    console.error('[EpisodePage] fetchAll failed:', msg)
                    setFailedEpisodeLoadId(episodeId)
                    setAiMsg({ type: 'error', text: `页面数据刷新失败：${msg}` })
                    return 'error' as const
                } finally {
                    if (fetchAllInFlight.current?.id === episodeId) fetchAllInFlight.current = null
                }
            })()
            fetchAllInFlight.current = { id: episodeId, promise: request }
            return request
        },
        [episodeId, fetchEpisode]
    )

    const refreshEpisodeProgress = useCallback(async (): Promise<EpisodeStatusSnapshot | null> => {
        if (episodeStatusInFlight.current?.id === episodeId) return episodeStatusInFlight.current.promise
        const promise = (async () => {
            const response = await fetchJson<EpisodeStatusSnapshot>(`/api/episodes/${episodeId}/status`)
            if (activeEpisodeId.current !== episodeId) return null
            // Keep legacy stuck-task reconciliation alive even when no worker
            // remains to update the persisted status fingerprint.
            if (episodeStatusVersion.current !== response.data.version || Date.now() - episodeStatusDetailAt.current >= 120_000) await fetchAll()
            return response.data
        })()
        episodeStatusInFlight.current = { id: episodeId, promise }
        try {
            return await promise
        } finally {
            if (episodeStatusInFlight.current?.promise === promise) episodeStatusInFlight.current = null
        }
    }, [episodeId, fetchAll])

    useEffect(() => {
        if (!episode) return
        const previousSnapshot = generationFailureSnapshotRef.current
        if (previousSnapshot && previousSnapshot.episodeId !== episode.id) {
            watchedGenerationStagesRef.current.clear()
            shownGenerationFailureKeysRef.current.clear()
        }
        const previousStoryboards = previousSnapshot?.episodeId === episode.id ? previousSnapshot.storyboards : []
        const result = collectStoryboardGenerationFailureNotices({
            previous: previousStoryboards,
            current: episode.storyboards,
            watchedKeys: watchedGenerationStagesRef.current,
            shownFailureKeys: shownGenerationFailureKeysRef.current
        })
        generationFailureSnapshotRef.current = { episodeId: episode.id, storyboards: episode.storyboards }
        for (const watchKey of result.resolvedWatchKeys) watchedGenerationStagesRef.current.delete(watchKey)
        for (const notice of result.notices) shownGenerationFailureKeysRef.current.add(notice.failureKey)
        if (result.notices.length === 1) {
            pushToast('error', result.notices[0].message)
        } else if (result.notices.length > 1) {
            pushToast('error', `${result.notices[0].message}；另有 ${result.notices.length - 1} 个生成任务失败`)
        }
    }, [episode])

    useEffect(() => {
        rememberEpisodeWorkspace(projectId, {
            project,
            episode,
            characters,
            scenes,
            globalNavCollapsed,
            progressNavCollapsed,
            progressNavScrollTop: progressNavScrollTopRef.current
        })
    }, [characters, episode, globalNavCollapsed, progressNavCollapsed, project, projectId, scenes])

    function openEpisodeBatch(mode: 'missing' | 'all') {
        setEpisodeBatchRequestId(value => value + 1)
        setEpisodeBatchMode(mode)
        setEpisodeBatchShotStatuses({})
        setEpisodeBatchShotErrors({})
        setEpisodeBatchShotFailureStages({})
        setShowBatchModal(true)
    }

    function clearEpisodeGeneratedMediaInView() {
        setEpisode(current =>
            current
                ? {
                      ...current,
                      videoUrl: null,
                      merges: [],
                      storyboards: current.storyboards.map(storyboard => ({
                          ...storyboard,
                          firstFrameUrl: null,
                          lastFrameUrl: null,
                          plannedLastFrameUrl: null,
                          actualVideoEndFrameUrl: null,
                          videoUrl: null,
                          audioUrl: null,
                          composedVideoUrl: null,
                          frameStatus: 'pending',
                          videoStatus: 'pending',
                          composeStatus: 'pending',
                          expectedAudioMode: null,
                          compositionMode: null,
                          polishStatus: null,
                          illustrations: [],
                          latestErrors: {},
                          latestFrameRecovery: null,
                          latestVideoRequest: null,
                          latestKlingComparison: null,
                          latestSpeechComparisons: []
                      }))
                  }
                : current
        )
    }

    function clearEpisodeStoryboardsInView() {
        episodeFetchSequence.current += 1
        setEpisode(current =>
            current
                ? {
                      ...current,
                      status: 'storyboarding',
                      videoUrl: null,
                      merges: [],
                      storyboards: []
                  }
                : current
        )
        setProject(current =>
            current
                ? {
                      ...current,
                      episodes: current.episodes.map(item => (item.id === episodeId ? { ...item, status: 'storyboarding', _count: { ...item._count, storyboards: 0 } } : item))
                  }
                : current
        )
        setActiveEpisodeBatchJobId(null)
        setEpisodeBatchShotStatuses({})
        setEpisodeBatchShotErrors({})
        setEpisodeBatchShotFailureStages({})
    }

    async function regenerateEntireEpisode() {
        if (!episode) return
        const hasActiveTasks = episode.storyboards.some(storyboard => storyboard.frameStatus === 'generating' || storyboard.videoStatus === 'generating' || storyboard.composeStatus === 'processing')
        if (hasActiveTasks || activeEpisodeBatchJobId) {
            const ok = await confirm({
                title: '先暂停当前任务？',
                message: '本集仍有生成任务。继续后会先暂停这些任务，再清空已有素材并重新生成全部插图和视频。',
                confirmText: '暂停并继续',
                tone: 'warning'
            })
            if (!ok) return
            await cancelAllGenerating()
            await fetchAll()
        }
        const confirmed = await confirm({
            title: '重新生成全部插图和视频',
            message: `将先删除本集全部 ${episode.storyboards.length} 个分镜的现有插图、单镜视频与合成结果，以及整集合成视频；然后按当前选择的图片、视频模型从第一张插图开始重新生成并重新计费。此操作不可撤销且耗时较长。`,
            confirmText: '确认全部重新生成',
            tone: 'warning'
        })
        if (confirmed) openEpisodeBatch('all')
    }

    // 加载全局视频 provider 配置
    useEffect(() => {
        if (!routeParamsValid) {
            redirectToHomepage()
            return
        }
        clientFetch('/api/settings')
            .then(r => r.json())
            .then(j => {
                const rows: Array<{ provider: string; modelName?: string }> = j.data ?? []
                const video = rows.find(c => c.provider === 'video')
                if (SHOW_SHORT_DRAMA_VIDEO_MODEL_CONTROLS && isAvailableProductionVideoProvider(video?.modelName) && isGenerationModelVisible(video.modelName)) {
                    setGlobalVideoProvider(video.modelName)
                }
                setGlobalVideoLanguage(normalizeVideoLanguage(rows.find(c => c.provider === 'video_language')?.modelName))
                const image = rows.find(c => c.provider === 'image')
                if (isProductionImageProvider(image?.modelName)) {
                    setGlobalImageProvider(image.modelName)
                }
                const quality = rows.find(c => c.provider === 'image_quality')
                setGlobalImageQuality(normalizeImageQuality(quality?.modelName))
            })
            .catch(() => {})
    }, [routeParamsValid])

    async function changeGlobalVideoProvider(next: ProductionVideoProvider) {
        if (next === globalVideoProvider || savingVideoProvider) return
        const previous = globalVideoProvider
        setSavingVideoProvider(true)
        setGlobalVideoProvider(next)
        try {
            const response = await clientFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'video', modelName: next })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json?.success) throw new Error(json?.error ?? '视频生成模型保存失败')
            if (json.data?.provider !== 'video' || json.data?.modelName !== next) throw new Error('视频生成模型保存失败：服务端未确认新设置')
            pushToast('success', `视频生成模型已切换为 ${modelDisplayNameWithSource(next, t)}，后续生成生效`)
        } catch (error) {
            setGlobalVideoProvider(previous)
            pushToast('error', error instanceof Error ? error.message : '视频生成模型保存失败')
        } finally {
            setSavingVideoProvider(false)
        }
    }

    async function changeGlobalVideoLanguage(next: VideoLanguage) {
        if (next === globalVideoLanguage || savingVideoLanguage) return
        const previous = globalVideoLanguage
        setSavingVideoLanguage(true)
        setGlobalVideoLanguage(next)
        try {
            const response = await clientFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'video_language', modelName: next })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json?.success) throw new Error(json?.error ?? '视频原声语言保存失败')
            if (json.data?.provider !== 'video_language' || json.data?.modelName !== next) throw new Error('视频原声语言保存失败：服务端未确认新设置')
            pushToast('success', `视频原声已切换为${next === 'en' ? '英文' : '中文'}，后续生成生效`)
        } catch (error) {
            setGlobalVideoLanguage(previous)
            pushToast('error', error instanceof Error ? error.message : '视频原声语言保存失败')
        } finally {
            setSavingVideoLanguage(false)
        }
    }

    async function changeGlobalImageProvider(next: ImageProvider) {
        if (next === globalImageProvider || savingImageProvider) return
        const previous = globalImageProvider
        setSavingImageProvider(true)
        setGlobalImageProvider(next)
        try {
            const response = await clientFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'image', modelName: next })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '图片生成模型保存失败')
            if (json.data?.provider !== 'image' || json.data?.modelName !== next) throw new Error('图片生成模型保存失败：服务端未确认新设置')
            pushToast('success', '图片生成模型已保存，后续生成生效')
        } catch (error) {
            setGlobalImageProvider(previous)
            pushToast('error', error instanceof Error ? error.message : '图片生成模型保存失败')
        } finally {
            setSavingImageProvider(false)
        }
    }

    async function triggerBatchCompose(mode: 'missing' | 'all' = 'missing') {
        if (!episode) return
        const ready = episode.storyboards.filter(sb => {
            if (!sb.videoUrl) return false
            if (storyboardUsesEmbeddedVideoAudio(sb)) return false
            // 没有历史外部对白音轨时直接使用原始视频，不启动无意义的 FFmpeg 重编码。
            if (!sb.audioUrl) return false
            if (sb.composeStatus === 'processing') return false
            // missing 模式也扫描已完成成片：旧版本可能留下 0:00 文件，服务端会校验后
            // 直接跳过正常文件，只重新合成损坏文件。
            return true
        })
        if (ready.length === 0) {
            setAiMsg({
                type: 'error',
                text: '没有需要重新合成的历史镜头；无外部对白音轨时会直接使用原始视频'
            })
            return
        }
        if (mode === 'all') {
            const ok = await confirm({
                title: '重新合成分镜',
                message: `将重新合成全部 ${ready.length} 个分镜，旧的合成视频会被覆盖。`,
                confirmText: '重新合成',
                tone: 'warning'
            })
            if (!ok) return
        }
        setBatchComposing(true)
        setBatchComposeProgress({ done: 0, total: ready.length, failed: 0 })
        setBatchComposeIds(new Set())
        setBatchComposeRequestFailed(0)
        cancelComposeQueueRef.current = false
        setAiMsg(null)
        let accepted = 0
        let failed = 0
        let firstRequestError = ''
        const composeBatchSize = 5
        let queueStopped = false

        // 合成是 CPU/IO 密集型后台任务，不能因为接口返回 202 就继续启动全部镜头。
        // 每批最多 5 个，必须等这一批完成/失败后再发下一批。
        for (let offset = 0; offset < ready.length && !queueStopped && !cancelComposeQueueRef.current; offset += composeBatchSize) {
            const batch = ready.slice(offset, offset + composeBatchSize)
            const acceptedIds: string[] = []
            await Promise.all(
                batch.map(async sb => {
                    try {
                        const res = await clientFetch(`/api/storyboards/${sb.id}/compose`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ validateExisting: mode === 'missing' })
                        })
                        if (!res.ok) throw new Error(await res.text())
                        accepted++
                        acceptedIds.push(sb.id)
                        setBatchComposeIds(prev => new Set(prev).add(sb.id))
                    } catch (err) {
                        failed++
                        if (!firstRequestError) firstRequestError = err instanceof Error ? err.message : String(err)
                        setBatchComposeRequestFailed(failed)
                    }
                })
            )

            if (acceptedIds.length === 0) continue

            const batchDone = await waitForComposeBatch(acceptedIds)
            if (!batchDone || cancelComposeQueueRef.current) {
                queueStopped = true
                if (!cancelComposeQueueRef.current) setAiMsg({ type: 'error', text: `当前批次合成等待超时，已暂停后续任务。请稍后刷新重试。` })
            }
        }
        if (accepted === 0) {
            setBatchComposing(false)
            setBatchComposeProgress({ done: failed, total: ready.length, failed })
            setBatchComposeRequestFailed(0)
            setAiMsg({ type: 'error', text: `没有成功触发合成，${failed} 个分镜失败${firstRequestError ? `：${firstRequestError.slice(0, 180)}` : ''}` })
        } else if (failed > 0 && firstRequestError) {
            setAiMsg({ type: 'error', text: `已触发 ${accepted} 个分镜，${failed} 个请求失败：${firstRequestError.slice(0, 180)}` })
        }
        fetchAll()
    }

    async function waitForComposeBatch(ids: string[]): Promise<boolean> {
        const pending = new Set(ids)
        // 最多等待 20 分钟；期间只轮询本集状态，不再发送新的合成请求。
        for (let attempt = 0; attempt < 240 && pending.size > 0 && !cancelComposeQueueRef.current; attempt++) {
            try {
                const snapshot = await refreshEpisodeProgress()
                if (!snapshot) return false
                for (const sb of snapshot.storyboards) {
                    if (pending.has(sb.id) && (sb.composeStatus === 'completed' || sb.composeStatus === 'failed')) {
                        pending.delete(sb.id)
                    }
                }
            } catch {
                // GET 已有短重试；偶发 503/504 时继续等待，不提前启动下一批。
            }
            if (pending.size > 0) await sleep(8000)
        }
        return pending.size === 0 || cancelComposeQueueRef.current
    }

    const syncEpisodeBatchProgress = useCallback(
        (snapshot: { phase: EpisodeBatchPhase; shots: EpisodeBatchShot[] }) => {
            setEpisodeBatchShotStatuses(Object.fromEntries(snapshot.shots.map(shot => [shot.storyboardId, shot.status])))
            setEpisodeBatchShotErrors(Object.fromEntries(snapshot.shots.filter(shot => !!(shot.errorDetail || shot.errorMsg)).map(shot => [shot.storyboardId, (shot.errorDetail || shot.errorMsg)!])))
            setEpisodeBatchShotFailureStages(
                Object.fromEntries(
                    snapshot.shots
                        .map(shot => [shot.storyboardId, resolveEpisodeBatchFailureStage(shot)] as const)
                        .filter((entry): entry is readonly [string, EpisodeBatchFailureStage] => entry[1] !== undefined)
                )
            )
            // 弹窗和外层列表以同一次批次轮询为节拍；本地状态负责即时标签，
            // 服务端刷新负责补回新生成的图片 URL、错误和持久状态。
            if (snapshot.phase === 'running') {
                // Batch status is already polled by the modal. Refreshing the
                // full episode for every 5–8 second status update duplicates
                // large storyboard payloads, so only reconcile durable media
                // URLs/errors at a lower cadence.
                const now = Date.now()
                if (now - lastBatchEpisodeRefreshAt.current >= 20_000) {
                    lastBatchEpisodeRefreshAt.current = now
                    void refreshEpisodeProgress().catch(error => console.warn('[EpisodePage] status refresh failed', error))
                }
                return
            }
            setActiveEpisodeBatchJobId(null)
            lastBatchEpisodeRefreshAt.current = Date.now()
            void fetchAll().finally(() => {
                setEpisodeBatchShotStatuses({})
                setEpisodeBatchShotErrors({})
                setEpisodeBatchShotFailureStages({})
            })
        },
        [fetchAll, refreshEpisodeProgress]
    )

    const resumeInterruptedEpisodeBatch = useCallback(
        async (interruptedJobId: string) => {
            if (recoveredEpisodeBatchJobIds.current.has(interruptedJobId)) return false
            recoveredEpisodeBatchJobIds.current.add(interruptedJobId)
            const response = await clientFetch(`/api/episodes/${episodeId}/generate-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'missing',
                    imageProvider: globalImageProvider,
                    imageQuality: globalImageQuality,
                    videoProvider: globalVideoProvider
                })
            })
            const payload = (await response.json().catch(() => ({}))) as {
                success?: boolean
                error?: string
                data?: { jobId?: string; shots?: EpisodeBatchShot[] }
            }
            if (!response.ok || payload.success !== true) {
                throw new Error(payload.error || `自动续跑失败（HTTP ${response.status}）`)
            }
            const resumedJobId = String(payload.data?.jobId ?? '')
            if (!resumedJobId) throw new Error('自动续跑未返回任务 ID')
            const resumedShots = Array.isArray(payload.data?.shots) ? payload.data.shots : []
            setActiveEpisodeBatchJobId(resumedJobId)
            if (resumedShots.length > 0) {
                setEpisodeBatchShotStatuses(Object.fromEntries(resumedShots.map(shot => [shot.storyboardId, shot.status])))
                setEpisodeBatchShotErrors({})
                setEpisodeBatchShotFailureStages({})
            }
            pushToast('info', '生成服务刚刚发布或重启，已自动继续未完成镜头。')
            return true
        },
        [episodeId, globalImageProvider, globalImageQuality, globalVideoProvider]
    )

    // 弹窗关闭为“后台运行”，不能停止状态同步。父页面继续轮询同一批次，
    // 因此外层列表在弹窗开关前后都显示完全相同的排队/插图/视频状态。
    useEffect(() => {
        if (!activeEpisodeBatchJobId) return
        // 弹窗开启时由弹窗轮询并通过 onProgress 同步，避免重复请求状态接口。
        if (showBatchModal) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let consecutiveFailures = 0
        const poll = async () => {
            try {
                const response = await fetchJson<{ phase: EpisodeBatchPhase; shots: EpisodeBatchShot[]; errorMsg?: string }>(
                    `/api/episodes/${episodeId}/generate-all/status/${activeEpisodeBatchJobId}?view=progress`
                )
                if (cancelled) return
                if (isEpisodeBatchExecutorInterrupted(response.data)) {
                    try {
                        if (await resumeInterruptedEpisodeBatch(activeEpisodeBatchJobId)) return
                    } catch (recoveryError) {
                        console.error('[EpisodePage] interrupted batch auto-resume failed:', recoveryError)
                    }
                }
                syncEpisodeBatchProgress(response.data)
                consecutiveFailures = 0
                if (response.data.phase === 'running') timer = setTimeout(poll, getPollingDelay({ baseMs: 10_000, failureCount: consecutiveFailures }))
            } catch (error) {
                if (!cancelled) {
                    console.error('[EpisodePage] batch status refresh failed:', error)
                    consecutiveFailures += 1
                    timer = setTimeout(poll, getPollingDelay({ baseMs: 10_000, failureCount: consecutiveFailures }))
                }
            }
        }
        void poll()
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }, [activeEpisodeBatchJobId, episodeId, resumeInterruptedEpisodeBatch, showBatchModal, syncEpisodeBatchProgress])

    function applyStoryboardCompletion(result: StoryboardJobResult) {
        if (result.cancelled || !result.episodeId || result.count <= 0) return
        setProject(previous =>
            previous
                ? {
                      ...previous,
                      episodes: previous.episodes.map(item =>
                          item.id === result.episodeId
                              ? {
                                    ...item,
                                    status: 'storyboarded',
                                    _count: { storyboards: Math.max(item._count.storyboards, result.count) }
                                }
                              : item
                      )
                  }
                : previous
        )
        if (result.episodeId === episodeId && activeEpisodeId.current === episodeId) {
            // 每集完成就读取已保存的分镜；不能只改状态后等整个批次结束再刷新。
            // 直接发起新请求，使生成完成前的在途响应失效，也不阻塞下一集生成。
            void fetchEpisode().catch(error => {
                if (activeEpisodeId.current !== episodeId || isPageRedirectError(error) || isRequestAbortError(error)) return
                const message = error instanceof Error ? error.message : String(error)
                setAiMsg({ type: 'error', text: `页面数据刷新失败：${message}` })
            })
        }
    }

    async function refreshStoryboardWorkspace() {
        const [projectResult, episodeResult] = await Promise.allSettled([fetchProject(), fetchEpisode()])
        if (projectResult.status === 'rejected') console.error('[EpisodePage] project summary refresh failed after storyboard generation:', projectResult.reason)
        if (episodeResult.status === 'rejected') console.error('[EpisodePage] episode refresh failed after storyboard generation:', episodeResult.reason)
    }

    // 切换集时重置集相关的本地状态，避免旧集状态污染新集 UI
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExpandedShot(null)
        setGeneratingStoryboards(false)
        setAiMsg(null)
    }, [episodeId])

    useEffect(() => {
        if (!routeParamsValid) {
            redirectToHomepage()
            return
        }
        let cancelled = false
        let retryTimer: ReturnType<typeof setTimeout> | null = null
        let transientFailures = 0
        // 项目切换时同步加载角色/场景；错误通过 toast 告知用户。
        const load = async () => {
            try {
                await fetchProject()
            } catch (err) {
                if (cancelled || isPageRedirectError(err)) return
                if (isRequestAbortError(err)) {
                    transientFailures += 1
                    retryTimer = setTimeout(load, getPollingDelay({ baseMs: 1_500, failureCount: transientFailures - 1, maxMs: 12_000 }))
                    return
                }
                const msg = err instanceof Error ? err.message : String(err)
                setAiMsg({ type: 'error', text: `项目数据加载失败：${msg}` })
            }
        }
        void load()
        return () => {
            cancelled = true
            if (retryTimer) clearTimeout(retryTimer)
        }
    }, [fetchProject, routeParamsValid])

    useEffect(() => {
        if (!routeParamsValid) return
        let cancelled = false
        let retryTimer: ReturnType<typeof setTimeout> | null = null
        let transientFailures = 0
        const load = async () => {
            const result = await fetchAll(true)
            if (cancelled || result !== 'transient-error') return
            transientFailures += 1
            retryTimer = setTimeout(load, getPollingDelay({ baseMs: 1_500, failureCount: transientFailures - 1, maxMs: 12_000 }))
        }
        void load()
        return () => {
            cancelled = true
            if (retryTimer) clearTimeout(retryTimer)
        }
    }, [fetchAll, routeParamsValid])

    useEffect(() => {
        if (!project || verifiedEpisodeId !== episodeId || document.visibilityState !== 'visible') return
        let cancelled = false
        // Warm only the next and previous episode, sequentially, after the current
        // workspace is ready. Hover/click shares these requests through the loader.
        const timer = setTimeout(async () => {
            for (const id of neighbouringEpisodeIds(project.episodes, episodeId)) {
                if (cancelled || document.visibilityState !== 'visible') return
                try {
                    await episodeNavigationLoader.prefetch(id)
                } catch {
                    // Speculative failures must not interrupt the current episode.
                }
            }
        }, 250)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [episodeId, project, verifiedEpisodeId])

    const episodeMatchesProject = !project || !episode || project.episodes.some(item => item.id === episode.id)
    useEffect(() => {
        if (project && episode && !episodeMatchesProject) redirectToHomepage()
    }, [episode, episodeMatchesProject, project])

    // 轮询有生成任务在进行的分镜，以及合并进行中。批次弹窗打开时由它的
    // 专用状态接口驱动进度，避免同一页面再并发拉取整集详情。
    useEffect(() => {
        if (!episode) return
        if (activeEpisodeBatchJobId && showBatchModal) return
        const merging = episode.merges[0]?.status === 'processing'
        const inProgress = episode.storyboards.filter(sb => sb.frameStatus === 'generating' || sb.videoStatus === 'generating' || sb.composeStatus === 'processing')
        if (episode.status !== 'storyboarding' && inProgress.length === 0 && !merging) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let failures = 0
        const refresh = async () => {
            try {
                await refreshEpisodeProgress()
                failures = 0
            } catch {
                failures += 1
            }
            if (cancelled) return
            const baseMs = episode.status === 'storyboarding' || merging ? 10_000 : 12_000
            // A cancelled/expired status request should be retried promptly and
            // silently. The durable server state remains authoritative meanwhile.
            timer = setTimeout(refresh, getPollingDelay({ baseMs, failureCount: failures, jitterRatio: 0.15 }))
        }
        timer = setTimeout(refresh, getPollingDelay({ baseMs: episode.status === 'storyboarding' || merging ? 10_000 : 12_000 }))
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }, [activeEpisodeBatchJobId, episode, refreshEpisodeProgress, showBatchModal])

    // 批量合成是后台任务，按分镜真实 composeStatus 统计进度，而不是按请求发送数统计。
    useEffect(() => {
        if (!batchComposing || !episode || batchComposeProgress.total === 0) return
        const tracked = episode.storyboards.filter(sb => batchComposeIds.has(sb.id))
        const completed = tracked.filter(sb => sb.composeStatus === 'completed').length
        const processing = tracked.filter(sb => sb.composeStatus === 'processing').length
        const statusFailed = tracked.filter(sb => sb.composeStatus === 'failed').length
        const failed = batchComposeRequestFailed + statusFailed
        const done = completed + statusFailed + batchComposeRequestFailed
        const firstComposeError = tracked.find(sb => sb.composeStatus === 'failed')?.latestErrors?.compose?.errorMsg
        // 这里是把后台任务状态同步到按钮进度，不是由 effect 驱动业务请求。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBatchComposeProgress(prev => (prev.done === done && prev.failed === failed ? prev : { ...prev, done, failed }))

        if (done >= batchComposeProgress.total && processing === 0) {
            setBatchComposing(false)
            setAiMsg({
                type: failed === 0 ? 'success' : 'error',
                text: failed === 0 ? `合成完成：${completed} 个分镜` : `合成完成：${completed} 个成功，${failed} 个失败${firstComposeError ? `：${firstComposeError.slice(0, 160)}` : ''}`
            })
            setTimeout(() => {
                setBatchComposeProgress({ done: 0, total: 0, failed: 0 })
                setBatchComposeIds(new Set())
                setBatchComposeRequestFailed(0)
            }, 1500)
        }
    }, [episode, batchComposing, batchComposeIds, batchComposeProgress, batchComposeRequestFailed])

    async function saveScript() {
        setSavingScript(true)
        try {
            const res = await clientFetch(`/api/episodes/${episodeId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ script: scriptText, expectedSourceVersion: episode?.sourceVersion })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '保存剧本失败')
            const requestedScript = scriptText.trim() || null
            if ((json.data?.script ?? null) !== requestedScript) throw new Error('保存剧本失败：服务端未保存完整内容')
            await fetchEpisode()
            setAiMsg({ type: 'success', text: '剧本已保存' })
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '保存剧本失败' })
        } finally {
            setSavingScript(false)
        }
    }

    async function addStoryboard() {
        if (!episode || addingStoryboard || isStoryboarding) return
        setAddingStoryboard(true)
        try {
            // 删除中间一镜后 order 会有空缺，不能使用剩余数量作为新序号。
            const order = episode.storyboards.reduce((maximum, storyboard) => Math.max(maximum, storyboard.order), 0) + 1
            const res = await clientFetch(`/api/episodes/${episodeId}/storyboards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storyboards: [
                        {
                            order,
                            shotType: 'medium',
                            duration: 5
                        }
                    ]
                })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? t('添加分镜失败'))
            await refreshStoryboardWorkspace()
            const createdId = json.data?.[0]?.id
            if (typeof createdId === 'string') {
                setExpandedShot(createdId)
                requestAnimationFrame(() => document.getElementById(`shot-${createdId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
            }
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : t('添加分镜失败') })
        } finally {
            setAddingStoryboard(false)
        }
    }

    async function deleteStoryboard(storyboard: Storyboard) {
        if (deletingStoryboardId) return
        setDeletingStoryboardId(storyboard.id)
        try {
            const ok = await confirm({
                title: t('删除分镜'),
                message: t('将删除该分镜及其插图、视频和合成结果，并停止相关生成任务；依赖它的连续镜头和本集成片需要重新生成。'),
                confirmText: '删除',
                tone: 'danger'
            })
            if (!ok) return
            const res = await clientFetch(`/api/storyboards/${storyboard.id}`, { method: 'DELETE' })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? t('删除分镜失败'))
            setEpisode(previous => (previous?.id === episodeId ? { ...previous, storyboards: previous.storyboards.filter(item => item.id !== storyboard.id) } : previous))
            setExpandedShot(previous => (previous === storyboard.id ? null : previous))
            await refreshStoryboardWorkspace()
            setAiMsg({ type: 'success', text: t('分镜已删除') })
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : t('删除分镜失败') })
        } finally {
            setDeletingStoryboardId(null)
        }
    }

    async function aiGenerateStoryboards() {
        const hasStoryboards = storyboards.length > 0
        const entityWarning =
            characters.length === 0 && scenes.length === 0
                ? '项目还没有角色库和场景库。建议先回到「小说 → 拆剧本 / 提取」点击「提取角色和场景」，确认后再生成分镜；否则本集分镜会缺少角色/场景绑定，后续参考图一致性会很差。'
                : null
        const ok = await confirm({
            title: entityWarning ? '缺少角色/场景库' : hasStoryboards ? '重新生成本集分镜' : 'AI 生成本集分镜',
            message: [
                entityWarning,
                hasStoryboards
                    ? '提交后会立即停止本集旧任务，并清空旧分镜、插图、视频和合成结果，再根据本集剧本生成全新分镜。'
                    : '将根据本集剧本自动生成分镜。生成后你仍然可以继续编辑镜头、台词、角色和场景。'
            ]
                .filter(Boolean)
                .join('\n\n'),
            confirmText: entityWarning ? '仍然生成' : hasStoryboards ? '重新生成' : '开始生成',
            tone: entityWarning || hasStoryboards ? 'warning' : 'default'
        })
        if (!ok) return
        setGeneratingStoryboards(true)
        setAiMsg(null)
        try {
            const res = await clientFetch('/api/ai/storyboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    buildStoryboardGenerationRequest({
                        episodeId,
                        videoProvider: globalVideoProvider,
                        mode: hasStoryboards ? 'overwrite' : 'missing'
                    })
                )
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            const jobId = json.data?.jobId as string | undefined
            if (!jobId) throw new Error('分镜任务未返回 jobId')
            if (hasStoryboards) clearEpisodeStoryboardsInView()
            setActiveTab('storyboard')
            const result = await pollStoryboardJob(jobId)
            if (!result.cancelled) {
                applyStoryboardCompletion(result)
                setAiMsg({ type: 'success', text: `已生成 ${result.count} 个分镜` })
            }
            await refreshStoryboardWorkspace()
        } catch (e) {
            setAiMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setGeneratingStoryboards(false)
        }
    }

    async function cancelAiStoryboard() {
        await clientFetch('/api/ai/storyboard', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId })
        })
        setGeneratingStoryboards(false)
        fetchAll()
    }

    async function updateStoryboard(id: string, data: Partial<Storyboard> & { characterIds?: string[] }): Promise<boolean> {
        try {
            const response = await clientFetch(`/api/storyboards/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '分镜保存失败')
            const persisted = json.data as Record<string, unknown> | undefined
            const missingField = Object.entries(data).find(([key, requested]) => {
                const stored = persisted?.[key]
                // Deleting an endpoint frame can intentionally promote a
                // middle frame into its place, so null is an action here rather
                // than the expected final field value.
                if (key === 'firstFrameUrl' || key === 'lastFrameUrl' || key === 'plannedLastFrameUrl') return false
                if (key === 'characterIds') {
                    const requestedIds = Array.isArray(requested) ? requested.map(String).sort() : []
                    const storedIds = Array.isArray(stored) ? stored.map(String).sort() : []
                    return JSON.stringify(storedIds) !== JSON.stringify(requestedIds)
                }
                if (key === 'sceneId') return (stored === null || stored === undefined || stored === '' ? null : String(stored)) !== (requested ? String(requested) : null)
                if (typeof requested === 'string') return (typeof stored === 'string' ? stored.trim() || null : (stored ?? null)) !== (requested.trim() || null)
                return (stored ?? null) !== (requested ?? null)
            })
            if (missingField) throw new Error(`分镜保存失败：服务端未保存字段 ${missingField[0]}`)
            await fetchAll()
            return true
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '分镜保存失败' })
            return false
        }
    }

    function generationCapacityReservationId(sbId: string, category: GenerationCapacityCategory) {
        return `${sbId}:${category}`
    }

    function releaseGenerationCapacity(sbId: string, category: GenerationCapacityCategory) {
        releaseGenerationCapacityReservation(generationCapacityReservationsRef.current, generationCapacityReservationId(sbId, category))
    }

    function showGenerationCapacityNotice(category: GenerationCapacityCategory, message?: string | null) {
        setGenerationCapacityNotice({
            category,
            message: t(
                message ??
                    (category === 'image' ? '当前账号最多同时处理 15 个图片生成任务，请等待正在处理的图片完成后再试。' : '当前账号最多同时处理 10 个视频生成任务，请等待正在处理的视频完成后再试。')
            )
        })
    }

    async function checkGenerationCapacity(sbId: string, category: GenerationCapacityCategory, units = 1) {
        try {
            const capacity = await fetchGenerationCapacity(category)
            const reserved = tryReserveGenerationCapacity({
                reservations: generationCapacityReservationsRef.current,
                reservationId: generationCapacityReservationId(sbId, category),
                category,
                capacity,
                units
            })
            if (reserved) return true
            showGenerationCapacityNotice(category, capacity.message)
            return false
        } catch (error) {
            pushToast('error', t(error instanceof Error ? error.message : '服务暂时不可用，请稍后重试'))
            return false
        }
    }

    async function triggerGenerate(
        sbId: string,
        type: StoryboardGenerationRequestType,
        provider?: string,
        referenceMode?: VideoReferenceMode,
        imageProvider?: ImageProvider,
        imageQuality?: ImageQuality,
        illustrationCount?: number
    ) {
        setPollingIds(prev => new Set(prev).add(sbId))
        const feedbackStage = generationFeedbackStageForRequest(type)
        // Automatic submission retries reuse this id. A later button click gets
        // a different id, so it cannot resume an older image/video task.
        const requestId = crypto.randomUUID()
        try {
            const res = await postStoryboardGenerateWithRetry(sbId, {
                type,
                requestId,
                ...(type === 'video' ? { provider: provider ?? DEFAULT_VIDEO_PROVIDER } : {}),
                referenceMode,
                imageProvider,
                imageQuality,
                illustrationCount
            })
            if (!res.ok) {
                const json = await res.json().catch(() => null)
                const text = res.status === 429 && typeof json?.error === 'string' ? json.error : friendlyGenerateError(res.status, `生成请求失败：${json?.error ?? res.statusText}`)
                const capacityCategory: GenerationCapacityCategory = json?.category === 'image' || json?.category === 'video' ? json.category : type === 'video' ? 'video' : 'image'
                const capacityRejected = res.status === 429 && (json?.code === 'GENERATION_CONCURRENCY_LIMIT' || json?.code === 'GENERATION_QUEUE_FULL' || /最多同时处理/.test(text))
                if (capacityRejected) showGenerationCapacityNotice(capacityCategory, text)
                else if (res.status === 429) pushToast('info', text)
                else pushToast('error', text)
            } else {
                const json = await res.json().catch(() => null)
                if (feedbackStage) watchedGenerationStagesRef.current.add(generationFeedbackWatchKey(sbId, feedbackStage))
                if (json?.data?.duplicate) {
                    const taskLabel = type === 'video' ? '视频' : '图片'
                    pushToast('info', `这个分镜已有${taskLabel}任务在排队或生成中，已继续跟踪原任务，不会重复提交。`)
                } else if (json?.data?.queued) {
                    const taskLabel = type === 'video' ? '视频' : '图片'
                    const projectMax = Number(json.data.concurrency?.projectMaxConcurrent) || (type === 'video' ? 20 : 30)
                    const userMax = Number(json.data.concurrency?.userMaxConcurrent) || (type === 'video' ? 20 : 30)
                    pushToast('info', t('本任务已排队：单作品最多同时 {projectMax} 个{task}任务，当前账号总计最多 {userMax} 个；有空闲名额后会自动开始。', { projectMax, task: t(taskLabel), userMax }))
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            pushToast('error', `生成请求失败：${message}`)
        }
        // 保持镜头按钮的本地“生成中”状态，直到服务端状态刷新完成；
        // 否则请求返回与轮询更新之间会短暂恢复成旧的失败红色。
        await fetchAll()
    }

    async function cancelGenerate(sbId: string, target: 'frame' | 'video' | 'compose' | 'all' = 'frame') {
        const stages = target === 'all' ? (['frame', 'video'] as const) : target === 'compose' ? [] : [target]
        for (const stage of stages) watchedGenerationStagesRef.current.delete(generationFeedbackWatchKey(sbId, stage))
        await clientFetch(`/api/storyboards/${sbId}/generate/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target })
        })
        fetchAll()
    }

    async function regenerateMiddleFrame(sbId: string, frameId: string, provider?: string, imageProvider?: ImageProvider, imageQuality?: ImageQuality) {
        setPollingIds(prev => new Set(prev).add(sbId))
        await clientFetch(`/api/storyboards/${sbId}/middle-frames/${frameId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: provider ?? DEFAULT_VIDEO_PROVIDER, imageProvider, imageQuality })
        })
        fetchAll()
    }

    async function deleteMiddleFrame(sbId: string, frame: Illustration) {
        const ok = await confirm({
            title: `删除${frame.label}`,
            message: '删除后，该分镜已生成的视频和合成结果会失效，需要重新生成视频。',
            confirmText: '删除',
            tone: 'danger'
        })
        if (!ok) return
        await clientFetch(`/api/storyboards/${sbId}/middle-frames/${frame.id}`, { method: 'DELETE' })
        fetchAll()
    }

    async function deleteFrame(sbId: string, frame: Illustration) {
        const ok = await confirm({
            title: `删除${frame.label}`,
            message: '删除后，该分镜已生成的视频和合成结果会失效，需要重新生成。',
            confirmText: '删除',
            tone: 'danger'
        })
        if (!ok) return
        const field = frame.type === 'first_frame' ? 'firstFrameUrl' : 'plannedLastFrameUrl'
        await updateStoryboard(sbId, { [field]: null })
    }

    async function cancelAllGenerating() {
        const active = storyboards.filter(sb => sb.frameStatus === 'generating' || sb.videoStatus === 'generating' || sb.composeStatus === 'processing')
        if (active.length === 0 && !activeEpisodeBatchJobId) return
        cancelComposeQueueRef.current = true
        let storyboardFailed = 0
        let batchCancelFailed = false
        let firstError = ''
        try {
            const batchResponse = await clientFetch(`/api/episodes/${episodeId}/generate-all/cancel`, { method: 'POST' })
            if (!batchResponse.ok) throw new Error(await batchResponse.text())
        } catch (err) {
            batchCancelFailed = true
            firstError = err instanceof Error ? err.message : String(err)
        }
        // 取消同样走批量限流，最多同时请求 5 个，避免暂停操作本身压垮 API。
        for (let offset = 0; offset < active.length; offset += 5) {
            const batch = active.slice(offset, offset + 5)
            await Promise.all(
                batch.map(async sb => {
                    try {
                        const res = await clientFetch(`/api/storyboards/${sb.id}/generate/cancel`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ target: 'all' })
                        })
                        if (!res.ok) throw new Error(await res.text())
                    } catch (err) {
                        storyboardFailed++
                        if (!firstError) firstError = err instanceof Error ? err.message : String(err)
                    }
                })
            )
            if (offset + 5 < active.length) await sleep(250)
        }
        const failed = storyboardFailed + (batchCancelFailed ? 1 : 0)
        setAiMsg(
            failed === 0
                ? { type: 'success', text: `已暂停 ${active.length} 个任务` }
                : {
                      type: 'error',
                      text: `已暂停 ${active.length - storyboardFailed} 个分镜任务，${failed} 项暂停失败：${firstError.slice(0, 180)}`
                  }
        )
        fetchAll()
    }

    async function triggerCompose(sbId: string) {
        // 乐观更新：接口需要创建 generation 记录，数据库慢时也要立即给用户反馈。
        setEpisode(prev =>
            prev
                ? {
                      ...prev,
                      storyboards: prev.storyboards.map(sb => (sb.id === sbId ? { ...sb, composeStatus: 'processing' } : sb))
                  }
                : prev
        )
        try {
            const res = await clientFetch(`/api/storyboards/${sbId}/compose`, { method: 'POST' })
            if (!res.ok) {
                const body = await res.text()
                throw new Error(body || `合成请求失败（HTTP ${res.status}）`)
            }
            fetchAll()
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setEpisode(prev =>
                prev
                    ? {
                          ...prev,
                          storyboards: prev.storyboards.map(sb => (sb.id === sbId ? { ...sb, composeStatus: 'failed' } : sb))
                      }
                    : prev
            )
            setAiMsg({ type: 'error', text: `合成请求失败：${message.slice(0, 220)}` })
        }
    }

    async function readEpisodeForMerge() {
        const result = await fetchJson<Episode>(`/api/episodes/${episodeId}`)
        setEpisode(result.data)
        return result.data
    }

    async function triggerMerge() {
        setMerging(true)
        try {
            const latestEpisode = await readEpisodeForMerge()
            const incompleteVideos = latestEpisode.storyboards.filter(
                storyboard => !storyboard.videoUrl || storyboard.videoStatus !== 'completed' || (!!storyboard.latestVideoRequest && storyboard.latestVideoRequest.status !== 'completed')
            )
            if (incompleteVideos.length > 0) throw new Error(`还有 ${incompleteVideos.length} 个分镜视频未完成，完成后才能合并`)

            const needsRegeneration = latestEpisode.storyboards.filter(storyboardNeedsVideoAudioRegeneration)
            if (needsRegeneration.length > 0) {
                setActiveTab('storyboard')
                setExpandedShot(needsRegeneration[0].id)
                throw new Error(`${t('分镜')} ${needsRegeneration.map(storyboard => storyboard.order).join('、')}：${t('请重新生成带原声的视频，完成后再合并。')}`)
            }

            const res = await clientFetch(`/api/episodes/${episodeId}/merge`, { method: 'POST' })
            if (!res.ok) {
                const body = await res.json().catch(() => null)
                throw new Error(typeof body?.error === 'string' ? body.error : `合并请求失败（HTTP ${res.status}）`)
            }
            fetchAll()
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setAiMsg({ type: 'error', text: `合并失败：${message.slice(0, 240)}` })
        } finally {
            setMerging(false)
        }
    }

    async function batchGenerateStoryboards(mode: 'missing' | 'all') {
        if (!project) return
        const candidates = project.episodes.filter(episode => shouldGenerateEpisodeStoryboards(episode, mode)).sort((left, right) => left.episodeNumber - right.episodeNumber)
        if (candidates.length === 0) {
            setAiMsg({ type: 'error', text: mode === 'missing' ? '所有已拆剧本的集都已分镜' : '没有可分镜的集（需先拆剧本）' })
            return
        }
        if ((project.characters?.length ?? 0) === 0 && (project.scenes?.length ?? 0) === 0) {
            const ok = await confirm({
                title: '缺少角色/场景库',
                message: '项目还没有角色库和场景库。建议先回到「小说 → 拆剧本 / 提取」点击「提取角色和场景」，确认后再批量生成分镜；否则所有分镜都会缺少角色/场景绑定。',
                confirmText: '仍然批量生成',
                tone: 'warning'
            })
            if (!ok) return
        }
        if (mode === 'all') {
            const ok = await confirm({
                title: '重新生成全部分镜',
                message: `将重新生成全部 ${candidates.length} 集的分镜，旧分镜会被清除。`,
                confirmText: '重新生成',
                tone: 'warning'
            })
            if (!ok) return
        }

        setAiMsg(null)
        setBatchGenQueue(new Set(candidates.map(e => e.id)))
        setBatchTotal(candidates.length)
        setBatchDone(0)
        setBatchFailed(0)
        setBatchRunning(true)

        const failed: Array<{ num: number; msg: string }> = []
        let completed = 0
        try {
            // 后一集的提示词读取前一集已保存的结尾分镜，必须等待整个 job 完成。
            for (const ep of candidates) {
                setBatchGenQueue(prev => {
                    const n = new Set(prev)
                    n.delete(ep.id)
                    return n
                })
                setBatchGenIds(prev => {
                    const n = new Set(prev)
                    n.add(ep.id)
                    return n
                })
                try {
                    const res = await clientFetch(`/api/ai/storyboard`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(
                            buildStoryboardGenerationRequest({
                                episodeId: ep.id,
                                videoProvider: globalVideoProvider,
                                mode: mode === 'all' ? 'overwrite' : 'missing'
                            })
                        )
                    })
                    const json = await res.json()
                    const skippedExisting = !json.success && mode === 'missing' && json.code === 'STORYBOARDS_ALREADY_EXIST'
                    if (skippedExisting) {
                        applyStoryboardCompletion({
                            episodeId: ep.id,
                            count: Math.max(ep._count.storyboards, Number(json.storyboardCount) || 1),
                            cancelled: false
                        })
                    } else {
                        if (!json.success) throw new Error(json.error)
                        const jobId = json.data?.jobId as string | undefined
                        if (!jobId) throw new Error('分镜任务未返回 jobId')
                        const result = await pollStoryboardJob(jobId)
                        if (result.cancelled) {
                            setAiMsg({ type: 'error', text: '已取消' })
                            return
                        }
                        if (result.episodeId !== ep.id || result.count <= 0) throw new Error('分镜任务已完成但未返回结果')
                        applyStoryboardCompletion(result)
                    }
                } catch (e) {
                    failed.push({ num: ep.episodeNumber, msg: e instanceof Error ? e.message : String(e) })
                    setBatchFailed(f => f + 1)
                    break
                } finally {
                    setBatchGenIds(prev => {
                        const n = new Set(prev)
                        n.delete(ep.id)
                        return n
                    })
                }
                completed += 1
                setBatchDone(d => d + 1)
            }
            if (failed.length === 0) {
                setAiMsg({ type: 'success', text: t('分镜生成完成，共 {count} 集', { count: candidates.length }) })
            } else {
                setAiMsg({
                    type: 'error',
                    text: `分镜生成结束：成功 ${completed} 集，失败 ${failed.length} 集（${new Intl.ListFormat(locale).format(failed.map(f => t('第{number}集', { number: f.num })))}）：${failed.map(f => f.msg).join('；')}`
                })
            }
        } finally {
            await refreshStoryboardWorkspace()
            setBatchGenIds(new Set())
            setBatchGenQueue(new Set())
            setBatchRunning(false)
            setBatchTotal(0)
            setBatchDone(0)
            setBatchFailed(0)
        }
    }

    function prefetchEpisode(epId: string) {
        if (episodePrefetchTimer.current) clearTimeout(episodePrefetchTimer.current)
        if (epId === episodeId) return
        // An unavailable speculative target must not redirect the current page.
        // The destination retries normally and handles errors if the user navigates there.
        void episodeNavigationLoader.prefetch(epId).catch(() => {})
    }

    function goToEpisode(epId: string) {
        if (epId === episodeId) return
        rememberEpisodeWorkspace(projectId, {
            project,
            episode,
            characters,
            scenes,
            globalNavCollapsed,
            progressNavCollapsed,
            progressNavScrollTop: progressNavScrollTopRef.current
        })
        prefetchEpisode(epId)
        // All episode URLs use this same client workspace. Avoid an extra RSC
        // round trip; the keyed workspace still resets edits and validates access.
        window.history.pushState(null, '', localizePath(`/projects/${projectId}/episodes/${epId}`, locale))
    }

    if (!episode || !project || !episodeMatchesProject)
        return (
            <div className="app-page relative flex h-screen items-center justify-center text-gray-500">
                <HomeLogoLink className="absolute start-4 top-3" />
                {t('加载中...')}
            </div>
        )

    const storyboards = episode.storyboards
    const previewStoryboards = storyboards.filter(storyboard => !!storyboard.videoUrl)
    const isEpisodeChanging = episode.id !== episodeId || verifiedEpisodeId !== episodeId
    const isStoryboarding = generatingStoryboards || episode.status === 'storyboarding'
    // 合并只拼接完成的视频；缺少原声的旧镜头需先重新生成视频。
    const allVideosCompleted =
        storyboards.length > 0 && storyboards.every(sb => !!sb.videoUrl && sb.videoStatus === 'completed' && (!sb.latestVideoRequest || sb.latestVideoRequest.status === 'completed'))
    const incompleteVideoCount = storyboards.filter(sb => !(!!sb.videoUrl && sb.videoStatus === 'completed' && (!sb.latestVideoRequest || sb.latestVideoRequest.status === 'completed'))).length
    const videoAudioIssueCount = storyboards.filter(storyboardNeedsVideoAudioRegeneration).length
    const hasGeneratedMedia =
        !!episode.videoUrl ||
        episode.merges.some(merge => !!merge.videoUrl) ||
        storyboards.some(
            storyboard =>
                !!storyboard.firstFrameUrl ||
                !!storyboard.lastFrameUrl ||
                !!storyboard.plannedLastFrameUrl ||
                !!storyboard.actualVideoEndFrameUrl ||
                !!storyboard.videoUrl ||
                !!storyboard.composedVideoUrl ||
                (storyboard.illustrations?.some(illustration => !!illustration.url) ?? false)
        )
    const lastMerge = episode.merges[0]
    const episodeSubtitleLinks = parseSubtitleUrls(lastMerge?.subtitleUrls)
    const episodeSubtitleProgress = parseSubtitleProgress(lastMerge?.subtitleProgress ?? null)
    const episodeSubtitleStatus = lastMerge?.subtitleStatus ?? (episodeSubtitleLinks.length > 0 ? 'completed' : 'unknown')
    const episodeSubtitleStatusLabel =
        episodeSubtitleStatus === 'completed'
            ? '字幕完整'
            : episodeSubtitleStatus === 'partial'
              ? '字幕部分完成'
              : episodeSubtitleStatus === 'failed'
                ? '字幕失败'
                : episodeSubtitleStatus === 'not_required'
                  ? '本集无对白，无需字幕'
                  : episodeSubtitleStatus === 'pending'
                    ? '字幕处理中'
                    : '字幕状态未记录'
    const storyboardedCount = project.episodes.filter(e => e._count.storyboards > 0).length
    const episodesCount = project.episodes?.length ?? project.totalEpisodes
    const runningStoryboardEpisodes = project.episodes.filter(ep => batchGenIds.has(ep.id) || ep.status === 'storyboarding' || (ep.id === episode.id && isStoryboarding))
    const isAnyEpisodeStoryboarding = batchRunning || runningStoryboardEpisodes.length > 0
    const runningStoryboardEpisodeLabel = new Intl.ListFormat(locale).format(runningStoryboardEpisodes.map(ep => t('第{number}集', { number: ep.episodeNumber })))
    const hasEntityLibrary = characters.length > 0 || scenes.length > 0
    const globalNavButtonClass = globalNavCollapsed ? 'h-10 justify-center px-0' : 'gap-2 px-2.5 py-1.5'

    return (
        <div className="studio-workspace h-dvh flex overflow-hidden text-sm">
            {confirmDialog}
            {generationCapacityNotice && (
                <GenerationCapacityDialog
                    category={generationCapacityNotice.category}
                    message={generationCapacityNotice.message}
                    onClose={() => setGenerationCapacityNotice(null)}
                />
            )}
            {/* 左侧全局导航 */}
            <aside className={`flex-shrink-0 border-e border-gray-800 bg-gray-950 flex flex-col transition-[width] duration-200 ease-out ${globalNavCollapsed ? 'w-16' : 'w-60'}`}>
                <div className={`${globalNavCollapsed ? 'px-2 py-3' : 'px-4 py-3'} border-b border-gray-800`}>
                    <div className={`flex items-center ${globalNavCollapsed ? 'flex-col gap-1' : 'justify-between gap-2 mb-2'}`}>
                        <HomeLogoLink
                            compact
                            showName={!globalNavCollapsed}
                            nameClassName="truncate text-sm"
                        />
                        <button
                            type="button"
                            onClick={() => setGlobalNavCollapsed(prev => !prev)}
                            aria-label={globalNavCollapsed ? '展开主导航' : '收起主导航'}
                            title={globalNavCollapsed ? '展开主导航' : '收起主导航'}
                            className="h-8 w-8 flex-shrink-0 rounded-md border border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-gray-900 hover:text-gray-200 transition-colors flex items-center justify-center">
                            {globalNavCollapsed ? <ChevronRight className="w-4 h-4 rtl:rotate-180" /> : <ChevronLeft className="w-4 h-4 rtl:rotate-180" />}
                        </button>
                    </div>

                    {!globalNavCollapsed && (
                        <Link
                            href="/projects"
                            className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-300">
                            <ArrowLeft className="h-3.5 w-3.5 flex-shrink-0 rtl:rotate-180" /> 全部项目
                        </Link>
                    )}

                    {globalNavCollapsed ? (
                        <Link
                            href="/projects"
                            title="全部项目"
                            aria-label="全部项目"
                            className="mt-2 flex h-10 w-full items-center justify-center rounded-md text-gray-500 hover:bg-gray-900 hover:text-gray-200 transition-colors">
                            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                        </Link>
                    ) : (
                        <>
                            <h1
                                data-i18n-skip
                                className="text-white font-semibold text-[15px] truncate"
                                title={project.title}>
                                {project.title}
                            </h1>
                            <div className="flex items-center gap-1.5 mt-1">
                                {project.genre && <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">{t(project.genre)}</span>}
                                <span className="text-[10px] text-gray-500">
                                    {episodesCount} {t('集')}
                                </span>
                            </div>
                            <div className="mt-2.5">
                                <ModelSwitcher />
                            </div>
                        </>
                    )}
                </div>
                <nav className="flex-1 overflow-y-auto novel-scroll p-2 text-[13px]">
                    <Link
                        href={`/projects/${projectId}`}
                        title={globalNavCollapsed ? '小说' : undefined}
                        className={`w-full flex items-center rounded-md text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 transition-colors ${globalNavButtonClass}`}>
                        <BookOpen className="w-4 h-4 flex-shrink-0" />
                        {!globalNavCollapsed && <span className="flex-1">小说</span>}
                    </Link>
                    <div
                        title={globalNavCollapsed ? '集数 · 分镜' : undefined}
                        className={`w-full flex items-center rounded-md bg-gray-800/70 text-white mt-0.5 ${globalNavButtonClass}`}>
                        <FilmIcon className="w-4 h-4 flex-shrink-0" />
                        {!globalNavCollapsed && (
                            <>
                                <span className="flex-1 font-medium">集数 · 分镜</span>
                                <span className="text-[10px] text-gray-400">
                                    {storyboardedCount}/{episodesCount}
                                </span>
                            </>
                        )}
                    </div>
                    <Link
                        href={`/projects/${projectId}/characters`}
                        title={globalNavCollapsed ? '角色' : undefined}
                        className={`w-full flex items-center rounded-md text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 transition-colors mt-0.5 ${globalNavButtonClass}`}>
                        <Users className="w-4 h-4 flex-shrink-0" />
                        {!globalNavCollapsed && (
                            <>
                                <span className="flex-1">角色</span>
                                <span className="text-[10px] text-gray-500">{project.characters?.length ?? 0}</span>
                            </>
                        )}
                    </Link>
                    <Link
                        href={`/projects/${projectId}/scenes`}
                        title={globalNavCollapsed ? '场景' : undefined}
                        className={`w-full flex items-center rounded-md text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 transition-colors mt-0.5 ${globalNavButtonClass}`}>
                        <MapPin className="w-4 h-4 flex-shrink-0" />
                        {!globalNavCollapsed && (
                            <>
                                <span className="flex-1">场景</span>
                                <span className="text-[10px] text-gray-500">{project.scenes?.length ?? 0}</span>
                            </>
                        )}
                    </Link>
                    <Link
                        href={`/projects/${projectId}/publication`}
                        title={t('发布作品')}
                        className={`mt-0.5 flex w-full items-center rounded-md text-gray-400 transition-colors hover:bg-gray-800/40 hover:text-gray-200 ${globalNavButtonClass}`}>
                        <Globe className="h-4 w-4 flex-shrink-0" />
                        {!globalNavCollapsed && <span className="flex-1">{t('发布作品')}</span>}
                    </Link>
                </nav>
            </aside>

            {/* 中间：集数列表 */}
            <aside className={`flex-shrink-0 border-e border-gray-800 bg-gray-950 flex flex-col transition-[width] duration-200 ease-out ${progressNavCollapsed ? 'w-14' : 'w-64 xl:w-72'}`}>
                <div className={`${progressNavCollapsed ? 'px-2 py-3' : 'px-4 py-3'} border-b border-gray-800 flex-shrink-0`}>
                    <div className={`flex items-center gap-2 ${progressNavCollapsed ? 'flex-col' : ''}`}>
                        {!progressNavCollapsed && (
                            <div
                                className="min-w-0 flex-1 truncate text-xs text-gray-400"
                                title={t('分镜进度')}>
                                {t('分镜进度')}
                            </div>
                        )}
                        {isAnyEpisodeStoryboarding && (
                            <span
                                role="status"
                                className={progressNavCollapsed ? 'order-last' : 'flex-shrink-0'}
                                title={runningStoryboardEpisodeLabel ? `${t('当前：')}${runningStoryboardEpisodeLabel}` : t('生成中')}>
                                <RefreshCw
                                    className="h-3.5 w-3.5 animate-spin text-purple-300"
                                    aria-hidden="true"
                                />
                                <span className="sr-only">{batchRunning ? t('批量生成分镜') : t('生成中')}</span>
                            </span>
                        )}
                        {!progressNavCollapsed && (
                            <div className="flex-shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-white">
                                {storyboardedCount} / {episodesCount}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => setProgressNavCollapsed(prev => !prev)}
                            aria-label={progressNavCollapsed ? '展开分镜进度' : '收起分镜进度'}
                            title={progressNavCollapsed ? '展开分镜进度' : '收起分镜进度'}
                            className="h-7 w-7 flex-shrink-0 rounded-md border border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-gray-900 hover:text-gray-200 transition-colors flex items-center justify-center">
                            {progressNavCollapsed ? <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" /> : <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />}
                        </button>
                    </div>
                    <div
                        role="progressbar"
                        aria-label={t('分镜进度')}
                        aria-valuemin={0}
                        aria-valuemax={Math.max(episodesCount, 1)}
                        aria-valuenow={storyboardedCount}
                        className="studio-episode-progress mt-2 h-1.5 rounded-full overflow-hidden"
                        title={`${storyboardedCount} / ${episodesCount} ${t('已分镜')}`}>
                        <div
                            className="progress-flow h-full bg-gradient-to-r from-purple-500 to-pink-500"
                            style={{ width: `${(storyboardedCount / Math.max(episodesCount, 1)) * 100}%` }}
                        />
                    </div>
                    {!progressNavCollapsed && isAnyEpisodeStoryboarding && (runningStoryboardEpisodeLabel || (batchRunning && batchFailed > 0)) && (
                        <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px]">
                            {runningStoryboardEpisodeLabel && (
                                <span
                                    className="min-w-0 flex-1 truncate text-purple-300"
                                    title={`${t('当前：')}${runningStoryboardEpisodeLabel}`}>
                                    {t('当前：')}
                                    {runningStoryboardEpisodeLabel}
                                </span>
                            )}
                            {batchRunning && batchFailed > 0 && (
                                <span className="flex-shrink-0 whitespace-nowrap text-red-300">
                                    {t('失败')} {batchFailed}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div
                    ref={bindProgressNavScroll}
                    onScroll={event => {
                        progressNavScrollTopRef.current = event.currentTarget.scrollTop
                        const cached = episodeWorkspaceCache.get(projectId)
                        if (cached) cached.progressNavScrollTop = event.currentTarget.scrollTop
                    }}
                    className="flex-1 overflow-y-auto novel-scroll p-2 space-y-1">
                    {project.episodes.map(ep => {
                        const isActive = ep.id === episodeId
                        const isBatchGen = batchGenIds.has(ep.id)
                        const isBatchQueue = batchGenQueue.has(ep.id)
                        const hasSb = ep._count.storyboards > 0
                        const isStoryboarded = hasSb
                        const isEpStoryboarding = isBatchGen || ep.status === 'storyboarding'
                        const isScripted = ep.status === 'scripted'
                        const hasMergedVideo =
                            ep.id === episode.id ? Boolean(episode.videoUrl || episode.merges.some(merge => merge.status === 'completed' && merge.videoUrl)) : Boolean(ep.hasMergedVideo)

                        return (
                            <button
                                data-i18n-skip-attributes
                                key={ep.id}
                                onPointerEnter={() => {
                                    if (episodePrefetchTimer.current) clearTimeout(episodePrefetchTimer.current)
                                    episodePrefetchTimer.current = setTimeout(() => prefetchEpisode(ep.id), 120)
                                }}
                                onPointerLeave={() => {
                                    if (episodePrefetchTimer.current) clearTimeout(episodePrefetchTimer.current)
                                }}
                                onFocus={() => prefetchEpisode(ep.id)}
                                onTouchStart={() => prefetchEpisode(ep.id)}
                                onClick={() => goToEpisode(ep.id)}
                                title={progressNavCollapsed ? (ep.title ?? t('第{number}集', { number: ep.episodeNumber })) : undefined}
                                aria-current={isActive ? 'page' : undefined}
                                className={`studio-episode-link w-full text-start rounded-lg flex items-center transition-colors ${
                                    progressNavCollapsed ? 'justify-center px-0 py-2' : 'px-3 py-2.5 gap-2'
                                } ${isActive ? 'bg-purple-500/20 border border-purple-500/40' : 'border border-transparent hover:bg-gray-800/60'}`}>
                                <span
                                    className={`w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                                        isEpStoryboarding
                                            ? 'bg-pink-900/40 text-pink-300'
                                            : isStoryboarded || hasSb
                                              ? 'bg-pink-900/40 text-pink-300'
                                              : isScripted
                                                ? 'bg-blue-900/40 text-blue-400'
                                                : isActive
                                                  ? 'bg-purple-600 text-white'
                                                  : 'bg-gray-800 text-gray-400'
                                    }`}>
                                    {isEpStoryboarding ? <RefreshCw className="w-3 h-3 animate-spin" /> : ep.episodeNumber}
                                </span>
                                {!progressNavCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <div
                                            data-i18n-skip
                                            className={`text-sm truncate ${isActive ? 'text-white' : 'text-gray-300'}`}>
                                            {ep.title ?? t('第{number}集', { number: ep.episodeNumber })}
                                        </div>
                                        <div className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5">
                                            {isEpStoryboarding ? (
                                                <span className="text-pink-300">AI 分镜中</span>
                                            ) : isBatchQueue ? (
                                                <span className="text-gray-400">即将开始</span>
                                            ) : hasSb ? (
                                                <>
                                                    <Layers className="w-3 h-3 text-pink-400" />
                                                    <span>{ep._count.storyboards} 个分镜</span>
                                                </>
                                            ) : isScripted ? (
                                                <>
                                                    <CheckCircle className="w-3 h-3 text-blue-400" />
                                                    <span>已拆本 · 未分镜</span>
                                                </>
                                            ) : (
                                                <span className="text-gray-600">未拆本</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {hasMergedVideo && !progressNavCollapsed && (
                                    <FilmIcon
                                        className="h-4 w-4 flex-shrink-0 text-emerald-400"
                                        aria-label="本集成片已合成"
                                    />
                                )}
                            </button>
                        )
                    })}
                </div>
                {/* 底部批量操作 */}
                <div className="border-t border-gray-800 p-2 space-y-1.5 flex-shrink-0">
                    {progressNavCollapsed ? (
                        <>
                            <button
                                onClick={() => batchGenerateStoryboards('missing')}
                                disabled={batchRunning || batchGenIds.size > 0}
                                title={batchRunning ? `分镜中 ${batchDone}/${batchTotal}` : 'AI 生成剩余分镜'}
                                className="w-full flex items-center justify-center p-2 studio-primary hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-white rounded-lg">
                                <Sparkles className={`w-3.5 h-3.5 ${batchRunning ? 'animate-pulse' : ''}`} />
                            </button>
                            <button
                                onClick={() => batchGenerateStoryboards('all')}
                                disabled={batchRunning || batchGenIds.size > 0}
                                title="全部重新生成"
                                className="w-full flex items-center justify-center p-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg">
                                <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => batchGenerateStoryboards('missing')}
                                disabled={batchRunning || batchGenIds.size > 0}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 studio-primary hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-white text-xs rounded-lg">
                                <Sparkles className="w-3.5 h-3.5" />
                                {batchRunning ? (batchTotal > 0 ? `分镜中 ${batchDone}/${batchTotal}` : '分镜中...') : 'AI 生成剩余分镜'}
                            </button>
                            <button
                                onClick={() => batchGenerateStoryboards('all')}
                                disabled={batchRunning || batchGenIds.size > 0}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg">
                                <RefreshCw className="w-3.5 h-3.5" />
                                全部重新生成
                            </button>
                        </>
                    )}
                </div>
            </aside>

            {/* 右侧：当前集工作区 */}
            <main
                className="studio-episode-main relative flex-1 min-w-0 flex flex-col bg-gray-950 overflow-hidden"
                aria-busy={isEpisodeChanging}>
                {isEpisodeChanging && (
                    <div
                        className="absolute inset-0 z-30 cursor-wait"
                        aria-live="polite">
                        <div
                            aria-hidden
                            className="space-y-3 px-4 pt-20 sm:px-6">
                            {Array.from({ length: 8 }, (_, index) => (
                                <div
                                    key={index}
                                    className="h-12 animate-pulse rounded-xl border border-white/[0.05] bg-slate-800/40"
                                />
                            ))}
                        </div>
                        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-purple-400/30 bg-gray-900/95 px-4 py-2 text-sm text-gray-200 shadow-xl shadow-black/30">
                            {failedEpisodeLoadId === episodeId ? (
                                <button
                                    type="button"
                                    onClick={() => void fetchAll()}>
                                    加载失败，点击重试
                                </button>
                            ) : (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin text-purple-300" />
                                    正在加载本集最新内容...
                                </>
                            )}
                        </div>
                    </div>
                )}
                {/* Reuse the workspace shell, but validate cached media before displaying or editing it. */}
                {!isEpisodeChanging && (
                    <>
                        <div className="studio-mobile-nav flex shrink-0 items-center gap-4 border-b border-white/[0.07] px-4 py-3 text-xs text-slate-400 md:hidden">
                            <HomeLogoLink compact />
                            <Link
                                href={`/projects/${projectId}?tab=episodes`}
                                className="me-auto flex items-center gap-1.5">
                                <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                                集数
                            </Link>
                            <Link href={`/projects/${projectId}/characters`}>角色</Link>
                            <Link href={`/projects/${projectId}/scenes`}>场景</Link>
                        </div>
                        <CreationJourney
                            current={activeTab === 'script' ? 'script' : activeTab === 'finished' ? 'video' : 'storyboard'}
                            steps={{
                                outline: {
                                    href: `/projects/${projectId}?tab=novel&stage=outlined`,
                                    detail: '故事与人物目标',
                                    completed: project.episodes.length > 0 && project.episodes.every(projectEpisode => !!projectEpisode.synopsis?.trim())
                                },
                                script: { href: '#episode-script', detail: episode.script ? '本集剧本' : '待编写', completed: !!episode.script, onClick: () => setActiveTab('script') },
                                extract: { href: `/projects/${projectId}/characters`, detail: `${characters.length} ${t('角色')} · ${scenes.length} ${t('场景')}`, completed: hasEntityLibrary },
                                storyboard: {
                                    href: '#production-overview',
                                    detail: `${storyboards.length} ${t('个分镜')}`,
                                    completed: storyboards.length > 0,
                                    onClick: () => setActiveTab('storyboard')
                                },
                                video: {
                                    href: '#episode-finished',
                                    detail: lastMerge?.status === 'completed' ? t('已完成') : t('待合成'),
                                    completed: lastMerge?.status === 'completed',
                                    onClick: () => setActiveTab('finished')
                                }
                            }}
                        />
                        {/* 顶栏：本集步骤 + 操作 */}
                        <header className="studio-episode-header">
                            <div
                                className="studio-episode-tabs novel-scroll"
                                role="tablist"
                                aria-label="本集制作步骤">
                                {[
                                    { key: 'storyboard', label: `${t('分镜')} (${storyboards.length})` },
                                    { key: 'script', label: t('剧本') },
                                    { key: 'preview', label: t('镜头预览') },
                                    { key: 'finished', label: lastMerge?.status === 'completed' ? `${t('成片')} ✓` : t('成片') }
                                ].map(({ key, label }) => (
                                    <button
                                        key={key}
                                        type="button"
                                        role="tab"
                                        aria-selected={activeTab === key}
                                        onClick={() => setActiveTab(key as EpisodeWorkspaceTab)}
                                        className={`studio-episode-tab ${activeTab === key ? 'is-active' : ''}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="studio-episode-actions">
                                <EpisodeGenerationSettings
                                    imageProvider={globalImageProvider}
                                    onImageProviderChange={changeGlobalImageProvider}
                                    savingImageProvider={savingImageProvider}
                                    videoProvider={globalVideoProvider}
                                    onVideoProviderChange={changeGlobalVideoProvider}
                                    savingVideoProvider={savingVideoProvider}
                                    videoLanguage={globalVideoLanguage}
                                    onVideoLanguageChange={changeGlobalVideoLanguage}
                                    savingVideoLanguage={savingVideoLanguage}
                                    showEpisodeActions={activeTab === 'storyboard'}
                                    hasStoryboards={storyboards.length > 0}
                                    canAddStoryboard={!isStoryboarding}
                                    addingStoryboard={addingStoryboard}
                                    onAddStoryboard={addStoryboard}
                                    canRegenerateStoryboards={!isStoryboarding && !!episode.script}
                                    hasGeneratedMedia={hasGeneratedMedia}
                                    onRegenerateStoryboards={aiGenerateStoryboards}
                                    onRegenerateAll={regenerateEntireEpisode}
                                />
                                {/* 一键合成本集 */}
                                {storyboards.some(sb => sb.videoUrl && sb.audioUrl && !storyboardUsesEmbeddedVideoAudio(sb)) && (
                                    <div className="order-[15] flex flex-shrink-0 items-center whitespace-nowrap">
                                        <button
                                            onClick={() => triggerBatchCompose('missing')}
                                            disabled={batchComposing}
                                            className="studio-episode-action flex items-center gap-1.5 px-3 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white text-sm font-medium rounded-s-lg transition-colors border-e border-pink-800"
                                            title="对所有已生成视频执行单镜成片确认或音轨混合">
                                            <Wand2 className="w-4 h-4 flex-shrink-0" />
                                            <span className="hidden sm:inline">
                                                {batchComposing
                                                    ? batchComposeProgress.total > 0
                                                        ? `合成中 ${batchComposeProgress.done}/${batchComposeProgress.total}${batchComposeProgress.failed > 0 ? `（失败 ${batchComposeProgress.failed}）` : ''}`
                                                        : '合成中'
                                                    : '一键成片确认'}
                                            </span>
                                        </button>
                                        <button
                                            onClick={() => triggerBatchCompose('all')}
                                            disabled={batchComposing}
                                            className="studio-episode-action flex items-center px-2 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white text-sm font-medium rounded-e-lg transition-colors"
                                            title="重新执行全部单镜成片确认或音轨混合">
                                            <RefreshCw className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                                {storyboards.some(sb => sb.frameStatus === 'generating' || sb.videoStatus === 'generating' || sb.composeStatus === 'processing') && (
                                    <button
                                        onClick={cancelAllGenerating}
                                        className="studio-episode-action order-[5] flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-yellow-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-700"
                                        title="停止所有正在生成的分镜（插图/视频/合成）">
                                        <StopCircle className="w-4 h-4 flex-shrink-0" />
                                        <span className="hidden sm:inline">暂停所有</span>
                                    </button>
                                )}
                                {storyboards.length > 0 && (
                                    <div className="order-[10] flex flex-shrink-0 items-center whitespace-nowrap">
                                        <button
                                            onClick={() => openEpisodeBatch('missing')}
                                            className="studio-episode-action flex items-center gap-1.5 px-3 py-2 studio-primary hover:from-purple-700 hover:to-pink-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                                            title="保留已有素材，只生成缺失或失败的插图和视频">
                                            <Sparkles className="w-4 h-4 flex-shrink-0" />
                                            <span>一键生成</span>
                                        </button>
                                    </div>
                                )}
                                {storyboards.length > 0 &&
                                    (() => {
                                        const isMerging = merging || lastMerge?.status === 'processing'
                                        const mergeLabel = !allVideosCompleted
                                            ? `待视频完成 (${incompleteVideoCount})`
                                            : isMerging
                                              ? t('合并中...')
                                              : videoAudioIssueCount > 0
                                                ? `${t('检查视频原声')} (${videoAudioIssueCount})`
                                                : t('合并视频')
                                        return (
                                            <button
                                                onClick={triggerMerge}
                                                aria-label={mergeLabel}
                                                disabled={isMerging || !allVideosCompleted}
                                                title={
                                                    !allVideosCompleted
                                                        ? `还有 ${incompleteVideoCount} 个分镜视频未完成，完成后即可合并本集`
                                                        : videoAudioIssueCount > 0
                                                          ? t('请重新生成带原声的视频，完成后再合并。')
                                                          : '合并本集全部分镜视频'
                                                }
                                                className="studio-secondary studio-episode-action order-[20] disabled:opacity-45">
                                                <Merge className="w-4 h-4 flex-shrink-0 relative" />
                                                <span className="hidden sm:inline">{mergeLabel}</span>
                                            </button>
                                        )
                                    })()}
                                {activeTab === 'storyboard' && storyboards.length === 0 && (
                                    <div className="studio-storyboard-actions order-[30] flex max-w-full flex-shrink-0 gap-2">
                                        <button
                                            onClick={aiGenerateStoryboards}
                                            disabled={isStoryboarding || !episode.script}
                                            className="studio-secondary studio-episode-action disabled:opacity-40">
                                            <Sparkles className="h-4 w-4" />
                                            {isStoryboarding ? 'AI 分镜中...' : 'AI 生成本集分镜'}
                                        </button>
                                    </div>
                                )}
                                {activeTab === 'script' && (
                                    <button
                                        onClick={saveScript}
                                        disabled={savingScript}
                                        className="studio-primary studio-episode-action order-[10] rounded-lg px-4 py-2 text-sm text-white transition-colors disabled:opacity-50">
                                        {savingScript ? '保存中...' : '保存剧本'}
                                    </button>
                                )}
                                <div className="order-[60] flex flex-shrink-0 items-center gap-2 border-s border-white/[0.08] ps-2 studio-episode-wallet">
                                    <WalletBalance compact />
                                </div>
                            </div>
                        </header>

                        {/* 内容区 */}
                        <div className="studio-episode-content flex-1 min-h-0 overflow-y-auto novel-scroll">
                            {/* 剧本 Tab */}
                            {activeTab === 'script' && (
                                <div
                                    id="episode-script"
                                    className="px-6 py-5 flex flex-col h-full">
                                    <p className="mb-3 flex-shrink-0 text-sm text-gray-400">编辑后请先保存剧本，再切换至「分镜」生成或重新生成分镜</p>
                                    <textarea
                                        value={scriptText}
                                        onChange={e => setScriptText(e.target.value)}
                                        placeholder={`在这里编写本集剧本...\n\n格式参考：\n场景：咖啡厅 白天\n林晓薇：你终于来了。\n陈默：对不起，让你久等了。`}
                                        className="flex-1 min-h-[400px] w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:border-purple-500 resize-none leading-8 novel-scroll"
                                    />
                                </div>
                            )}

                            {/* 分镜 Tab */}
                            {activeTab === 'storyboard' && (
                                <div className="px-6 py-4">
                                    {/* aiMsg 已迁移到右上角 Toast */}
                                    {!hasEntityLibrary && (
                                        <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
                                            <div className="flex items-start gap-3">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-400" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium text-yellow-200">还没有项目角色库/场景库</div>
                                                    <p className="mt-1 text-xs leading-relaxed text-yellow-100/75">
                                                        不需要在生成小说时手选。先把小说拆成各集剧本，然后到「小说 → 拆剧本 /
                                                        提取」点击「提取角色和场景」并确认结果；分镜生成时才会自动匹配这些角色和场景。
                                                    </p>
                                                </div>
                                                <Link
                                                    href={`/projects/${projectId}?tab=novel&stage=finalized`}
                                                    className="flex-shrink-0 rounded-lg bg-yellow-500/15 px-3 py-1.5 text-xs font-medium text-yellow-100 hover:bg-yellow-500/25">
                                                    去提取
                                                </Link>
                                            </div>
                                        </div>
                                    )}
                                    <div className="studio-shot-grid">
                                        {isStoryboarding ? (
                                            <div className="overflow-hidden rounded-xl border border-purple-500/30 bg-purple-500/10">
                                                <div className="flex items-center gap-3 border-b border-purple-500/20 px-5 py-4">
                                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/30">
                                                        <RefreshCw className="h-5 w-5 animate-spin" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm font-medium text-purple-100">AI 正在生成本集分镜</div>
                                                        <div className="mt-0.5 text-xs text-purple-200/70">
                                                            {storyboards.length > 0 ? '正在重新拆解剧本，完成后会替换当前分镜' : '正在拆解剧本，完成后会显示分镜列表'}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={cancelAiStoryboard}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors flex-shrink-0">
                                                        <StopCircle className="w-3.5 h-3.5" />
                                                        取消
                                                    </button>
                                                </div>
                                                <div className="space-y-3 p-4">
                                                    {[1, 2, 3, 4].map(item => (
                                                        <div
                                                            key={item}
                                                            className="rounded-lg border border-purple-500/15 bg-gray-950/40 p-4">
                                                            <div className="mb-3 flex items-center gap-3">
                                                                <div className="h-8 w-8 rounded-lg bg-purple-300/15" />
                                                                <div className="h-3 w-28 rounded-full bg-purple-300/20" />
                                                                <div className="ms-auto h-3 w-16 rounded-full bg-purple-300/10" />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="h-3 w-full rounded-full bg-purple-300/10" />
                                                                <div className="h-3 w-5/6 rounded-full bg-purple-300/10" />
                                                                <div className="h-3 w-2/3 rounded-full bg-purple-300/10" />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            storyboards.map((sb, idx) => (
                                                <ShotCard
                                                    key={sb.id}
                                                    sb={sb}
                                                    idx={idx}
                                                    characters={characters}
                                                    scenes={scenes}
                                                    projectId={projectId}
                                                    expanded={expandedShot === sb.id}
                                                    defaultVideoProvider={globalVideoProvider}
                                                    defaultImageProvider={globalImageProvider}
                                                    defaultImageQuality={globalImageQuality}
                                                    batchStatus={episodeBatchShotStatuses[sb.id]}
                                                    batchError={episodeBatchShotErrors[sb.id]}
                                                    batchFailureStage={episodeBatchShotFailureStages[sb.id]}
                                                    prevShots={storyboards.slice(Math.max(0, idx - 3), idx).map(s => ({ imagePrompt: s.imagePrompt, actionDesc: s.actionDesc, dialogue: s.dialogue }))}
                                                    onToggle={() => setExpandedShot(expandedShot === sb.id ? null : sb.id)}
                                                    onUpdate={data => updateStoryboard(sb.id, data)}
                                                    onDelete={() => deleteStoryboard(sb)}
                                                    deleting={deletingStoryboardId === sb.id}
                                                    onCheckGenerationCapacity={(category, units) => checkGenerationCapacity(sb.id, category, units)}
                                                    onReleaseGenerationCapacity={category => releaseGenerationCapacity(sb.id, category)}
                                                    onGenerate={(type, provider, referenceMode, imageProvider, imageQuality, illustrationCount) =>
                                                        triggerGenerate(sb.id, type, provider, referenceMode, imageProvider, imageQuality, illustrationCount)
                                                    }
                                                    onRegenerateMiddleFrame={(frameId, provider, imageProvider, imageQuality) =>
                                                        regenerateMiddleFrame(sb.id, frameId, provider, imageProvider, imageQuality)
                                                    }
                                                    onDeleteMiddleFrame={frame => deleteMiddleFrame(sb.id, frame)}
                                                    onDeleteFrame={frame => deleteFrame(sb.id, frame)}
                                                    onCancelGenerate={target => cancelGenerate(sb.id, target)}
                                                    onCompose={() => triggerCompose(sb.id)}
                                                />
                                            ))
                                        )}
                                        {!isStoryboarding && storyboards.length === 0 && (
                                            <div className="text-center py-20 border border-dashed border-gray-800 rounded-xl">
                                                <Layers className="w-10 h-10 mx-auto mb-3 text-gray-700" />
                                                <p className="text-sm text-gray-400 mb-1">本集还没有分镜</p>
                                                <p className="text-xs text-gray-500 mb-4">点击上方「AI 生成本集分镜」自动拆解，或手工添加</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 预览 Tab */}
                            {activeTab === 'preview' && (
                                <div
                                    id="episode-preview"
                                    className="px-4 py-4 sm:px-6 sm:py-5">
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-sm text-gray-400">各分镜原视频预览（保留视频模型原声）</p>
                                        {previewStoryboards.length > 0 && <span className="text-xs text-gray-600">共 {previewStoryboards.length} 个镜头</span>}
                                    </div>
                                    {previewStoryboards.length > 0 && (
                                        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(14rem,100%),1fr))] items-start gap-3">
                                            {previewStoryboards.map(sb => (
                                                <article
                                                    key={sb.id}
                                                    className="min-w-0 overflow-hidden rounded-xl border border-gray-800 bg-gray-900/80 p-2.5 shadow-sm">
                                                    <p className="mb-2 px-0.5 text-xs font-medium text-gray-400">镜头 {sb.order}</p>
                                                    <video
                                                        src={sb.videoUrl!}
                                                        controls
                                                        preload="metadata"
                                                        className="mx-auto block h-auto max-h-72 w-auto max-w-full rounded-lg bg-black"
                                                    />
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                    {previewStoryboards.length === 0 && (
                                        <div className="text-center py-16 text-gray-500">
                                            <Video className="w-10 h-10 mx-auto mb-2 text-gray-700" />
                                            <p>还没有生成的视频</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 成片 Tab：集中展示合并结果和字幕，避免挤占顶栏。 */}
                            {activeTab === 'finished' && (
                                <div
                                    id="episode-finished"
                                    className="px-4 py-4 sm:px-6 sm:py-5">
                                    {lastMerge?.status === 'completed' && lastMerge.videoUrl ? (
                                        <div className="mx-auto max-w-5xl space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <h2 className="font-medium text-white">本集成片</h2>
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        已按分镜顺序合并
                                                        {lastMerge.targetWidth && lastMerge.targetHeight ? ` · ${lastMerge.targetWidth}×${lastMerge.targetHeight}` : ''}
                                                        ，可在下方预览或打开原文件。
                                                    </p>
                                                </div>
                                                <a
                                                    href={lastMerge.videoUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
                                                    <Play className="h-4 w-4" />
                                                    打开成片
                                                </a>
                                            </div>
                                            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
                                                <div className="flex min-w-0 justify-center rounded-xl border border-gray-800 bg-black/30 p-2 sm:p-3">
                                                    <video
                                                        key={lastMerge.id}
                                                        src={`${lastMerge.videoUrl}${lastMerge.videoUrl.includes('?') ? '&' : '?'}merge=${lastMerge.id}`}
                                                        controls
                                                        preload="metadata"
                                                        muted={false}
                                                        style={lastMerge.targetWidth && lastMerge.targetHeight ? { aspectRatio: `${lastMerge.targetWidth} / ${lastMerge.targetHeight}` } : undefined}
                                                        onLoadedMetadata={event => {
                                                            // A completed re-merge must not reuse mute/volume/error
                                                            // state from the previous, possibly corrupt media element.
                                                            event.currentTarget.muted = false
                                                            if (event.currentTarget.volume === 0) event.currentTarget.volume = 1
                                                        }}
                                                        className="block h-auto max-h-[min(68dvh,720px)] w-auto max-w-full rounded-lg bg-black shadow-2xl"
                                                    />
                                                </div>
                                                <div className="space-y-4">
                                                    <div
                                                        className={`rounded-xl border px-4 py-3 text-sm ${
                                                            episodeSubtitleStatus === 'completed' || episodeSubtitleStatus === 'not_required'
                                                                ? 'border-green-500/30 bg-green-500/10 text-green-200'
                                                                : episodeSubtitleStatus === 'partial' || episodeSubtitleStatus === 'pending'
                                                                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                                                                  : 'border-red-500/30 bg-red-500/10 text-red-200'
                                                        }`}>
                                                        <div className="font-medium">{episodeSubtitleStatusLabel}</div>
                                                        {episodeSubtitleProgress && episodeSubtitleStatus !== 'not_required' && (
                                                            <div className="mt-1 text-xs opacity-80">
                                                                已完成 {episodeSubtitleProgress.completed?.length ?? 0} / {episodeSubtitleProgress.expected?.length ?? 0} 种语言
                                                                {(episodeSubtitleProgress.failed?.length ?? 0) > 0 ? `，失败：${episodeSubtitleProgress.failed?.join('、')}` : ''}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {episodeSubtitleLinks.length > 0 && (
                                                        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                                                            <div className="mb-3 text-sm font-medium text-gray-200">字幕文件</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {episodeSubtitleLinks.map(item => (
                                                                    <a
                                                                        key={item.lang}
                                                                        href={item.url}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-200 transition-colors hover:bg-purple-500/20">
                                                                        {isLocale(item.lang) ? localeDisplayName(locale, item.lang) : item.lang}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-gray-800 py-20 text-center text-gray-500">
                                            <FilmIcon className="mx-auto mb-3 h-10 w-10 text-gray-700" />
                                            <p className="text-sm text-gray-400">还没有本集成片</p>
                                            <p className="mt-1 text-xs">所有分镜视频生成完成后，点击顶部「合并视频」。</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>

            {showBatchModal && (
                <EpisodeBatchModal
                    episodeId={episodeId}
                    requestId={episodeBatchRequestId}
                    mode={episodeBatchMode}
                    imageProvider={globalImageProvider}
                    imageQuality={globalImageQuality}
                    videoProvider={globalVideoProvider}
                    onClose={() => {
                        setShowBatchModal(false)
                    }}
                    onDone={() => fetchAll()}
                    onStarted={(jobId, resetApplied) => {
                        setActiveEpisodeBatchJobId(jobId)
                        if (resetApplied) clearEpisodeGeneratedMediaInView()
                        void fetchAll()
                    }}
                    onProgress={syncEpisodeBatchProgress}
                />
            )}
        </div>
    )
}

function ShotCard({
    sb,
    idx,
    characters,
    scenes,
    projectId,
    expanded,
    defaultVideoProvider,
    defaultImageProvider,
    defaultImageQuality,
    batchStatus,
    batchError,
    batchFailureStage,
    onToggle,
    onUpdate,
    onDelete,
    deleting,
    onCheckGenerationCapacity,
    onReleaseGenerationCapacity,
    onGenerate,
    onRegenerateMiddleFrame,
    onDeleteMiddleFrame,
    onDeleteFrame,
    onCancelGenerate,
    onCompose
}: {
    sb: Storyboard
    idx: number
    characters: Character[]
    scenes: Scene[]
    projectId: string
    expanded: boolean
    defaultVideoProvider?: ProductionVideoProvider
    defaultImageProvider?: ImageProvider
    defaultImageQuality?: ImageQuality
    batchStatus?: EpisodeBatchShotStatus
    batchError?: string
    batchFailureStage?: EpisodeBatchFailureStage
    prevShots?: Array<{ imagePrompt: string | null; actionDesc: string | null; dialogue: string | null }>
    onToggle: () => void
    onUpdate: (data: Partial<Storyboard> & { characterIds?: string[] }) => Promise<boolean>
    onDelete: () => void | Promise<void>
    deleting: boolean
    onCheckGenerationCapacity: (category: GenerationCapacityCategory, units?: number) => Promise<boolean>
    onReleaseGenerationCapacity: (category: GenerationCapacityCategory) => void
    onGenerate: (
        type: StoryboardGenerationRequestType,
        provider?: string,
        referenceMode?: VideoReferenceMode,
        imageProvider?: ImageProvider,
        imageQuality?: ImageQuality,
        illustrationCount?: number
    ) => void | Promise<void>
    onRegenerateMiddleFrame: (frameId: string, provider?: string, imageProvider?: ImageProvider, imageQuality?: ImageQuality) => void | Promise<void>
    onDeleteMiddleFrame: (frame: Illustration) => void
    onDeleteFrame: (frame: Illustration) => void
    onCancelGenerate: (target: 'frame' | 'video' | 'compose' | 'all') => void
    onCompose: () => void
}) {
    const { t } = useI18n()
    const [localData, setLocalData] = useState({
        shotType: sb.shotType ?? 'medium',
        duration: sb.duration,
        dialogue: sb.dialogue ?? '',
        narration: sb.narration ?? '',
        actionDesc: sb.actionDesc ?? '',
        imagePrompt: sb.imagePrompt ?? '',
        negativePrompt: '',
        sceneId: sb.scene?.id ?? '',
        characterIds: sb.characters.map(c => c.character.id)
    })
    const [showShotSettings, setShowShotSettings] = useState(false)
    const [savingShotSettings, setSavingShotSettings] = useState(false)
    const [settingsFocusVersion, setSettingsFocusVersion] = useState(0)
    const settingsTriggerRef = useRef<HTMLButtonElement>(null)
    const settingsDialogRef = useRef<HTMLDivElement>(null)
    const settingsFocusTargetRef = useRef<'dialogue' | 'imagePrompt' | null>(null)
    const [savedFlash, setSavedFlash] = useState(false)
    const [, setIsComposing] = useState(false)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
    const [videoProvider, setVideoProvider] = useState<ProductionVideoProvider>(defaultVideoProvider ?? DEFAULT_VIDEO_PROVIDER)
    const [imageProvider, setImageProvider] = useState<ImageProvider>(defaultImageProvider ?? 'banana')
    const imageQuality = defaultImageQuality ?? 'standard'
    const [illustrationCount, setIllustrationCount] = useState(1)
    const [videoReferenceMode, setVideoReferenceMode] = useState<VideoReferenceMode>('single')
    const [referenceVideos, setReferenceVideos] = useState<StoryboardReferenceVideo[]>(() => parseStoryboardReferenceVideos(sb.referenceVideoAssets))
    const [uploadingReferenceVideo, setUploadingReferenceVideo] = useState(false)
    const [deletingReferenceVideoId, setDeletingReferenceVideoId] = useState<string | null>(null)
    const referenceVideoInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!showShotSettings || !expanded) return
        const dialog = settingsDialogRef.current
        const trigger = settingsTriggerRef.current
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const field = settingsFocusTargetRef.current
        const initialFocus = field ? dialog?.querySelector<HTMLTextAreaElement>(`textarea[id$="-${field}"]`) : dialog
        initialFocus?.focus()
        settingsFocusTargetRef.current = null

        const handleKeyDown = (event: KeyboardEvent) => {
            // CustomSelect renders its menu in a portal above the settings dialog.
            const select = dialog?.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')
            const menuId = select?.getAttribute('aria-controls')
            const menu = menuId ? document.getElementById(menuId) : null
            if (event.key === 'Escape' && !menu && !event.isComposing) {
                event.preventDefault()
                setShowShotSettings(false)
            }
            if (event.key !== 'Tab' || !dialog) return
            const selector = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
            const targets = [...dialog.querySelectorAll<HTMLElement>(selector), ...(menu?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(element => element.getClientRects().length > 0)
            const first = targets[0]
            const last = targets.at(-1)
            const active = document.activeElement
            if (!targets.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
                event.preventDefault()
                ;(event.shiftKey ? last : first)?.focus()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.body.style.overflow = previousOverflow
            document.removeEventListener('keydown', handleKeyDown)
            trigger?.focus({ preventScroll: true })
        }
    }, [showShotSettings, expanded, settingsFocusVersion])
    const [showVideoPrompt, setShowVideoPrompt] = useState(false)
    const [videoPromptDraft, setVideoPromptDraft] = useState(sb.fullPromptOverride ?? sb.motionOverride ?? sb.videoPrompt ?? '')
    const [savingVideoPrompt, setSavingVideoPrompt] = useState(false)
    // 视频"生成"按钮的乐观锁：
    // 用户点击后要经过 保存草稿 → 懒生成 videoPrompt（可能 5-30s LLM 调用）→ POST /storyboards/xxx/generate 三步，
    // 期间 sb.videoStatus 还没变成 'generating'，如果只靠 sb.videoStatus 来 disabled 按钮，用户会多次点击触发并发。
    const [submittingVideo, setSubmittingVideo] = useState(false)
    // 图片请求同样需要乐观锁：服务端可能返回 duplicate，而分镜状态尚未
    // 刷新到 generating，期间重复点击会产生多个相同提示。
    const [submittingFrame, setSubmittingFrame] = useState(false)
    const [generationPreflightInFlight, setGenerationPreflightInFlight] = useState<Record<GenerationCapacityCategory, boolean>>({ image: false, video: false })

    async function canStartGeneration(category: GenerationCapacityCategory, units = 1) {
        if (generationPreflightInFlight[category]) return false
        setGenerationPreflightInFlight(current => ({ ...current, [category]: true }))
        try {
            return await onCheckGenerationCapacity(category, units)
        } finally {
            setGenerationPreflightInFlight(current => ({ ...current, [category]: false }))
        }
    }
    const illustrations =
        sb.illustrations && sb.illustrations.length > 0
            ? sb.illustrations
            : [
                  ...(sb.firstFrameUrl ? [{ id: `${sb.id}-first`, type: 'first_frame' as const, label: '插图 1', url: sb.firstFrameUrl, createdAt: '' }] : []),
                  ...(sb.plannedLastFrameUrl
                      ? [{ id: `${sb.id}-planned-last`, type: 'last_frame' as const, label: '规划末图', url: sb.plannedLastFrameUrl, createdAt: '' }]
                      : sb.lastFrameUrl
                        ? [{ id: `${sb.id}-last`, type: 'last_frame' as const, label: '旧版规划末图', url: sb.lastFrameUrl, createdAt: '' }]
                        : [])
              ]
    const frameError = sb.latestErrors?.first_frame ?? sb.latestErrors?.middle_frame ?? sb.latestErrors?.last_frame ?? sb.latestErrors?.illustrations
    const batchFailureMessage = batchError ?? frameError?.errorMsg ?? sb.latestErrors?.video?.errorMsg
    // 批次轮询用于显示排队细节；持久化的分镜状态用于页面刷新、任务复用或短暂轮询失败时兜底。
    const activeGenerationStatus: EpisodeBatchShotStatus | undefined =
        batchStatus ?? (sb.videoStatus === 'generating' ? 'video_running' : sb.frameStatus === 'generating' ? 'frame_running' : sb.latestVideoRequest?.status === 'queued' ? 'frame_done' : undefined)
    const batchFrameRunning = activeGenerationStatus === 'frame_running'
    const batchFrameReady = activeGenerationStatus === 'frame_done' || activeGenerationStatus === 'video_running' || activeGenerationStatus === 'video_done'
    const batchVideoRunning = activeGenerationStatus === 'video_running'
    const batchBusy = activeGenerationStatus === 'pending' || batchFrameRunning || activeGenerationStatus === 'frame_done' || batchVideoRunning
    const frameGenerating = sb.frameStatus === 'generating' || batchFrameRunning
    const frameReady = illustrations.length > 0 || !!sb.firstFrameUrl
    const showFrameStepStatus = frameGenerating || submittingFrame || (sb.frameStatus !== 'completed' && !batchFrameReady)
    const hasOpeningFrame = !!sb.firstFrameUrl
    const endingFrameUrl = sb.plannedLastFrameUrl ?? sb.lastFrameUrl
    const hasEndingFrame = !!endingFrameUrl && endingFrameUrl !== sb.firstFrameUrl
    const resolvedBatchFailureStage =
        batchFailureStage ??
        resolveEpisodeBatchFailureStage({
            status: activeGenerationStatus ?? 'pending',
            errorMsg: batchError
        })
    const batchFrameFailed = activeGenerationStatus === 'failed' && (resolvedBatchFailureStage === 'frame' || (!resolvedBatchFailureStage && !frameReady))
    const batchVideoFailed = activeGenerationStatus === 'failed' && (resolvedBatchFailureStage === 'video' || (!resolvedBatchFailureStage && frameReady))
    const frameSucceeded = frameReady || batchFrameReady
    const hasDialogue = !!localData.dialogue.trim()
    const embeddedVideoAudio = storyboardUsesEmbeddedVideoAudio(sb)
    const selectedProviderUsesEmbeddedAudio = usesEmbeddedVideoAudio(videoProvider)
    const speechCapability = getVideoSpeechCapability(videoProvider, hasDialogue)
    const selectedVideoCapability = getVideoProviderCapability(videoProvider)
    const referenceVideoLimit = Math.min(MAX_STORYBOARD_REFERENCE_VIDEOS, selectedVideoCapability?.maxVideoReferences ?? 0)
    const referenceVideosSupported = referenceVideoLimit > 0
    const referenceVideoLimitReached = referenceVideosSupported && referenceVideos.length >= referenceVideoLimit
    const referenceVideoDurationRule = selectedVideoCapability?.referenceVideoDuration
    const referenceVideoUploadHint = referenceVideosSupported
        ? [
              `${t('可上传 MP4、MOV、WebM，最多')} ${referenceVideoLimit} ${t('个，每个不超过 300MB')}`,
              referenceVideoDurationRule ? t('单条 {min}–{max} 秒', { min: referenceVideoDurationRule.min, max: referenceVideoDurationRule.max }) : '',
              referenceVideoDurationRule?.totalMax ? t('合计不超过 {seconds} 秒', { seconds: referenceVideoDurationRule.totalMax }) : ''
          ]
              .filter(Boolean)
              .join(' · ')
        : `${selectedVideoCapability?.label ?? videoProvider} ${t('不支持参考视频')}`
    const referenceVideoDurationViolation = getReferenceVideoDurationViolation(referenceVideos, referenceVideoDurationRule)
    const referenceVideoDurationError = referenceVideoDurationViolation ? formatReferenceVideoDurationViolation(selectedVideoCapability?.label ?? videoProvider, referenceVideoDurationViolation) : ''
    const videoFailure = resolveVideoFailureDisplay({
        videoUrl: sb.videoUrl,
        videoStatus: sb.videoStatus,
        batchVideoFailed,
        batchError,
        persistedError: sb.latestErrors?.video?.errorMsg,
        providerSwitched: false
    })
    const videoQueued = sb.latestVideoRequest?.status === 'queued' || activeGenerationStatus === 'frame_done'
    const videoGenerating = submittingVideo || batchVideoRunning || (sb.videoStatus === 'generating' && !videoQueued)
    const videoPromptSaved = sb.fullPromptOverride ?? sb.motionOverride ?? sb.videoPrompt ?? ''
    const videoPromptDirty = videoPromptDraft.trim() !== videoPromptSaved.trim()
    const referenceModeSupported = supportsVideoReferenceMode(videoProvider, videoReferenceMode)
    const dialogueProviderSupported = !hasDialogue || speechCapability.mode === 'native'
    const referenceFramesReady = videoReferenceMode === 'text' || (videoReferenceMode === 'single' ? hasOpeningFrame : hasOpeningFrame && hasEndingFrame)
    const referenceVideosReady = (referenceVideos.length === 0 || referenceVideosSupported) && !referenceVideoDurationViolation
    const canGenerateVideo = dialogueProviderSupported && referenceModeSupported && referenceFramesReady && referenceVideosReady
    const videoBlockedReason = !dialogueProviderSupported
        ? `${speechCapability.label}，请改用支持原生对白的视频模型`
        : referenceVideos.length > 0 && !referenceVideosSupported
          ? `${selectedVideoCapability?.label ?? videoProvider} 不支持视频作为参考素材，请删除参考视频或更换模型`
          : referenceVideoDurationViolation
            ? referenceVideoDurationError
            : !referenceModeSupported
              ? `${speechCapability.label} 不支持当前参考方式，请选择“纯文本”`
              : videoReferenceMode === 'first_last' && !referenceFramesReady
                ? '首尾帧模式至少需要两张插图，并且必须包含首图和末图'
                : videoReferenceMode === 'single' && !hasOpeningFrame
                  ? '首帧模式需要先生成第一张插图'
                  : ''
    const videoGenerationNotice = hasDialogue && speechCapability.mode === 'none' ? '当前模型不支持原生对白，请选择支持原生对白的视频模型。' : ''

    // 跟随全局默认（如果用户还没手动在这一镜切过）
    const [shotProviderTouched, setShotProviderTouched] = useState(false)
    const [shotImageProviderTouched, setShotImageProviderTouched] = useState(false)
    useEffect(() => {
        if (!shotProviderTouched && defaultVideoProvider) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setVideoProvider(defaultVideoProvider)
            if (!supportsVideoReferenceMode(defaultVideoProvider, videoReferenceMode)) setVideoReferenceMode('text')
        }
    }, [defaultVideoProvider, shotProviderTouched, videoReferenceMode])

    useEffect(() => {
        if (!shotImageProviderTouched && defaultImageProvider) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setImageProvider(defaultImageProvider)
        }
    }, [defaultImageProvider, shotImageProviderTouched])

    useEffect(() => {
        const next = parseStoryboardReferenceVideos(sb.referenceVideoAssets)
        // Polling refreshes the persisted list after uploads from this or another tab.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setReferenceVideos(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }, [sb.referenceVideoAssets])

    useEffect(() => {
        // 分镜切换或服务端保存完成后，同步本地 Prompt 编辑器草稿。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVideoPromptDraft(sb.fullPromptOverride ?? sb.motionOverride ?? sb.videoPrompt ?? '')
    }, [sb.id, sb.fullPromptOverride, sb.motionOverride, sb.videoPrompt])

    async function save() {
        if (savingShotSettings) return
        setSavingShotSettings(true)
        try {
            if (!(await onUpdate(localData))) return
            setSavedFlash(true)
            setTimeout(() => setSavedFlash(false), 1500)
        } finally {
            setSavingShotSettings(false)
        }
    }

    async function saveBeforeGenerate() {
        if (!dirty) return
        if (!(await onUpdate(localData))) throw new Error('分镜保存失败，已停止生成')
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
    }

    function focusEditor(target: 'dialogue' | 'imagePrompt') {
        settingsFocusTargetRef.current = target
        setSettingsFocusVersion(version => version + 1)
        setShowShotSettings(true)
    }

    async function saveVideoPrompt() {
        setSavingVideoPrompt(true)
        try {
            const value = videoPromptDraft.trim() || null
            await onUpdate({ videoPrompt: value, fullPromptOverride: null, motionOverride: null })
        } finally {
            setSavingVideoPrompt(false)
        }
    }

    const initialSnapshot = JSON.stringify({
        shotType: sb.shotType ?? 'medium',
        duration: sb.duration,
        dialogue: sb.dialogue ?? '',
        narration: sb.narration ?? '',
        actionDesc: sb.actionDesc ?? '',
        imagePrompt: sb.imagePrompt ?? '',
        negativePrompt: '',
        sceneId: sb.scene?.id ?? '',
        characterIds: sb.characters.map(c => c.character.id)
    })
    const dirty = JSON.stringify(localData) !== initialSnapshot
    const headerButtonBase = 'studio-shot-action whitespace-nowrap disabled:cursor-not-allowed'
    const headerIconButtonBase = `${headerButtonBase} is-icon-only`
    const headerButtonTone = {
        frame:
            activeGenerationStatus === 'pending'
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                : batchFrameFailed || (sb.frameStatus === 'failed' && !frameReady)
                  ? 'border-red-500/40 bg-red-500/15 text-red-100 hover:bg-red-500/35 hover:border-red-500/60'
                  : frameSucceeded
                    ? 'border-green-500/40 bg-green-500/15 text-green-100 hover:bg-green-500/25 hover:border-green-500/60'
                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:border-purple-500/80 hover:text-white hover:shadow-[0_0_12px_rgba(168,85,247,0.3)]',
        video: videoFailure.failed
            ? 'border-red-500/40 bg-red-500/15 text-red-100 hover:bg-red-500/35 hover:border-red-500/60'
            : sb.videoUrl || activeGenerationStatus === 'video_done'
              ? 'border-blue-500/40 bg-blue-500/15 text-blue-100 hover:bg-blue-500/35 hover:border-blue-500/60'
              : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:border-blue-500/80 hover:text-white hover:shadow-[0_0_12px_rgba(59,130,246,0.3)]',
        compose:
            sb.composeStatus === 'failed' && !sb.composedVideoUrl
                ? 'border-red-500/40 bg-red-500/15 text-red-100 hover:bg-red-500/35 hover:border-red-500/60'
                : sb.composedVideoUrl
                  ? 'border-pink-500/40 bg-pink-500/15 text-pink-100 hover:bg-pink-500/35 hover:border-pink-500/60'
                  : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:border-pink-500/80 hover:text-white hover:shadow-[0_0_12px_rgba(236,72,153,0.3)]'
    }
    const frameHeaderActionLabel = t(
        frameGenerating
            ? '点击停止插图生成（若卡住可重置）'
            : submittingFrame
              ? '正在提交插图生成请求，请稍候'
              : activeGenerationStatus === 'pending'
                ? t('排队中（等待生成名额）')
                : batchFrameFailed
                  ? (batchFailureMessage ?? t('插图生成失败'))
                  : sb.frameStatus === 'failed' && !frameReady
                    ? (frameError?.errorMsg ?? t('插图生成失败'))
                    : batchFrameReady
                      ? t('主插图已生成')
                      : frameReady
                        ? '重新生成插图'
                        : '生成插图'
    )
    const videoHeaderActionLabel = t(
        submittingVideo
            ? '正在准备中，请稍候'
            : videoFailure.failed
              ? videoFailure.message
              : videoBlockedReason
                ? videoBlockedReason
                : videoQueued
                  ? '视频已排队，将在前面的任务完成后自动开始'
                  : sb.videoStatus === 'generating'
                    ? '视频生成中'
                    : sb.videoUrl
                      ? '重新生成视频'
                      : '生成视频'
    )

    async function generateHeaderIllustrations() {
        if (frameGenerating || batchBusy || submittingFrame) return
        if (!(await canStartGeneration('image'))) return
        setSubmittingFrame(true)
        try {
            await saveBeforeGenerate()
            await onGenerate('illustrations', videoProvider, undefined, imageProvider, imageQuality, illustrationCount)
        } finally {
            onReleaseGenerationCapacity('image')
            setSubmittingFrame(false)
        }
    }

    function openReferenceVideoPicker() {
        if (!referenceVideosSupported) {
            pushToast('error', `${selectedVideoCapability?.label ?? videoProvider} 不支持视频作为参考素材`)
            return
        }
        if (referenceVideos.length >= referenceVideoLimit) {
            pushToast('info', `每个分镜最多上传 ${referenceVideoLimit} 个参考视频`)
            return
        }
        referenceVideoInputRef.current?.click()
    }

    async function uploadReferenceVideos(files: FileList | null) {
        if (!files?.length || uploadingReferenceVideo) return
        if (!referenceVideosSupported) {
            pushToast('error', `${selectedVideoCapability?.label ?? videoProvider} 不支持视频作为参考素材`)
            return
        }
        const selected = Array.from(files)
        if (referenceVideoInputRef.current) referenceVideoInputRef.current.value = ''
        const remaining = referenceVideoLimit - referenceVideos.length
        if (selected.length > remaining) {
            pushToast('error', t('当前还能上传 {remaining} 个参考视频，每个分镜最多 {limit} 个', { remaining, limit: referenceVideoLimit }))
            return
        }
        const invalid = selected.find(file => !resolveReferenceVideoMimeType(file.type, file.name) || file.size > MAX_REFERENCE_VIDEO_BYTES)
        if (invalid) {
            pushToast('error', invalid.size > MAX_REFERENCE_VIDEO_BYTES ? `${invalid.name} 超过 300MB` : `${invalid.name} 不是支持的 MP4、MOV 或 WebM 视频`)
            return
        }

        setUploadingReferenceVideo(true)
        try {
            const selectedDurations = await Promise.all(selected.map(readBrowserVideoDuration))
            const durationCandidates = selected.flatMap((file, index) => {
                const durationSeconds = selectedDurations[index]
                return durationSeconds === null ? [] : [{ name: file.name, durationSeconds }]
            })
            const pendingDurationViolation = getReferenceVideoDurationViolation([...referenceVideos, ...durationCandidates], referenceVideoDurationRule)
            if (pendingDurationViolation) {
                pushToast('error', formatReferenceVideoDurationViolation(selectedVideoCapability?.label ?? videoProvider, pendingDurationViolation))
                return
            }
            let latest = referenceVideos
            for (const file of selected) {
                const form = new FormData()
                form.set('provider', videoProvider)
                form.set('file', file)
                const response = await clientFetch(`/api/storyboards/${sb.id}/reference-videos`, { method: 'POST', body: form, timeoutMs: 120_000 })
                const json = (await readApiJson(response)) as { success?: boolean; error?: string; data?: { referenceVideos?: unknown } }
                if (!response.ok || !json.success) throw new Error(json.error ?? '参考视频上传失败')
                latest = parseStoryboardReferenceVideos(json.data?.referenceVideos)
                setReferenceVideos(latest)
            }
            pushToast('success', `已上传 ${selected.length} 个参考视频`)
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '参考视频上传失败')
        } finally {
            setUploadingReferenceVideo(false)
            if (referenceVideoInputRef.current) referenceVideoInputRef.current.value = ''
        }
    }

    async function deleteReferenceVideo(assetId: string) {
        if (deletingReferenceVideoId) return
        setDeletingReferenceVideoId(assetId)
        try {
            const response = await clientFetch(`/api/storyboards/${sb.id}/reference-videos`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assetId })
            })
            const json = (await readApiJson(response)) as { success?: boolean; error?: string; data?: { referenceVideos?: unknown; cleanupWarning?: string | null } }
            if (!response.ok || !json.success) throw new Error(json.error ?? '参考视频删除失败')
            setReferenceVideos(parseStoryboardReferenceVideos(json.data?.referenceVideos))
            pushToast('success', json.data?.cleanupWarning ? `参考视频已移除；${json.data.cleanupWarning}` : '参考视频已移除')
        } catch (error) {
            pushToast('error', error instanceof Error ? error.message : '参考视频删除失败')
        } finally {
            setDeletingReferenceVideoId(null)
        }
    }

    async function generateVideo(referenceMode: VideoReferenceMode = videoReferenceMode) {
        if (submittingVideo) return
        if (referenceVideos.length > 0 && !referenceVideosSupported) {
            pushToast('error', `${selectedVideoCapability?.label ?? videoProvider} 不支持视频作为参考素材，请删除参考视频或更换模型`)
            return
        }
        if (referenceVideoDurationViolation) {
            pushToast('error', referenceVideoDurationError)
            return
        }
        const referencesReady = referenceMode === 'text' || (referenceMode === 'single' ? hasOpeningFrame : hasOpeningFrame && hasEndingFrame)
        if (!referencesReady || sb.videoStatus === 'generating') return
        if (!(await canStartGeneration('video'))) return
        setSubmittingVideo(true)
        try {
            await saveBeforeGenerate()
            await onGenerate('video', videoProvider, referenceMode)
        } finally {
            onReleaseGenerationCapacity('video')
            setSubmittingVideo(false)
        }
    }

    async function generateHeaderVideo() {
        await generateVideo()
    }

    async function regenerateFrame(type: 'first_frame' | 'last_frame') {
        if (!(await canStartGeneration('image'))) return
        try {
            await onGenerate(type, videoProvider, undefined, imageProvider, imageQuality)
        } finally {
            onReleaseGenerationCapacity('image')
        }
    }

    async function regenerateMiddleFrame(frameId: string) {
        if (!(await canStartGeneration('image'))) return
        try {
            await onRegenerateMiddleFrame(frameId, videoProvider, imageProvider, imageQuality)
        } finally {
            onReleaseGenerationCapacity('image')
        }
    }

    return (
        <div
            id={`shot-${sb.id}`}
            className={`studio-shot ${expanded ? 'is-expanded' : ''}`}>
            {/* 分镜头部 */}
            <div
                className="studio-shot-header"
                onClick={onToggle}>
                <div className="studio-shot-copy">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-purple-500/10 px-2 py-1 text-[11px] font-semibold tracking-wide text-purple-200 ring-1 ring-inset ring-purple-400/15">
                            {String(idx + 1).padStart(2, '0')}
                        </span>

                        {sb.dialogue && (
                            <span
                                data-i18n-skip
                                title={sb.dialogue}
                                className="min-w-0 truncate text-sm text-slate-200">
                                {sb.dialogue}
                            </span>
                        )}
                        {sb.actionDesc && !sb.dialogue && (
                            <span
                                data-i18n-skip
                                title={extractStoryboardBoundaryStates(sb.actionDesc).endingState ?? sb.actionDesc}
                                className="min-w-0 truncate text-sm text-slate-200">
                                {extractStoryboardBoundaryStates(sb.actionDesc).endingState ?? sb.actionDesc}
                            </span>
                        )}
                    </div>
                </div>
                {/* 快捷操作 */}
                <div
                    className="studio-shot-actions"
                    onClick={event => event.stopPropagation()}>
                    <button
                        type="button"
                        onClick={frameGenerating ? () => onCancelGenerate('frame') : generateHeaderIllustrations}
                        disabled={(submittingFrame && !frameGenerating) || (batchBusy && !batchFrameRunning)}
                        aria-label={frameHeaderActionLabel}
                        title={frameHeaderActionLabel}
                        className={`${headerIconButtonBase} ${
                            frameGenerating
                                ? 'border-yellow-500/50 bg-yellow-500/15 text-yellow-200 hover:bg-yellow-500/30'
                                : submittingFrame
                                  ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                                  : headerButtonTone.frame
                        } ${frameGenerating || submittingFrame || activeGenerationStatus === 'pending' || frameSucceeded ? 'is-status' : ''}`}>
                        {frameGenerating || submittingFrame ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : activeGenerationStatus === 'pending' ? (
                            <RefreshCw className="h-4 w-4" />
                        ) : frameSucceeded ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <ImageIcon className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        type="button"

                        onClick={generateHeaderVideo}
                        disabled={batchBusy || !canGenerateVideo || sb.videoStatus === 'generating' || submittingVideo}
                        aria-label={videoHeaderActionLabel}
                        title={videoHeaderActionLabel}
                        className={`${headerIconButtonBase} ${
                            videoGenerating ? 'border-purple-500/50 bg-purple-500/15 text-purple-100' : videoQueued ? 'border-amber-500/50 bg-amber-500/15 text-amber-200' : headerButtonTone.video
                        } ${videoGenerating || videoQueued ? 'is-status' : ''}`}>
                        {videoGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                    </button>
                    {!selectedProviderUsesEmbeddedAudio && (
                        <button
                            type="button"

                            onClick={onCompose}
                            disabled={!sb.videoUrl || sb.composeStatus === 'processing'}
                            title={!sb.videoUrl ? '需先生成视频' : sb.composeStatus === 'processing' ? '合成中' : sb.composedVideoUrl ? '重新合成' : '合成'}
                            className={`${headerButtonBase} ${headerButtonTone.compose}`}>
                            {sb.composeStatus === 'processing' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                            <span className="hidden sm:inline">合成</span>
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`shot-body-${sb.id}`}
                    aria-label={`${expanded ? t('收起') : t('展开')} ${t('镜头')} ${sb.order}`}
                    onClick={event => {
                        event.stopPropagation()
                        onToggle()
                    }}
                    className="studio-shot-toggle flex shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 hover:text-gray-200">
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
            </div>

            {/* 展开内容 */}
            {expanded && (
                <div
                    id={`shot-body-${sb.id}`}
                    className="border-t border-gray-800 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 左侧：插图展示 + 编辑区 */}
                    <div className="space-y-3">
                        <div className="border border-gray-800 rounded-lg overflow-hidden">
                            <div className="bg-gray-800/40 px-3 py-2 flex items-center gap-2">
                                <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-xs text-gray-300 font-medium">{t('参考素材')}</span>
                                <span
                                    className="ms-auto inline-flex items-center gap-2 text-[10px] text-gray-500"
                                    aria-label={`${t('插图')} ${illustrations.length}，${t('参考视频')} ${referenceVideos.length}/${referenceVideoLimit || MAX_STORYBOARD_REFERENCE_VIDEOS}`}>
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="h-3 w-3" /> {illustrations.length}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="h-3 w-3" /> {referenceVideos.length}/{referenceVideoLimit || MAX_STORYBOARD_REFERENCE_VIDEOS}
                                    </span>
                                </span>
                            </div>
                            <div className="p-3">
                                <input
                                    ref={referenceVideoInputRef}
                                    type="file"
                                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                                    multiple
                                    className="hidden"
                                    onChange={event => void uploadReferenceVideos(event.currentTarget.files)}
                                />
                                <div className="flex flex-wrap gap-2">
                                    {illustrations.length > 0 ? (
                                        <>
                                            {illustrations.map(frame => (
                                                <div
                                                    key={frame.id}
                                                    className="w-24 sm:w-28">
                                                    <div className="relative aspect-[9/16] w-full overflow-hidden rounded border border-gray-800 bg-black transition-colors hover:border-purple-500">
                                                        <button
                                                            type="button"
                                                            onClick={() => setPreviewUrl(frame.url)}
                                                            className="group relative block h-full w-full">
                                                            <OptimizedMediaImage
                                                                src={frame.url}
                                                                alt={frame.label}
                                                                fill
                                                                sizes="112px"
                                                                quality={75}
                                                                loading="lazy"
                                                                className="h-full w-full object-cover"
                                                            />
                                                            <span
                                                                className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] text-white ${
                                                                    frame.type === 'first_frame' ? 'bg-purple-600/90' : frame.type === 'last_frame' ? 'bg-pink-600/90' : 'bg-cyan-600/90'
                                                                }`}>
                                                                {frame.label}
                                                            </span>
                                                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-colors group-hover:bg-black/30 group-hover:opacity-100">
                                                                <span className="rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">点击放大</span>
                                                            </span>
                                                        </button>
                                                        {(frame.type === 'first_frame' || frame.type === 'last_frame') &&
                                                            !frameGenerating &&
                                                            (() => {
                                                                const canDelete = videoReferenceMode === 'text' || (videoReferenceMode === 'single' && illustrations.length > 1)
                                                                return canDelete ? (
                                                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1 pb-1 pt-7">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => void regenerateFrame(frame.type as 'first_frame' | 'last_frame')}
                                                                            title={`单独重新生成${frame.label}`}
                                                                            aria-label={`单独重新生成${frame.label}`}
                                                                            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border border-white/20 bg-black/65 text-gray-200 shadow-sm backdrop-blur-sm transition-colors hover:border-purple-300/70 hover:bg-purple-600/80 hover:text-white">
                                                                            <RefreshCw className="h-3.5 w-3.5" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => onDeleteFrame(frame)}
                                                                            title={`删除${frame.label}`}
                                                                            aria-label={`删除${frame.label}`}
                                                                            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border border-red-300/35 bg-red-950/70 text-red-200 shadow-sm backdrop-blur-sm transition-colors hover:border-red-200/80 hover:bg-red-600/85 hover:text-white">
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void regenerateFrame(frame.type as 'first_frame' | 'last_frame')}
                                                                        title={`单独重新生成${frame.label}`}
                                                                        aria-label={`单独重新生成${frame.label}`}
                                                                        className="pointer-events-auto absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-white/20 bg-black/65 text-gray-200 shadow-sm backdrop-blur-sm transition-colors hover:border-purple-300/70 hover:bg-purple-600/80 hover:text-white">
                                                                        <RefreshCw className="h-3.5 w-3.5" />
                                                                    </button>
                                                                )
                                                            })()}
                                                        {frame.type === 'middle_frame' && !frameGenerating && (
                                                            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1 pb-1 pt-7">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void regenerateMiddleFrame(frame.id)}
                                                                    title={`参考前后插图重新生成${frame.label}`}
                                                                    aria-label={`参考前后插图重新生成${frame.label}`}
                                                                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border border-white/20 bg-black/65 text-gray-200 shadow-sm backdrop-blur-sm transition-colors hover:border-purple-300/70 hover:bg-purple-600/80 hover:text-white">
                                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onDeleteMiddleFrame(frame)}
                                                                    title={`删除${frame.label}`}
                                                                    aria-label={`删除${frame.label}`}
                                                                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md border border-red-300/35 bg-red-950/70 text-red-200 shadow-sm backdrop-blur-sm transition-colors hover:border-red-200/80 hover:bg-red-600/85 hover:text-white">
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            {frameGenerating && (
                                                <div className="relative flex aspect-[9/16] w-24 flex-col items-center justify-center gap-2 overflow-hidden rounded border border-dashed border-purple-500/40 bg-gray-950 text-[11px] text-purple-300 sm:w-28">
                                                    <RefreshCw className="h-5 w-5 animate-spin" />
                                                    <span>继续生成中</span>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="flex aspect-[9/16] w-24 items-center justify-center rounded border border-dashed border-gray-800 bg-gray-950 text-center text-xs text-gray-600 sm:w-28">
                                            {frameGenerating ? (
                                                <div className="flex flex-col items-center gap-2 text-purple-300">
                                                    <RefreshCw className="h-5 w-5 animate-spin text-purple-400" />
                                                    <span>生成中</span>
                                                </div>
                                            ) : activeGenerationStatus === 'pending' ? (
                                                <span className="text-gray-400">等待生成</span>
                                            ) : (
                                                '还没有插图'
                                            )}
                                        </div>
                                    )}
                                    {referenceVideos.map((video, index) => (
                                        <div
                                            key={video.id}
                                            className="w-24 space-y-1 sm:w-28">
                                            <button
                                                type="button"
                                                onClick={() => setPreviewVideoUrl(video.url)}
                                                className="group relative block aspect-[9/16] w-full overflow-hidden rounded border border-blue-500/30 bg-black transition-colors hover:border-blue-400"
                                                title={`预览 ${video.name}`}>
                                                <video
                                                    src={video.url}
                                                    muted
                                                    preload="metadata"
                                                    playsInline
                                                    className="h-full w-full object-cover"
                                                />
                                                <span className="absolute left-1.5 top-1.5 rounded bg-blue-600/90 px-1.5 py-0.5 text-[10px] text-white">参考视频 {index + 1}</span>
                                                <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/35">
                                                    <Play className="h-5 w-5 fill-white text-white drop-shadow" />
                                                </span>
                                                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{video.durationSeconds.toFixed(1)}s</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void deleteReferenceVideo(video.id)}
                                                disabled={deletingReferenceVideoId === video.id}
                                                aria-label={`删除参考视频 ${video.name}`}
                                                className="flex w-full items-center justify-center gap-1 rounded border border-red-900/50 bg-red-950/20 py-0.5 text-[10px] text-red-300/80 transition-colors hover:bg-red-700/70 hover:text-white disabled:opacity-40">
                                                {deletingReferenceVideoId === video.id ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
                                                删除
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={openReferenceVideoPicker}
                                        disabled={uploadingReferenceVideo}
                                        aria-label="上传参考视频"
                                        aria-describedby={`reference-video-hint-${sb.id}`}
                                        title={referenceVideoUploadHint}
                                        className={`relative flex aspect-[9/16] w-24 shrink-0 self-start flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-1.5 pb-10 text-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-wait disabled:opacity-60 sm:w-28 ${
                                            !referenceVideosSupported
                                                ? 'border-gray-700 bg-gray-950/60 text-gray-500 hover:border-amber-500/50 hover:text-amber-300'
                                                : referenceVideoLimitReached
                                                  ? 'border-amber-500/40 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10'
                                                  : 'border-blue-500/40 bg-blue-500/5 text-blue-300 hover:border-blue-400 hover:bg-blue-500/10'
                                        }`}>
                                        {uploadingReferenceVideo ? (
                                            <RefreshCw
                                                className="h-5 w-5 animate-spin"
                                                aria-hidden="true"
                                            />
                                        ) : referenceVideoLimitReached ? (
                                            <AlertCircle
                                                className="h-5 w-5"
                                                aria-hidden="true"
                                            />
                                        ) : (
                                            <Upload
                                                className="h-5 w-5"
                                                aria-hidden="true"
                                            />
                                        )}
                                        <span className="text-[11px] font-medium">{uploadingReferenceVideo ? t('上传中...') : referenceVideoLimitReached ? t('已达上传上限') : t('上传视频')}</span>
                                        <span
                                            aria-hidden="true"
                                            className="studio-reference-upload-hint absolute inset-x-1 bottom-2 space-y-0.5 text-slate-400">
                                            {referenceVideosSupported ? (
                                                <>
                                                    <span
                                                        data-i18n-skip
                                                        className="block whitespace-nowrap"
                                                        dir="ltr">
                                                        MP4 · MOV · WebM
                                                    </span>
                                                    <span
                                                        data-i18n-skip
                                                        className="block whitespace-nowrap"
                                                        dir="ltr">
                                                        ≤300MB{referenceVideoDurationRule ? ` · ${referenceVideoDurationRule.min}–${referenceVideoDurationRule.max}s` : ''}
                                                    </span>
                                                </>
                                            ) : (
                                                t('不支持参考视频')
                                            )}
                                        </span>
                                        <span
                                            id={`reference-video-hint-${sb.id}`}
                                            className="sr-only">
                                            {referenceVideoUploadHint}
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            aria-haspopup="dialog"
                            ref={settingsTriggerRef}
                            aria-controls={`shot-${sb.id}-settings`}
                            aria-expanded={showShotSettings}
                            onClick={() => setShowShotSettings(true)}
                            className="group flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2.5 text-start transition-colors hover:border-purple-500/40 hover:bg-gray-800/60 focus:outline-none focus-visible:border-purple-400">
                            <Settings className="h-4 w-4 flex-shrink-0 text-purple-400" />
                            <span className="shrink-0 text-xs font-medium text-gray-200 group-hover:text-white">{t('分镜设置')}</span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
                                {scenes.find(scene => scene.id === localData.sceneId)?.name ?? t('无')} · {t('出场角色')} {localData.characterIds.length}
                            </span>
                            {dirty && <span className="shrink-0 text-[10px] text-amber-400">{t('修改尚未保存')}</span>}
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-600 transition-colors group-hover:text-purple-300" />
                        </button>

                        {showShotSettings &&
                            createPortal(
                                <div
                                    className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/80 px-4 py-6 backdrop-blur-sm"
                                    onMouseDown={event => {
                                        if (event.target === event.currentTarget) setShowShotSettings(false)
                                    }}>
                                    <div
                                        ref={settingsDialogRef}
                                        id={`shot-${sb.id}-settings`}
                                        role="dialog"
                                        aria-modal="true"
                                        aria-labelledby={`shot-${sb.id}-settings-title`}
                                        tabIndex={-1}
                                        className="flex max-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-purple-500/30 bg-gray-950 shadow-2xl shadow-black/70 focus:outline-none">
                                        <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/80 px-5 py-4">
                                            <div className="min-w-0 flex-1">
                                                <h2
                                                    id={`shot-${sb.id}-settings-title`}
                                                    className="text-sm font-semibold text-white">
                                                    {t('分镜设置')} · {t('镜头')} {String(idx + 1).padStart(2, '0')}
                                                </h2>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowShotSettings(false)}
                                                aria-label={t('关闭')}
                                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-800 hover:text-white">
                                                <CloseIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="novel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 [color-scheme:dark]">
                                            <fieldset
                                                disabled={savingShotSettings}
                                                className="min-w-0 space-y-5">
                                                <div className="grid grid-cols-1 gap-5">
                                                    <ShotSettingsField
                                                        id={`shot-${sb.id}-dialogue-editor`}
                                                        title="台词（角色名: 台词内容）">
                                                        <AutoGrowTextarea
                                                            id={`shot-${sb.id}-dialogue`}
                                                            aria-label={t('台词（角色名: 台词内容）')}
                                                            value={localData.dialogue}
                                                            onChange={e => setLocalData({ ...localData, dialogue: e.target.value })}
                                                            onCompositionStart={() => setIsComposing(true)}
                                                            onCompositionEnd={() => setIsComposing(false)}
                                                            placeholder="林晓薇: 你终于来了..."
                                                            minRows={2}
                                                            maxRows={5}
                                                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm leading-relaxed text-white focus:border-purple-500 focus:outline-none"
                                                        />
                                                    </ShotSettingsField>

                                                    <ShotSettingsField
                                                        id={`shot-${sb.id}-action-editor`}
                                                        title="动作描述"

                                                        toolbar={<></>}>
                                                        <AutoGrowTextarea
                                                            aria-label="动作描述"
                                                            value={localData.actionDesc}
                                                            onChange={e => setLocalData({ ...localData, actionDesc: e.target.value })}
                                                            onCompositionStart={() => setIsComposing(true)}
                                                            onCompositionEnd={() => setIsComposing(false)}
                                                            placeholder="林晓薇缓缓走向陈默..."
                                                            minRows={3}
                                                            maxRows={7}
                                                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm leading-relaxed text-white focus:border-purple-500 focus:outline-none"
                                                        />
                                                    </ShotSettingsField>

                                                    <ShotSettingsField
                                                        id={`shot-${sb.id}-image-prompt-editor`}
                                                        title="图像描述"

                                                        toolbar={<></>}>
                                                        <AutoGrowTextarea
                                                            id={`shot-${sb.id}-imagePrompt`}
                                                            aria-label="图像描述"
                                                            value={localData.imagePrompt}
                                                            onChange={e => setLocalData({ ...localData, imagePrompt: e.target.value })}
                                                            onCompositionStart={() => setIsComposing(true)}
                                                            onCompositionEnd={() => setIsComposing(false)}
                                                            placeholder="描述画面内容，如：灵汐身穿流光羽衣，赤足踩云，金铃系腕，脚下绽出金莲..."
                                                            minRows={3}
                                                            maxRows={7}
                                                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm leading-relaxed text-white focus:border-purple-500 focus:outline-none"
                                                        />
                                                    </ShotSettingsField>
                                                </div>

                                                <div className="flex gap-2">
                                                    <div className="flex-1">
                                                        <label className="text-xs text-gray-500 block mb-1">{t('场景')}</label>
                                                        <CustomSelect
                                                            ariaLabel="分镜场景"
                                                            searchable
                                                            value={localData.sceneId}
                                                            onChange={sceneId => setLocalData({ ...localData, sceneId })}
                                                            buttonClassName="py-1.5 text-xs"
                                                            options={[
                                                                { value: '', label: scenes.length === 0 ? '项目暂无场景，先提取或添加' : '无' },
                                                                ...scenes.map(scene => ({ value: scene.id, label: scene.name }))
                                                            ]}
                                                        />
                                                        {scenes.length === 0 && (
                                                            <p className="mt-1.5 text-[11px] text-yellow-500">
                                                                场景来自项目场景库。先到{' '}
                                                                <Link
                                                                    href={`/projects/${projectId}?tab=novel&stage=finalized`}
                                                                    className="underline decoration-yellow-500/50 underline-offset-2 hover:text-yellow-300">
                                                                    小说页提取角色和场景
                                                                </Link>
                                                                ，或到{' '}
                                                                <Link
                                                                    href={`/projects/${projectId}?tab=scenes`}
                                                                    className="underline decoration-yellow-500/50 underline-offset-2 hover:text-yellow-300">
                                                                    场景库
                                                                </Link>
                                                                手动添加。
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <div>
                                                    <div className="text-xs text-gray-400">
                                                        {t('出场角色')} <span className="ms-1 text-purple-300">{localData.characterIds.length}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 mt-2 p-2 bg-gray-950 border border-gray-800 rounded">
                                                        {characters.map(c => (
                                                            <label
                                                                key={c.id}
                                                                className="flex items-center gap-1.5 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={localData.characterIds.includes(c.id)}
                                                                    onChange={e => {
                                                                        const ids = e.target.checked ? [...localData.characterIds, c.id] : localData.characterIds.filter(id => id !== c.id)
                                                                        setLocalData({ ...localData, characterIds: ids })
                                                                    }}
                                                                    className="rounded accent-purple-500"
                                                                />
                                                                <span className="text-xs text-gray-300">{c.name}</span>
                                                                {!c.appearancePrompt && (
                                                                    <span
                                                                        className="text-xs text-yellow-500"
                                                                        title="缺外貌描述">
                                                                        ⚠️
                                                                    </span>
                                                                )}
                                                            </label>
                                                        ))}
                                                        {characters.length === 0 && (
                                                            <div className="text-xs text-gray-500 leading-relaxed">
                                                                项目暂无角色。先到{' '}
                                                                <Link
                                                                    href={`/projects/${projectId}?tab=novel&stage=finalized`}
                                                                    className="text-yellow-400 underline decoration-yellow-500/50 underline-offset-2 hover:text-yellow-300">
                                                                    小说页提取角色和场景
                                                                </Link>
                                                                ，或到{' '}
                                                                <Link
                                                                    href={`/projects/${projectId}?tab=characters`}
                                                                    className="text-yellow-400 underline decoration-yellow-500/50 underline-offset-2 hover:text-yellow-300">
                                                                    角色库
                                                                </Link>
                                                                手动添加。
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </fieldset>
                                        </div>
                                        <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-gray-900/60 px-5 py-3">
                                            <button
                                                type="button"
                                                onClick={() => setShowShotSettings(false)}
                                                className="rounded-lg border border-gray-700 px-5 py-2 text-xs text-gray-300 transition-colors hover:bg-gray-800 focus-visible:outline-purple-400">
                                                {t('关闭')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void save()}
                                                disabled={!dirty || savingShotSettings}
                                                className="rounded-lg bg-purple-600 px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50">
                                                {savingShotSettings ? t('保存中...') : savedFlash ? t('✓ 已保存') : t('保存')}
                                            </button>
                                        </div>
                                    </div>
                                </div>,
                                document.body
                            )}
                    </div>

                    {/* 右侧：三步生成流水线 */}
                    <div className="space-y-4">
                        {/* 参考素材：角色 + 场景 */}
                        <div>
                            <div className="mb-1.5 flex items-start justify-between gap-2">
                                <label className="min-w-0 text-xs text-gray-500">本镜参考素材（影响一致性）</label>
                                <button
                                    type="button"
                                    onClick={() => void onDelete()}
                                    disabled={deleting}
                                    aria-busy={deleting}
                                    className="inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-red-600 px-2 text-xs font-medium text-white [--app-action-danger:#e52222] transition-colors hover:bg-red-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-red-400 disabled:cursor-wait disabled:opacity-50">
                                    {deleting ? (
                                        <RefreshCw
                                            aria-hidden="true"
                                            className="h-3 w-3 animate-spin"
                                        />
                                    ) : (
                                        <Trash2
                                            aria-hidden="true"
                                            className="h-3 w-3"
                                        />
                                    )}
                                    <span>{deleting ? t('正在删除…') : t('删除分镜')}</span>
                                </button>
                            </div>
                            <div className="flex gap-2 flex-wrap items-start">
                                {sb.characters.map(sc => (
                                    <div
                                        key={sc.character.id}
                                        className="flex flex-col items-center">
                                        <div className={`w-14 h-14 rounded-lg overflow-hidden border ${sc.character.referenceImageUrl ? 'border-gray-700' : 'border-yellow-500/40'}`}>
                                            {sc.character.referenceImageUrl ? (
                                                <OptimizedMediaImage
                                                    src={sc.character.referenceImageUrl}
                                                    alt={sc.character.name}
                                                    width={56}
                                                    height={56}
                                                    sizes="56px"
                                                    quality={65}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div
                                                    className="w-full h-full flex items-center justify-center text-yellow-500 text-sm bg-gray-800"
                                                    title="角色未生成参考图">
                                                    ⚠
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1 max-w-14 truncate">{sc.character.name}</p>
                                    </div>
                                ))}
                                {sb.scene && (
                                    <div className="flex flex-col items-center">
                                        <div
                                            className={`w-14 h-14 rounded-lg overflow-hidden border ${sb.scene.referenceImageUrl ? 'border-gray-700' : 'border-yellow-500/40'} bg-gray-800 flex items-center justify-center`}>
                                            {sb.scene.referenceImageUrl ? (
                                                <OptimizedMediaImage
                                                    src={sb.scene.referenceImageUrl}
                                                    alt={sb.scene.name}
                                                    width={56}
                                                    height={56}
                                                    sizes="56px"
                                                    quality={65}
                                                    loading="lazy"
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <span className="text-[10px] text-purple-400">场景</span>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1 max-w-14 truncate">{sb.scene.name}</p>
                                    </div>
                                )}
                                {sb.characters.length === 0 &&
                                    !sb.scene &&
                                    (characters.length === 0 && scenes.length === 0 ? (
                                        <div className="text-xs leading-relaxed text-yellow-500">
                                            项目角色库/场景库还是空的。先去{' '}
                                            <Link
                                                href={`/projects/${projectId}?tab=novel&stage=finalized`}
                                                className="underline decoration-yellow-500/50 underline-offset-2 hover:text-yellow-300">
                                                提取角色和场景
                                            </Link>
                                            ，再重新生成或手动绑定本镜。
                                        </div>
                                    ) : (
                                        <p className="text-xs text-yellow-500">本镜未选角色/场景 → 一致性会很差</p>
                                    ))}
                            </div>
                        </div>

                        {/* 步骤 1：插图生成 */}
                        <div className="border border-gray-800 rounded-lg overflow-hidden">
                            <div className="flex flex-wrap items-center gap-2 bg-gray-800/40 px-3 py-2">
                                <span className="w-5 h-5 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">1</span>
                                <span className="text-xs text-gray-300 font-medium">生成插图</span>
                                {showFrameStepStatus && (
                                    <span
                                        className={`text-[10px] ${
                                            frameGenerating
                                                ? 'text-yellow-400'
                                                : submittingFrame
                                                  ? 'text-blue-300'
                                                  : activeGenerationStatus === 'pending'
                                                    ? 'text-blue-300'
                                                    : sb.frameStatus === 'failed'
                                                      ? 'text-red-400'
                                                      : 'text-gray-500'
                                        }`}
                                        title={sb.frameStatus === 'failed' ? frameError?.errorMsg : undefined}>
                                        {frameGenerating
                                            ? illustrations.length > 0
                                                ? `已生成 ${illustrations.length} 张，继续生成中...`
                                                : '生成中...'
                                            : submittingFrame
                                              ? '提交中...'
                                              : activeGenerationStatus === 'pending'
                                                ? '等待生成'
                                                : sb.frameStatus === 'failed'
                                                  ? '失败 (悬停查看)'
                                                  : '未生成'}
                                    </span>
                                )}
                                <div className="ms-auto flex min-w-0 items-center gap-2 text-[10px] text-gray-400">
                                    <span className="shrink-0 text-gray-500">图片模型</span>
                                    <CustomSelect
                                        ariaLabel="图片模型"
                                        value={imageProvider}
                                        onChange={value => {
                                            setShotImageProviderTouched(true)
                                            setImageProvider(value as ImageProvider)
                                        }}
                                        disabled={frameGenerating || submittingFrame}
                                        className="w-36 shrink-0"
                                        buttonClassName="py-1 text-[11px]"
                                        options={[
                                            { value: 'banana', label: 'Nano Banana' },
                                            { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
                                            { value: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite' },
                                            { value: 'qwen-image-3.0-pro', label: 'Qwen-Image-3.0-Pro' }
                                        ]}
                                    />
                                    <span className="shrink-0 text-gray-500">插图</span>
                                    <div
                                        role="group"
                                        aria-label="插图张数"
                                        className="flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-gray-700 bg-gray-800 text-[11px]">
                                        <button
                                            type="button"
                                            aria-label="减少插图张数"
                                            title="减少插图张数"
                                            disabled={frameGenerating || submittingFrame || illustrationCount <= 1}
                                            onClick={() => setIllustrationCount(Math.max(1, illustrationCount - 1))}
                                            className="flex h-full w-7 items-center justify-center border-e border-gray-700 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35">
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span className="min-w-10 px-2 text-center font-medium tabular-nums text-gray-100">{illustrationCount} 张</span>
                                        <button
                                            type="button"
                                            aria-label="增加插图张数"
                                            title={`增加插图张数（最多 ${MAX_ILLUSTRATION_COUNT} 张）`}
                                            disabled={frameGenerating || submittingFrame || illustrationCount >= MAX_ILLUSTRATION_COUNT}
                                            onClick={() => setIllustrationCount(Math.min(MAX_ILLUSTRATION_COUNT, illustrationCount + 1))}
                                            className="flex h-full w-7 items-center justify-center border-s border-gray-700 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35">
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {sb.frameStatus === 'failed' && frameError?.errorMsg && (
                                <GenerationFailureNotice
                                    errorMessage={frameError.errorMsg}
                                    provider={frameError.provider}
                                    onEdit={() => focusEditor('imagePrompt')}
                                    onRetry={generateHeaderIllustrations}
                                    retryDisabled={frameGenerating}
                                />
                            )}
                            {sb.frameStatus === 'completed' && sb.latestFrameRecovery?.recovery === 'safety_rewrite' && (
                                <div
                                    role="status"
                                    className="flex items-start gap-2 border-t border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-100">
                                    <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-300" />
                                    <span>图片安全提示已自动改写 {sb.latestFrameRecovery.safetyRewriteCount} 次并生成成功，无需手动处理。</span>
                                </div>
                            )}
                            <div className="space-y-2 p-3">
                                {frameGenerating || submittingFrame ? (
                                    <div className={`grid gap-2 ${submittingFrame ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                        <button
                                            disabled
                                            className="flex items-center justify-center gap-1.5 py-2 bg-purple-600/70 text-white text-xs rounded opacity-80">
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            {submittingFrame ? '提交中...' : '生成插图中...'}
                                        </button>
                                        {frameGenerating && (
                                            <button
                                                onClick={() => onCancelGenerate('frame')}
                                                className="flex items-center justify-center gap-1.5 py-2 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded transition-colors">
                                                <XCircle className="w-3.5 h-3.5" />
                                                停止生成
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        onClick={generateHeaderIllustrations}
                                        className="w-full flex items-center justify-center gap-1.5 py-2 studio-primary text-white text-xs rounded transition-colors">
                                        <ImageIcon className="w-3.5 h-3.5" />
                                        {sb.firstFrameUrl || sb.plannedLastFrameUrl || sb.lastFrameUrl ? '重新生成插图' : '生成插图'}
                                    </button>
                                )}
                                {dirty && <p className="text-[10px] text-yellow-400">生成前会自动保存当前分镜设置。</p>}
                            </div>
                        </div>

                        {/* 步骤 2：图生视频 */}
                        <div className="border border-gray-800 rounded-lg overflow-hidden">
                            <div className="bg-gray-800/40 px-3 py-2 flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full ${sb.firstFrameUrl ? 'bg-blue-500' : 'bg-gray-700'} text-white text-[10px] font-bold flex items-center justify-center`}>2</span>
                                <span className="text-xs text-gray-300 font-medium">图生视频</span>
                                <span
                                    className={`ms-auto text-[10px] ${
                                        sb.videoStatus === 'completed' ? 'text-green-400' : sb.videoStatus === 'generating' ? 'text-yellow-400' : videoFailure.failed ? 'text-red-400' : 'text-gray-500'
                                    }`}
                                    title={videoFailure.failed ? videoFailure.message : undefined}>
                                    {sb.videoStatus === 'completed'
                                        ? '已生成'
                                        : videoQueued
                                          ? '排队中（等待生成名额）'
                                          : sb.videoStatus === 'generating'
                                            ? '生成中（3-5 分钟）'
                                            : videoFailure.failed
                                              ? '生成失败'
                                              : !frameReady
                                                ? '需先生成插图'
                                                : '待生成'}
                                </span>
                            </div>
                            {videoFailure.failed && (
                                <GenerationFailureNotice
                                    errorMessage={videoFailure.message}
                                    provider={sb.latestErrors?.video?.provider}
                                    onEdit={() => focusEditor('dialogue')}
                                    onRetry={() => generateVideo()}
                                    retryDisabled={submittingVideo}
                                />
                            )}
                            <div className="p-3 space-y-2">
                                {sb.videoUrl && (
                                    <video
                                        src={sb.videoUrl}
                                        controls
                                        // 只加载元数据，避免控件长期显示 0:00；不会预加载完整视频内容。
                                        preload="metadata"
                                        className="w-full rounded bg-black max-h-48"
                                    />
                                )}

                                <div
                                    role="group"
                                    aria-label="参考方式"
                                    className="inline-flex w-fit rounded-md border border-gray-800 bg-gray-950/40 p-0.5">
                                    {VIDEO_REFERENCE_MODES.map(mode => {
                                        const active = videoReferenceMode === mode.key
                                        const supported = supportsVideoReferenceMode(videoProvider, mode.key)
                                        return (
                                            <button
                                                key={mode.key}
                                                type="button"
                                                onClick={() => supported && setVideoReferenceMode(mode.key)}
                                                disabled={!supported}
                                                className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                                                    !supported ? 'cursor-not-allowed text-gray-700' : active ? 'bg-gray-700/80 text-gray-100' : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'
                                                }`}
                                                title={supported ? mode.hint : `${videoProvider} 当前不支持此参考方式`}>
                                                {mode.label}
                                            </button>
                                        )
                                    })}
                                </div>
                                <div className="flex gap-2">
                                    {SHOW_SHORT_DRAMA_VIDEO_MODEL_CONTROLS && (
                                        <CustomSelect
                                            ariaLabel="视频模型"
                                            value={videoProvider}
                                            onChange={value => {
                                                setShotProviderTouched(true)
                                                const nextProvider = value as ProductionVideoProvider
                                                setVideoProvider(nextProvider)
                                                setLocalData(current => ({ ...current, duration: normalizeVideoDuration(nextProvider, current.duration) }))
                                                if (!supportsVideoReferenceMode(nextProvider, videoReferenceMode)) setVideoReferenceMode('text')
                                                const nextCapability = getVideoProviderCapability(nextProvider)
                                                if (referenceVideos.length > 0 && (nextCapability?.maxVideoReferences ?? 0) === 0) {
                                                    pushToast('info', `${nextCapability?.label ?? nextProvider} 不支持已上传的参考视频，生成前请删除参考视频或更换模型`)
                                                } else {
                                                    const nextDurationViolation = getReferenceVideoDurationViolation(referenceVideos, nextCapability?.referenceVideoDuration)
                                                    if (nextDurationViolation) pushToast('info', formatReferenceVideoDurationViolation(nextCapability?.label ?? nextProvider, nextDurationViolation))
                                                }
                                            }}
                                            disabled={sb.videoStatus === 'generating'}
                                            className="w-56 flex-shrink-0"
                                            buttonClassName="bg-gray-900 py-2 text-[11px]"
                                            options={[
                                                { value: 'seedance25', label: SEEDANCE_25_LABEL },
                                                { value: 'seedance', label: SEEDANCE_20_LABEL },
                                                { value: 'wan3', label: 'Wan 3.0' },
                                                { value: 'wan3prime', label: WAN_3_PRIME_LABEL },
                                                { value: 'seedance-2.0-global', label: 'Seedance 2.0 Global' },
                                                { value: 'seedance-2.5-global', label: 'Seedance 2.5 Global' },
                                                { value: 'MiniMax-H3', label: 'MiniMax H3' }
                                            ]}
                                        />
                                    )}
                                    {sb.videoStatus === 'generating' ? (
                                        <div className="flex flex-1 gap-2">
                                            <button
                                                disabled
                                                className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-white text-xs rounded opacity-80 ${
                                                    videoQueued ? 'bg-amber-600/70' : 'bg-blue-600/70'
                                                }`}>
                                                <RefreshCw className={`w-3.5 h-3.5 ${videoQueued ? '' : 'animate-spin'}`} />
                                                {videoQueued ? '排队中...' : '生成中...'}
                                            </button>
                                            <button
                                                onClick={() => onCancelGenerate('video')}
                                                className="flex flex-1 items-center justify-center gap-1.5 py-2 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded transition-colors">
                                                <XCircle className="w-3.5 h-3.5" />
                                                停止生成
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => void generateVideo()}
                                            disabled={!canGenerateVideo || submittingVideo}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                                            title={submittingVideo ? '正在准备中，请稍候' : videoBlockedReason}>
                                            {submittingVideo ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
                                            {submittingVideo ? '准备中...' : sb.videoUrl ? '重新生成视频' : '生成视频'}
                                        </button>
                                    )}
                                </div>
                                {dirty && <p className="text-[10px] text-yellow-400">生成前会自动保存当前分镜设置。</p>}
                                {videoBlockedReason && <p className="text-[10px] text-yellow-400">{videoBlockedReason}</p>}
                                {videoGenerationNotice && <p className="text-[10px] text-amber-300">{videoGenerationNotice}</p>}
                                <div className="rounded-lg border border-gray-800 bg-gray-950/70">
                                    <button
                                        type="button"
                                        onClick={() => setShowVideoPrompt(v => !v)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-start text-[11px] text-gray-300 hover:bg-gray-900">
                                        <BookOpen className="w-3.5 h-3.5 text-blue-400" />
                                        <span className="font-medium">{t('视频提示词')}</span>
                                        {showVideoPrompt ? <ChevronUp className="ms-auto w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="ms-auto w-3.5 h-3.5 text-gray-500" />}
                                    </button>
                                    {showVideoPrompt && (
                                        <div className="space-y-3 border-t border-gray-800 px-3 py-3">
                                            <div>
                                                <p className="mb-2 text-[10px] text-gray-500">{t('留空则使用分镜动作或画面描述')}</p>
                                                <AutoGrowTextarea
                                                    value={videoPromptDraft}
                                                    onChange={e => setVideoPromptDraft(e.target.value)}
                                                    onCompositionStart={() => setIsComposing(true)}
                                                    onCompositionEnd={() => setIsComposing(false)}
                                                    placeholder={t('描述这个镜头中要发生的动作和画面。')}
                                                    minRows={6}
                                                    maxRows={14}
                                                    spellCheck={false}
                                                    className="w-full rounded border border-gray-800 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-gray-300 focus:border-blue-500 focus:outline-none"
                                                />

                                                <div className="mt-2 flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={saveVideoPrompt}
                                                        disabled={savingVideoPrompt || !videoPromptDirty}
                                                        className="rounded bg-blue-600 px-2.5 py-1.5 text-[11px] text-white transition-colors hover:bg-blue-700 disabled:opacity-40">
                                                        {savingVideoPrompt ? '保存中...' : '保存'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setVideoPromptDraft('')}
                                                        disabled={savingVideoPrompt || !videoPromptDraft}
                                                        className="rounded border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-40">
                                                        清空
                                                    </button>
                                                </div>
                                                <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">{t('修改提示词后，重新生成视频生效。')}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 仅保留给历史上不带音轨的视频 provider；当前视频模型直接使用原视频。 */}
                        {!selectedProviderUsesEmbeddedAudio && (
                            <div className="border border-gray-800 rounded-lg overflow-hidden">
                                <div className="bg-gray-800/40 px-3 py-2 flex items-center gap-2">
                                    <span className={`w-5 h-5 rounded-full ${sb.videoUrl ? 'bg-pink-500' : 'bg-gray-700'} text-white text-[10px] font-bold flex items-center justify-center`}>4</span>
                                    <span className="text-xs text-gray-300 font-medium">单镜成片处理</span>
                                    <span
                                        className={`ms-auto text-[10px] ${
                                            sb.composeStatus === 'completed' || (sb.composeStatus === 'failed' && !!sb.composedVideoUrl)
                                                ? 'text-green-400'
                                                : sb.composeStatus === 'processing'
                                                  ? 'text-yellow-400'
                                                  : sb.composeStatus === 'failed'
                                                    ? 'text-red-400'
                                                    : 'text-gray-500'
                                        }`}>
                                        {embeddedVideoAudio
                                            ? sb.composeStatus === 'completed' && sb.composedVideoUrl === sb.videoUrl
                                                ? '已确认原生视频'
                                                : '待确认原生视频'
                                            : sb.composeStatus === 'completed' || (sb.composeStatus === 'failed' && !!sb.composedVideoUrl)
                                              ? sb.compositionMode === 'audio_mix'
                                                  ? '已混合原声与对白'
                                                  : sb.compositionMode === 'audio_replace'
                                                    ? '已替换对白音轨'
                                                    : '已确认原视频'
                                              : sb.composeStatus === 'processing'
                                                ? '合成中...'
                                                : sb.composeStatus === 'failed'
                                                  ? '失败'
                                                  : !sb.videoUrl
                                                    ? '需先生成视频'
                                                    : '待合成'}
                                    </span>
                                </div>
                                <div className="p-3 space-y-2">
                                    {sb.composeStatus === 'failed' && !sb.composedVideoUrl && sb.latestErrors?.compose?.errorMsg && (
                                        <GenerationFailureNotice
                                            errorMessage={sb.latestErrors.compose.errorMsg}
                                            provider={sb.latestErrors.compose.provider}
                                            onRetry={onCompose}
                                        />
                                    )}
                                    {sb.composedVideoUrl && !embeddedVideoAudio && (
                                        <video
                                            src={sb.composedVideoUrl}
                                            controls
                                            preload="metadata"
                                            className="w-full rounded bg-black max-h-48"
                                        />
                                    )}
                                    <button
                                        onClick={onCompose}
                                        disabled={!sb.videoUrl || sb.composeStatus === 'processing'}
                                        className="w-full flex items-center justify-center gap-1.5 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white text-xs rounded transition-colors">
                                        {sb.composeStatus === 'processing' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                        {embeddedVideoAudio
                                            ? sb.composeStatus === 'processing'
                                                ? '确认中...'
                                                : sb.composedVideoUrl === sb.videoUrl
                                                  ? '重新合成（保留视频内声音）'
                                                  : '合成最新视频（保留视频内声音）'
                                            : sb.composeStatus === 'processing'
                                              ? '合成中...'
                                              : sb.composedVideoUrl
                                                ? '重新合成'
                                                : '生成单镜成片（视频+对白混音）'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {previewUrl && (
                <div
                    className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
                    onClick={() => setPreviewUrl(null)}>
                    <button
                        type="button"
                        onClick={() => setPreviewUrl(null)}
                        className="absolute top-4 right-4 z-10 text-white/80 hover:text-white p-2"
                        aria-label="关闭预览">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                    <div
                        className="relative h-full w-full"
                        onClick={event => event.stopPropagation()}>
                        <OptimizedMediaImage
                            src={previewUrl}
                            alt="frame preview"
                            fill
                            sizes="(max-width: 1024px) 100vw, 1024px"
                            quality={85}
                            loading="eager"
                            className="object-contain rounded shadow-2xl"
                        />
                    </div>
                </div>
            )}
            {previewVideoUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
                    onClick={() => setPreviewVideoUrl(null)}>
                    <button
                        type="button"
                        onClick={() => setPreviewVideoUrl(null)}
                        className="absolute right-4 top-4 p-2 text-white/80 hover:text-white"
                        aria-label="关闭参考视频预览">
                        <CloseIcon className="h-6 w-6" />
                    </button>
                    <video
                        src={previewVideoUrl}
                        controls
                        autoPlay
                        playsInline
                        className="max-h-full max-w-full rounded bg-black shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    />
                </div>
            )}
        </div>
    )
}
