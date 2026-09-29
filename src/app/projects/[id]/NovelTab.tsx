'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clock3, Sparkles, Wand2, Split, UserPlus, CheckCircle2, Lock, Unlock, RefreshCw, Plus, Trash2, Save, ChevronDown, ChevronRight, Upload, Square } from 'lucide-react'
import type { NovelSetup, NovelCharacterInput, EpisodeFormat } from '@/lib/novel'
import { listEpisodeFormats, getEpisodeFormatSpec, parseNovelSetup } from '@/lib/novel'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getPollingDelay } from '@/lib/polling'
import { pollChapterJob, startChapterJob } from '@/lib/chapter-generation-client'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import ModelSwitcher from '@/components/ModelSwitcher'
import WalletBalance from '@/components/WalletBalance'
import StudioSidebarActions from '@/components/StudioSidebarActions'
import ExtractReviewModal from './ExtractReviewModal'
import CustomSelect from '@/components/CustomSelect'
import { useI18n } from '@/i18n/I18nProvider'
import { buildStoryboardGenerationRequest } from '@/lib/storyboard-generation-request'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { createEpisodeContentRequestTracker, isEpisodeContentCurrent } from '@/lib/episode-content-cache'
import { getChapterProgress, getMissingChapterOutlineNumbers, isChapterFinalized, isScriptGenerated } from '@/lib/chapter-progress'
import { runScriptBatch, ScriptRequestError, type ScriptBatchIssue } from '@/lib/script-batch'
import { getGenerationErrorGuidance } from '@/lib/generation-error-guidance'
import GenerationFailureNotice from '@/components/GenerationFailureNotice'
import ScriptRuntimeNotice from '@/components/ScriptRuntimeNotice'
import { resetOutlineProgress } from '@/lib/outline-reset'
import { canonicalProjectGenreLabel, PROJECT_GENRES } from '@/lib/project-genres'

interface ChapterEpisode {
    id: string
    episodeNumber: number
    title: string | null
    synopsis: string | null
    chapterContent: string | null
    script: string | null
    intensity: number | null
    status: string
    finalizedAt: string | null
    staleReason?: string | null
    sourceVersion?: number
    hasChapterContent?: boolean
    hasScript?: boolean
    _count?: { storyboards: number }
}

type EpisodeContent = Pick<ChapterEpisode, 'id' | 'title' | 'synopsis' | 'chapterContent' | 'script' | 'intensity' | 'status' | 'finalizedAt' | 'staleReason' | 'sourceVersion'>

function episodeHasChapterContent(episode: ChapterEpisode): boolean {
    return Boolean(episode.chapterContent?.trim() || episode.hasChapterContent || isChapterFinalized(episode.status))
}

function episodeHasScript(episode: ChapterEpisode): boolean {
    return Boolean(episode.script?.trim() || episode.hasScript || isScriptGenerated(episode.status))
}

interface ProjectSlim {
    id: string
    title: string
    genre: string | null
    description: string | null
    totalEpisodes: number
    novel: string | null
    novelSetup: string | null
    novelStage: string
    episodes: ChapterEpisode[]
    characters?: Array<{ id: string; name?: string; role?: string | null; gender?: string | null; age?: string | null; appearancePrompt?: string | null; personality?: string | null }>
    scenes?: Array<{ id: string; name?: string; description?: string | null; locationPrompt?: string | null; timeOfDay?: string | null }>
}

interface Props {
    project: ProjectSlim
    onRefetch: () => void | Promise<void>
    onMessage: (msg: { type: 'success' | 'error'; text: string } | null) => void
    onExtractCommitted?: (payload: { characterIds: string[]; sceneIds: string[]; newChars: number; newScenes: number; replaceAll: boolean }) => void | Promise<void>
    onOpenCharacters?: () => void
    novelStageView: string
    setNovelStageView: (stage: string) => void
}

export const STAGES = [
    { key: 'setup', label: '1. 小说架构' },
    { key: 'outlined', label: '2. 大纲确认' },
    { key: 'drafting', label: '章节正文' },
    { key: 'finalized', label: '4. 拆剧本 / 提取' }
] as const

export function stageIndexValue(stage: string): number {
    if (stage === 'scripted') return 3
    const i = STAGES.findIndex(s => s.key === stage)
    return i < 0 ? 0 : i
}

const APPEAL_OPTIONS = ['逆袭', '打脸', '甜宠', '虐心', '复仇', '重生', '穿越', '救赎', '强反转', '高能开局', '身份反转', '追妻火葬场', '契约关系', '强强联合', '破镜重圆']

function parseSetup(raw: string | null): NovelSetup {
    return parseNovelSetup(raw)
}

interface OutlineJobResult {
    count: number
    requested?: number
    missing?: number[]
    warning?: string
}

/**
 * 递增轮询间隔，避免长任务（大纲 60s+、章节 30-60s）在前 10 秒空转打库。
 * 依次 2s → 3s → 5s → 8s → 12s → 15s（封顶），DB 压力比固定 2s 降 5-7 倍。
 */
const POLL_STEPS_MS = [4000, 6000, 10000, 15000, 20000, 30000]
const MAX_OUTLINE_RECOVERIES = 2

function outlineJobStorageKey(projectId: string): string {
    return `aigc:outline-job:${projectId}`
}

function nextPollInterval(attempt: number): number {
    return getPollingDelay({ baseMs: POLL_STEPS_MS[Math.min(attempt, POLL_STEPS_MS.length - 1)] })
}

class OutlineJobCancelledError extends Error {
    constructor(message = '大纲生成已取消') {
        super(message)
        this.name = 'OutlineJobCancelledError'
    }
}

function throwIfPollingAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('大纲轮询已停止', 'AbortError')
}

function waitForNextOutlinePoll(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return new Promise(resolve => setTimeout(resolve, delayMs))
    throwIfPollingAborted(signal)
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, delayMs)
        const onAbort = () => {
            clearTimeout(timer)
            reject(new DOMException('大纲轮询已停止', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

// 大纲可能包含几十集且需要读取长篇原始素材；后端 LLM 请求支持重试，前端不能在 10 分钟时误报失败。
async function pollOutlineJob(
    jobId: string,
    projectId: string,
    onProgress?: (received: number, total: number) => Promise<void> | void,
    timeoutMs = 35 * 60 * 1000,
    signal?: AbortSignal
): Promise<OutlineJobResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    let lastReceived = -1
    let currentJobId = jobId
    let completedBeforeCurrentJob = 0
    let recoveries = 0
    while (Date.now() < deadline) {
        throwIfPollingAborted(signal)
        const res = await clientFetch(`/api/ai/outline/status/${currentJobId}`, { signal })
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? '轮询大纲任务失败')
        const data = json.data ?? {}
        const received = Number(data.receivedChapters ?? 0)
        const total = Number(data.totalEpisodes ?? 0)
        const overallReceived = completedBeforeCurrentJob + received
        const overallTotal = completedBeforeCurrentJob + total
        if (overallReceived !== lastReceived) {
            lastReceived = overallReceived
            await onProgress?.(overallReceived, overallTotal)
        }
        if (data.phase === 'done') {
            if (!data.result) throw new Error('大纲任务已完成但未返回结果')
            return data.result as OutlineJobResult
        }
        if (data.phase === 'error') {
            if (data.recoverable === true && recoveries < MAX_OUTLINE_RECOVERIES) {
                const recovery = await clientFetch('/api/ai/outline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId, continueMissing: true })
                })
                const recoveryJson = await recovery.json()
                if (!recoveryJson.success) throw new Error(recoveryJson.error ?? '大纲任务恢复失败')
                const recoveredJobId = recoveryJson.data?.jobId as string | undefined
                if (!recoveredJobId) throw new Error('大纲任务恢复后未返回任务 ID')
                completedBeforeCurrentJob = overallReceived
                currentJobId = recoveredJobId
                window.localStorage.setItem(outlineJobStorageKey(projectId), recoveredJobId)
                if (signal?.aborted) {
                    await clientFetch(`/api/ai/outline/status/${recoveredJobId}`, { method: 'DELETE' }).catch(() => undefined)
                    window.localStorage.removeItem(outlineJobStorageKey(projectId))
                    throwIfPollingAborted(signal)
                }
                recoveries += 1
                attempt = 0
                continue
            }
            throw new Error(data.error ?? '大纲任务失败')
        }
        if (data.phase === 'cancelled') throw new OutlineJobCancelledError(data.error)
        await waitForNextOutlinePoll(nextPollInterval(attempt++), signal)
    }
    throw new Error('大纲任务超时（35 分钟未完成）')
}

interface SetupJobResult {
    setup: NovelSetup
}

async function pollSetupJob(jobId: string, timeoutMs = 5 * 60 * 1000): Promise<SetupJobResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    while (Date.now() < deadline) {
        const res = await clientFetch(`/api/ai/setup/status/${jobId}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? '轮询小说架构任务失败')
        const data = json.data ?? {}
        if (data.phase === 'done') {
            if (!data.result) throw new Error('小说架构任务已完成但未返回结果')
            return data.result as SetupJobResult
        }
        if (data.phase === 'error') throw new Error(data.error ?? '小说架构任务失败')
        await new Promise(r => setTimeout(r, nextPollInterval(attempt++)))
    }
    throw new Error('小说架构任务超时（5 分钟未完成）')
}

async function pollOutlineTextJob(jobId: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    while (Date.now() < deadline) {
        const res = await clientFetch(`/api/ai/expand-prompt/status/${jobId}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? '轮询失败')
        const data = json.data ?? {}
        if (data.phase === 'done') {
            const improved = data.result?.expanded
            if (typeof improved !== 'string' || !improved.trim()) throw new Error('任务已完成但未返回结果')
            return improved.trim()
        }
        if (data.phase === 'error') throw new Error(data.error ?? '任务失败')
        await new Promise(resolve => setTimeout(resolve, nextPollInterval(attempt++)))
    }
    throw new Error('任务超时（5 分钟未完成）')
}

interface ScriptJobResult {
    episodeId: string
    episodeNumber: number
    title: string | null
    synopsis: string | null
    script: string
    allScripted: boolean
}

async function pollScriptJob(jobId: string, timeoutMs = 10 * 60 * 1000): Promise<ScriptJobResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    while (Date.now() < deadline) {
        const res = await clientFetch(`/api/ai/script/status/${jobId}`)
        const json = await readApiJson(res)
        if (!res.ok || !json.success) throw new ScriptRequestError(json.error ?? '轮询剧本任务失败', res.status, json.retryable)
        const data = json.data ?? {}
        if (data.phase === 'done') {
            if (!data.result) throw new Error('剧本任务已完成但未返回结果')
            return data.result as ScriptJobResult
        }
        if (data.phase === 'error') throw new ScriptRequestError(data.error ?? '剧本任务失败', res.status, data.retryable)
        await new Promise(r => setTimeout(r, nextPollInterval(attempt++)))
    }
    throw new Error('剧本任务超时（10 分钟未完成）')
}

async function startScriptJob(episodeId: string) {
    const res = await clientFetch('/api/ai/script', {
        method: 'POST',
        body: JSON.stringify({ episodeId }),
        suppressRateLimitToast: true
    })
    const json = await readApiJson(res)
    if (!res.ok || !json.success) throw new ScriptRequestError(json.error ?? '创建剧本任务失败', res.status, json.retryable)
    const jobId = json.data?.jobId as string | undefined
    if (!jobId) throw new Error('剧本任务未返回 jobId')
    return jobId
}

export default function NovelTab({ project: projectSummary, onRefetch, onMessage, onExtractCommitted, onOpenCharacters, novelStageView, setNovelStageView }: Props) {
    const { t, locale } = useI18n()
    const ui = (source: string, english: string) => (locale === 'zh' ? source : locale === 'en' ? english : t(source))
    const [episodeDetails, setEpisodeDetails] = useState<Record<string, EpisodeContent>>({})
    const [contentRequests] = useState(createEpisodeContentRequestTracker)
    // 章节详情是按需加载的，可能比项目摘要更旧；定稿/解除定稿后先用本地覆盖值
    // 保证下一步按钮立即反映操作结果，待项目摘要刷新后仍以最新状态为准。
    const [episodeStatusOverrides, setEpisodeStatusOverrides] = useState<Record<string, { status: string; finalizedAt: string | null; sourceVersion?: number }>>({})
    const [loadingEpisodeIds, setLoadingEpisodeIds] = useState<Set<string>>(new Set())
    const [outlineProgress, setOutlineProgress] = useState<{ received: number; total: number } | null>(null)
    const project = useMemo(
        () => ({
            ...projectSummary,
            episodes: projectSummary.episodes.map(episode => ({
                ...episode,
                ...(isEpisodeContentCurrent(episode, episodeDetails[episode.id]) ? episodeDetails[episode.id] : {}),
                status: isEpisodeContentCurrent(episode, episodeStatusOverrides[episode.id]) ? episodeStatusOverrides[episode.id].status : episode.status,
                finalizedAt: isEpisodeContentCurrent(episode, episodeStatusOverrides[episode.id]) ? episodeStatusOverrides[episode.id].finalizedAt : episode.finalizedAt,
                staleReason: episode.staleReason,
                _count: episode._count
            }))
        }),
        [projectSummary, episodeDetails, episodeStatusOverrides]
    )
    const missingOutlineNumbers = useMemo(() => getMissingChapterOutlineNumbers(project.episodes, project.totalEpisodes), [project.episodes, project.totalEpisodes])
    const hasAnyOutline = project.episodes.some(episode => Boolean(episode.synopsis?.trim()))
    const [setup, setSetup] = useState<NovelSetup>(() => parseSetup(project.novelSetup))
    const [episodeCount, setEpisodeCount] = useState<number>(project.totalEpisodes)
    const [savingSetup, setSavingSetup] = useState(false)
    const [runningAi, setRunningAi] = useState<string | null>(null)
    const [cancellingOutline, setCancellingOutline] = useState(false)
    const activeOutlineJobIdRef = useRef<string | null>(null)
    const outlinePollAbortRef = useRef<AbortController | null>(null)
    const [outlineCoolingDown, setOutlineCoolingDown] = useState(false)
    const [generatingChapterIds, setGeneratingChapterIds] = useState<Set<string>>(new Set())
    const [queuedChapterIds, setQueuedChapterIds] = useState<Set<string>>(new Set())
    const [savingChapterId, setSavingChapterId] = useState<string | null>(null)
    const [autoSavedFlash, setAutoSavedFlash] = useState<Record<string, number>>({})
    const autoSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
    const [batchRunning, setBatchRunning] = useState(false)
    const [chapterBatchTotal, setChapterBatchTotal] = useState(0)
    const [chapterBatchDone, setChapterBatchDone] = useState(0)
    const [chapterBatchCurrentId, setChapterBatchCurrentId] = useState<string | null>(null)
    const [chapterBatchPaused, setChapterBatchPaused] = useState<{ episodeNumber: number; reason: string } | null>(null)
    const [batchFinalizing, setBatchFinalizing] = useState(false)
    const [scriptingIds, setScriptingIds] = useState<Set<string>>(new Set())
    const [scriptQueuedIds, setScriptQueuedIds] = useState<Set<string>>(new Set())
    const [storyboardingIds, setStoryboardingIds] = useState<Set<string>>(new Set())
    const [scriptBatchRunning, setScriptBatchRunning] = useState(false)
    const [scriptBatchTotal, setScriptBatchTotal] = useState(0)
    const [scriptBatchDone, setScriptBatchDone] = useState(0)
    const [scriptBatchIssue, setScriptBatchIssue] = useState<ScriptBatchIssue | null>(null)
    const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null)
    const [showExtractModal, setShowExtractModal] = useState(false)
    const [extractJobId, setExtractJobId] = useState<string | null>(null)
    const onRefetchRef = useRef(onRefetch)
    const onMessageRef = useRef(onMessage)
    const translateRef = useRef(t)

    const [customAppealTag, setCustomAppealTag] = useState('')
    const [chapterDrafts, setChapterDrafts] = useState<Record<string, { title: string; synopsis: string; chapterContent: string }>>({})
    const [scriptDrafts, setScriptDrafts] = useState<Record<string, string>>({})
    const scriptAutoSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
    const [scriptAutoSavedFlash, setScriptAutoSavedFlash] = useState<Record<string, number>>({})
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
    const [expandedSynopsisIds, setExpandedSynopsisIds] = useState<Set<string>>(new Set())
    const [showStyleOptions, setShowStyleOptions] = useState<boolean>(() => {
        const s = parseSetup(project.novelSetup)
        return !!(s.primaryGenre || s.perspective || s.pace || s.tone || (s.appealTags && s.appealTags.length))
    })
    const [showStoryBible, setShowStoryBible] = useState<boolean>(() => {
        const s = parseSetup(project.novelSetup)
        return !!(s.coreSeed || s.worldBible || s.plotArchitecture || s.characterArcs || (s.episodeStatePlan && s.episodeStatePlan.length > 0))
    })
    const [uploadingStyleImage, setUploadingStyleImage] = useState(false)
    const styleImageInputRef = useRef<HTMLInputElement>(null)
    const { confirm, confirmDialog } = useConfirmDialog()

    useEffect(() => {
        onRefetchRef.current = onRefetch
        onMessageRef.current = onMessage
        translateRef.current = t
    }, [onMessage, onRefetch, t])

    useEffect(() => {
        // An acknowledged local transition must not mask a later server reset.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEpisodeStatusOverrides(previous => {
            const pending = Object.fromEntries(
                Object.entries(previous).filter(([id, override]) => {
                    const summary = projectSummary.episodes.find(episode => episode.id === id)
                    return summary && isEpisodeContentCurrent(summary, override) && summary.status !== override.status
                })
            )
            return Object.keys(pending).length === Object.keys(previous).length ? previous : pending
        })
    }, [projectSummary.episodes])

    useEffect(() => {
        let cancelled = false
        let pollController: AbortController | null = null
        const storageKey = outlineJobStorageKey(project.id)

        void (async () => {
            let jobId = window.localStorage.getItem(storageKey)
            if (!jobId) {
                const response = await clientFetch(`/api/ai/outline?projectId=${encodeURIComponent(project.id)}`)
                const json = await response.json()
                if (!json.success) return
                jobId = json.data?.jobId as string | null
            }
            if (!jobId || cancelled) return

            window.localStorage.setItem(storageKey, jobId)
            activeOutlineJobIdRef.current = jobId
            outlinePollAbortRef.current?.abort()
            const controller = new AbortController()
            pollController = controller
            outlinePollAbortRef.current = controller
            setRunningAi('outline')
            setOutlineProgress({ received: 0, total: project.totalEpisodes })
            try {
                const data = await pollOutlineJob(
                    jobId,
                    project.id,
                    async (received, total) => {
                        if (cancelled) return
                        setOutlineProgress({ received, total })
                        onMessageRef.current({ type: 'success', text: `大纲生成中 ${received}/${total} 章，已完成内容会实时展示` })
                        if (received > 0) await onRefetchRef.current()
                    },
                    35 * 60 * 1000,
                    controller.signal
                )
                if (cancelled) return
                const requested = data.requested ?? data.count
                onMessageRef.current({
                    type: data.warning ? 'error' : 'success',
                    text: data.warning ?? translateRef.current('大纲已生成 {count} 章', { count: `${data.count}${requested ? `/${requested}` : ''}` })
                })
                window.localStorage.removeItem(storageKey)
                await onRefetchRef.current()
            } catch (error) {
                if (cancelled || controller.signal.aborted) return
                window.localStorage.removeItem(storageKey)
                onMessageRef.current({ type: error instanceof OutlineJobCancelledError ? 'success' : 'error', text: error instanceof Error ? error.message : String(error) })
            } finally {
                if (!cancelled && outlinePollAbortRef.current === controller) {
                    activeOutlineJobIdRef.current = null
                    outlinePollAbortRef.current = null
                    setOutlineProgress(null)
                    setRunningAi(null)
                }
            }
        })()

        return () => {
            cancelled = true
            pollController?.abort()
        }
    }, [project.id, project.totalEpisodes])

    async function generateStoryboardsAndEnter(episode: ChapterEpisode) {
        const existingCount = episode._count?.storyboards ?? 0
        if (existingCount > 0) {
            const ok = await confirm({
                title: '重新生成分镜？',
                message: `当前已有 ${existingCount} 个分镜。重新生成会覆盖旧分镜及其插图、视频等生产结果。`,
                confirmText: '重新生成',
                tone: 'warning'
            })
            if (!ok) return
        }
        setStoryboardingIds(prev => new Set(prev).add(episode.id))
        onMessage(null)
        try {
            const res = await clientFetch('/api/ai/storyboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    buildStoryboardGenerationRequest({
                        episodeId: episode.id,
                        mode: existingCount > 0 ? 'overwrite' : 'missing'
                    })
                )
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error ?? '创建分镜任务失败')
            const jobId = json.data?.jobId as string | undefined
            if (!jobId) throw new Error('分镜任务未返回 jobId')
            const deadline = Date.now() + 10 * 60 * 1000
            let pollAttempt = 0
            while (Date.now() < deadline) {
                const statusRes = await clientFetch(`/api/ai/storyboard/status/${jobId}`)
                const statusJson = await statusRes.json()
                if (!statusJson.success) throw new Error(statusJson.error ?? '查询分镜任务失败')
                if (statusJson.data?.phase === 'done') {
                    const count = Number(statusJson.data?.result?.count ?? 0)
                    onMessage({ type: 'success', text: `已生成 ${count} 个分镜` })
                    window.location.assign(`/projects/${project.id}/episodes/${episode.id}`)
                    return
                }
                if (statusJson.data?.phase === 'error') throw new Error(statusJson.data?.error ?? '分镜生成失败')
                await new Promise(resolve => setTimeout(resolve, nextPollInterval(pollAttempt++)))
            }
            throw new Error('分镜生成超时，请稍后进入分镜页查看任务状态')
        } catch (error) {
            onMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
            setStoryboardingIds(prev => {
                const next = new Set(prev)
                next.delete(episode.id)
                return next
            })
        }
    }

    async function loadEpisodeContent(episodeId: string, force = false) {
        const summary = projectSummary.episodes.find(episode => episode.id === episodeId)
        if (!force && summary && isEpisodeContentCurrent(summary, episodeDetails[episodeId])) return
        const token = contentRequests.start(episodeId, summary?.sourceVersion, force)
        if (!token) return
        setLoadingEpisodeIds(prev => new Set(prev).add(episodeId))
        try {
            const res = await clientFetch(`/api/episodes/${episodeId}/content`, { cache: 'no-store' })
            const json = await res.json()
            if (!json.success) throw new Error(json.error ?? '章节内容加载失败')
            const detail = json.data as EpisodeContent
            if (!contentRequests.isCurrent(episodeId, token)) return
            setEpisodeDetails(prev => ({ ...prev, [episodeId]: detail }))
            setChapterDrafts(prev => ({
                ...prev,
                [episodeId]: {
                    title: detail.title ?? '',
                    synopsis: detail.synopsis ?? '',
                    chapterContent: detail.chapterContent ?? ''
                }
            }))
            setScriptDrafts(prev => ({ ...prev, [episodeId]: detail.script ?? '' }))
        } catch (error) {
            if (contentRequests.isCurrent(episodeId, token)) onMessage({ type: 'error', text: error instanceof Error ? error.message : '章节内容加载失败' })
        } finally {
            if (contentRequests.finish(episodeId, token)) {
                setLoadingEpisodeIds(prev => {
                    const next = new Set(prev)
                    next.delete(episodeId)
                    return next
                })
            }
        }
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSetup(parseSetup(project.novelSetup))
    }, [project.novelSetup])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEpisodeCount(project.totalEpisodes)
    }, [project.totalEpisodes])

    useEffect(() => {
        if (!selectedChapterId && project.episodes.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedChapterId(project.episodes[0].id)
            return
        }
        if (selectedChapterId && !project.episodes.some(e => e.id === selectedChapterId)) {
            setSelectedChapterId(project.episodes[0]?.id ?? null)
        }
    }, [project.episodes, selectedChapterId])

    const selectedChapterVersion = projectSummary.episodes.find(episode => episode.id === selectedChapterId)?.sourceVersion
    const selectedScriptVersion = projectSummary.episodes.find(episode => episode.id === selectedScriptId)?.sourceVersion

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (novelStageView === 'drafting' && selectedChapterId) void loadEpisodeContent(selectedChapterId)
        // loadEpisodeContent is intentionally keyed by the selected id; the cache prevents duplicate requests.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [novelStageView, selectedChapterId, selectedChapterVersion])

    useEffect(() => {
        if (!selectedScriptId && project.episodes.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedScriptId(project.episodes[0].id)
            return
        }
        if (selectedScriptId && !project.episodes.some(e => e.id === selectedScriptId)) {
            setSelectedScriptId(project.episodes[0]?.id ?? null)
        }
    }, [project.episodes, selectedScriptId])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (novelStageView === 'finalized' && selectedScriptId) void loadEpisodeContent(selectedScriptId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [novelStageView, selectedScriptId, selectedScriptVersion])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setChapterDrafts(prev => {
            const drafts: Record<string, { title: string; synopsis: string; chapterContent: string }> = {}
            for (const ep of project.episodes) {
                drafts[ep.id] = {
                    title: ep.title ?? '',
                    synopsis: ep.synopsis ?? '',
                    chapterContent: episodeHasChapterContent(ep) ? (ep.chapterContent ?? (isEpisodeContentCurrent(ep, episodeDetails[ep.id]) ? prev[ep.id]?.chapterContent : '') ?? '') : ''
                }
            }
            return drafts
        })
    }, [project.episodes, episodeDetails])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setScriptDrafts(prev => {
            const next: Record<string, string> = {}
            for (const ep of project.episodes) {
                // 保留用户正在编辑的内容，仅当 ep.script 更新时才覆盖
                next[ep.id] = episodeHasScript(ep) ? (ep.script ?? (isEpisodeContentCurrent(ep, episodeDetails[ep.id]) ? prev[ep.id] : '') ?? '') : ''
            }
            return next
        })
    }, [project.episodes, episodeDetails])

    useEffect(() => {
        const timers = scriptAutoSaveTimers.current
        return () => {
            contentRequests.clear()
            Object.values(timers).forEach(t => clearTimeout(t))
        }
    }, [contentRequests])

    const currentStage = novelStageView
    const projectCharacterCount = project.characters?.length ?? 0
    const projectSceneCount = project.scenes?.length ?? 0
    const hasProjectEntities = projectCharacterCount + projectSceneCount > 0
    const chapterProgress = getChapterProgress(project.episodes)
    const { allFinalized } = chapterProgress
    const chapterActionsBusy = batchRunning || batchFinalizing || generatingChapterIds.size > 0 || savingChapterId !== null
    const unfinalizedChapterCount = project.episodes.filter(ep => !isChapterFinalized(ep.status) && episodeHasChapterContent(ep)).length
    const hasOutline = project.episodes.some(e => e.synopsis)
    const chapterBatchCurrent = chapterBatchCurrentId ? project.episodes.find(e => e.id === chapterBatchCurrentId) : null
    const chapterBatchProgress = chapterBatchTotal > 0 ? Math.min(100, ((chapterBatchDone + (batchRunning && chapterBatchCurrent ? 0.35 : 0)) / chapterBatchTotal) * 100) : 0

    function hasGeneratedOutlineData() {
        return project.episodes.some(
            e =>
                !!e.synopsis ||
                episodeHasChapterContent(e) ||
                episodeHasScript(e) ||
                e.status === 'finalized' ||
                e.status === 'scripted' ||
                e.status === 'storyboarded' ||
                (e._count?.storyboards ?? 0) > 0
        )
    }

    function clearExtractionClientState() {
        setShowExtractModal(false)
        setExtractJobId(null)
        window.localStorage.removeItem(`aigc:extract-job:${project.id}`)
        window.localStorage.removeItem(`aigc:extract-reset:${project.id}`)
    }

    function clearDownstreamClientState() {
        contentRequests.clear()
        setLoadingEpisodeIds(new Set())
        for (const timer of [...Object.values(autoSaveTimers.current), ...Object.values(scriptAutoSaveTimers.current)]) clearTimeout(timer)
        autoSaveTimers.current = {}
        scriptAutoSaveTimers.current = {}
        setEpisodeDetails({})
        setEpisodeStatusOverrides({})
        setChapterDrafts({})
        setScriptDrafts({})
        setSelectedChapterId(null)
        setSelectedScriptId(null)
        clearExtractionClientState()
        setScriptBatchIssue(null)
        setChapterBatchPaused(null)
    }

    async function resetProgressForOutline() {
        await resetOutlineProgress(project.id)
        clearDownstreamClientState()
    }

    async function refetchProjectQuietly() {
        try {
            await onRefetch()
        } catch (err) {
            console.warn('[NovelTab] project refresh failed during batch flow:', err)
        }
    }

    function openExtractModal() {
        setShowExtractModal(true)
    }

    async function saveSetup(nextSetup: NovelSetup = setup) {
        setSavingSetup(true)
        onMessage(null)
        try {
            const serializedSetup = JSON.stringify(nextSetup)
            const payload: Record<string, unknown> = { novelSetup: serializedSetup }
            if (episodeCount !== project.totalEpisodes) {
                if (!Number.isFinite(episodeCount) || episodeCount < 1) {
                    throw new Error('章节数至少 1')
                }
                payload.totalEpisodes = episodeCount
            }
            const res = await clientFetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? t('故事架构保存失败，请稍后重试'))
            const persistedSetup = typeof json.data?.novelSetup === 'string' ? JSON.stringify(parseSetup(json.data.novelSetup)) : null
            const requestedSetup = JSON.stringify(parseSetup(serializedSetup))
            if (persistedSetup !== requestedSetup) throw new Error(t('故事架构保存失败，请稍后重试'))
            await onRefetch()
            onMessage({ type: 'success', text: '设定已保存' })
            return true
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
            return false
        } finally {
            setSavingSetup(false)
        }
    }

    async function runSetupArchitect() {
        setRunningAi('setup')
        onMessage(null)
        try {
            const res = await clientFetch('/api/ai/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, setup })
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            const jobId = json.data?.jobId as string | undefined
            if (!jobId) throw new Error('小说架构任务未返回 jobId')
            const result = await pollSetupJob(jobId)
            setSetup(result.setup)
            setShowStoryBible(true)
            onMessage({ type: 'success', text: '小说架构已生成，可继续编辑后生成大纲' })
            await onRefetch()
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setRunningAi(null)
        }
    }

    async function runOutlineTextAction(action: 'rewrite' | 'expand') {
        const sourceOutline = setup.outline?.trim()
        if (!sourceOutline || runningAi) return
        const actionLabel = action === 'rewrite' ? t('改写') : t('扩写')
        setRunningAi(`outline-${action}`)
        onMessage(null)
        try {
            const res = await clientFetch('/api/ai/expand-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: project.id,
                    field: 'outline',
                    action,
                    text: sourceOutline,
                    outlineContext: {
                        title: project.title,
                        genre: setup.primaryGenre || project.genre,
                        totalEpisodes: episodeCount,
                        contentLanguage: setup.contentLanguage,
                        coreSeed: setup.coreSeed,
                        worldBible: setup.worldBible,
                        plotArchitecture: setup.plotArchitecture,
                        characterArcs: setup.characterArcs,
                        relationships: setup.relationships,
                        keyPlots: setup.keyPlots
                    }
                })
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error ?? `${actionLabel}失败`)
            const jobId = json.data?.jobId as string | undefined
            if (!jobId) throw new Error('未返回 jobId')
            const improved = await pollOutlineTextJob(jobId)
            setSetup(previous => ({ ...previous, outline: improved }))
            onMessage({ type: 'success', text: `${actionLabel} ✓` })
        } catch (error) {
            onMessage({ type: 'error', text: error instanceof Error ? error.message : action === 'rewrite' ? t('改写失败') : t('扩写失败') })
        } finally {
            setRunningAi(null)
        }
    }

    async function uploadStyleImage(file: File) {
        if (uploadingStyleImage) return
        if (file.size > 8 * 1024 * 1024) {
            onMessage({ type: 'error', text: '文件过大，最大 8MB' })
            return
        }
        setUploadingStyleImage(true)
        onMessage(null)
        try {
            const res = await clientFetch(`/api/projects/${project.id}/style-images`, {
                method: 'POST',
                headers: { 'Content-Type': file.type },
                body: file
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            setSetup(prev => ({ ...prev, styleReferenceImages: json.data.styleReferenceImages }))
            onMessage({ type: 'success', text: '风格参考图已上传' })
            await onRefetch()
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setUploadingStyleImage(false)
            if (styleImageInputRef.current) styleImageInputRef.current.value = ''
        }
    }

    async function removeStyleImage(url: string) {
        onMessage(null)
        try {
            const res = await clientFetch(`/api/projects/${project.id}/style-images`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            setSetup(prev => ({ ...prev, styleReferenceImages: json.data.styleReferenceImages }))
            await onRefetch()
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        }
    }

    async function cancelOutline() {
        if (cancellingOutline || runningAi !== 'outline') return
        const ok = await confirm({
            title: ui('取消当前大纲生成？', 'Cancel the current outline generation?'),
            message: ui(
                '取消后可立即返回修改设定。已经生成并保存的章节会保留；下次重新生成时，系统会再次确认是否清空旧内容。',
                'You can edit the setup immediately after cancelling. Chapters already generated and saved will be kept; the app will ask again before clearing them when you regenerate.'
            ),
            confirmText: ui('取消生成', 'Cancel generation'),
            cancelText: ui('继续生成', 'Keep generating'),
            tone: 'warning'
        })
        if (!ok) return

        setCancellingOutline(true)
        onMessage(null)
        try {
            // Recovery may replace the job id while retaining the same client
            // polling loop, so persisted state is the freshest cancellation target.
            let jobId = window.localStorage.getItem(outlineJobStorageKey(project.id)) ?? activeOutlineJobIdRef.current
            if (!jobId) {
                const activeResponse = await clientFetch(`/api/ai/outline?projectId=${encodeURIComponent(project.id)}`)
                const activeJson = await activeResponse.json()
                if (!activeJson.success) throw new Error(activeJson.error ?? '查询大纲任务失败')
                jobId = (activeJson.data?.jobId as string | null) ?? null
            }
            if (jobId) {
                const response = await clientFetch(`/api/ai/outline/status/${jobId}`, { method: 'DELETE' })
                const json = await response.json()
                if (!json.success) throw new Error(json.error ?? '取消大纲任务失败')
            }

            outlinePollAbortRef.current?.abort()
            outlinePollAbortRef.current = null
            activeOutlineJobIdRef.current = null
            window.localStorage.removeItem(outlineJobStorageKey(project.id))
            setOutlineProgress(null)
            setRunningAi(null)
            setNovelStageView('setup')
            onMessage({ type: 'success', text: ui('大纲生成已取消，现在可以修改设定后重新生成', 'Outline generation cancelled. You can now edit the setup and regenerate.') })
            await onRefetch()
        } catch (error) {
            onMessage({ type: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
            setCancellingOutline(false)
        }
    }

    async function runOutline() {
        // 3s 冷却期：避免用户狂点触发多次后台任务
        if (outlineCoolingDown) {
            await confirm({
                title: '操作太快',
                message: '请稍等一下再点击，操作已在处理中。',
                confirmText: '知道了',
                tone: 'warning'
            })
            return
        }
        if (runningAi === 'outline') {
            await confirm({
                title: '大纲正在生成',
                message: '当前项目的大纲生成任务还没结束，请等待完成后再操作。',
                confirmText: '知道了',
                tone: 'warning'
            })
            return
        }
        setOutlineCoolingDown(true)
        setTimeout(() => setOutlineCoolingDown(false), 3000)

        const shouldReset = hasGeneratedOutlineData()
        if (shouldReset) {
            const ok = await confirm({
                title: '已有大纲，确认重新生成？',
                message: '所有已存的大纲、章节正文、剧本、角色、场景及参考图、分镜、插图、视频和提取记录都将清除，且无法恢复。确认重新生成？',
                confirmText: '确认重新生成',
                tone: 'danger'
            })
            if (!ok) return
        }

        setRunningAi('outline')
        setOutlineProgress({ received: 0, total: episodeCount })
        outlinePollAbortRef.current?.abort()
        const pollController = new AbortController()
        outlinePollAbortRef.current = pollController
        activeOutlineJobIdRef.current = null
        onMessage(null)
        // 立即切到大纲页，让大纲页的骨架屏接管视觉反馈，不要把用户留在 setup 页面干等
        setNovelStageView('outlined')
        try {
            // Save setup before clearing descendants: saving it also synchronizes
            // setup characters, which must not resurrect the old extraction stage.
            if (!(await saveSetup(shouldReset ? { ...setup, episodeStatePlan: [], factLedger: [] } : setup))) return
            throwIfPollingAborted(pollController.signal)
            if (shouldReset) {
                await resetProgressForOutline()
                await onRefetch()
                throwIfPollingAborted(pollController.signal)
            }
            const res = await clientFetch(`/api/ai/outline`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id })
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            const jobId: string | undefined = json.data?.jobId
            if (!jobId) throw new Error('未拿到大纲任务 ID')

            // 轮询后台任务，直到 done / error
            activeOutlineJobIdRef.current = jobId
            window.localStorage.setItem(outlineJobStorageKey(project.id), jobId)
            if (pollController.signal.aborted) {
                const cancelResponse = await clientFetch(`/api/ai/outline/status/${jobId}`, { method: 'DELETE' })
                const cancelJson = await cancelResponse.json()
                if (!cancelJson.success) onMessage({ type: 'error', text: cancelJson.error ?? '取消大纲任务失败' })
                else window.localStorage.removeItem(outlineJobStorageKey(project.id))
                return
            }
            const data = await pollOutlineJob(
                jobId,
                project.id,
                async (received, total) => {
                    setOutlineProgress({ received, total })
                    onMessage({ type: 'success', text: `大纲生成中 ${received}/${total} 章，已完成内容会实时展示` })
                    if (received > 0) await onRefetch()
                },
                35 * 60 * 1000,
                pollController.signal
            )
            const requested = data.requested ?? data.count
            const successText = data.warning || t('大纲已生成 {count} 章', { count: `${data.count}${requested ? `/${requested}` : ''}` })
            onMessage({ type: data.warning ? 'error' : 'success', text: successText })
            window.localStorage.removeItem(outlineJobStorageKey(project.id))
            await onRefetch()
        } catch (e) {
            if (pollController.signal.aborted) return
            window.localStorage.removeItem(outlineJobStorageKey(project.id))
            onMessage({ type: e instanceof OutlineJobCancelledError ? 'success' : 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            if (outlinePollAbortRef.current === pollController) {
                outlinePollAbortRef.current = null
                activeOutlineJobIdRef.current = null
                setOutlineProgress(null)
                setRunningAi(null)
            }
        }
    }

    async function continueMissingOutline() {
        if (runningAi) return
        setRunningAi('outline')
        setOutlineProgress({ received: 0, total: missingOutlineNumbers.length })
        outlinePollAbortRef.current?.abort()
        const pollController = new AbortController()
        outlinePollAbortRef.current = pollController
        activeOutlineJobIdRef.current = null
        onMessage(null)
        try {
            const res = await clientFetch('/api/ai/outline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, continueMissing: true })
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            const jobId: string | undefined = json.data?.jobId
            if (!jobId) throw new Error('未拿到大纲任务 ID')
            activeOutlineJobIdRef.current = jobId
            window.localStorage.setItem(outlineJobStorageKey(project.id), jobId)
            if (pollController.signal.aborted) {
                const cancelResponse = await clientFetch(`/api/ai/outline/status/${jobId}`, { method: 'DELETE' })
                const cancelJson = await cancelResponse.json()
                if (!cancelJson.success) onMessage({ type: 'error', text: cancelJson.error ?? '取消大纲任务失败' })
                else window.localStorage.removeItem(outlineJobStorageKey(project.id))
                return
            }
            const data = await pollOutlineJob(
                jobId,
                project.id,
                async (received, total) => {
                    setOutlineProgress({ received, total })
                    onMessage({ type: 'success', text: t('正在补充剩余大纲 {completed}/{total} 章', { completed: received, total }) })
                    if (received > 0) await onRefetch()
                },
                35 * 60 * 1000,
                pollController.signal
            )
            onMessage({
                type: data.warning ? 'error' : 'success',
                text: data.warning ?? t('剩余大纲已补充完成，共生成 {count} 章', { count: data.count })
            })
            window.localStorage.removeItem(outlineJobStorageKey(project.id))
            await onRefetch()
        } catch (e) {
            if (pollController.signal.aborted) return
            window.localStorage.removeItem(outlineJobStorageKey(project.id))
            onMessage({ type: e instanceof OutlineJobCancelledError ? 'success' : 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            if (outlinePollAbortRef.current === pollController) {
                outlinePollAbortRef.current = null
                activeOutlineJobIdRef.current = null
                setOutlineProgress(null)
                setRunningAi(null)
            }
        }
    }

    async function patchEpisode(episodeId: string, data: Partial<ChapterEpisode>): Promise<boolean> {
        setSavingChapterId(episodeId)
        onMessage(null)
        try {
            const res = await clientFetch(`/api/episodes/${episodeId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, expectedSourceVersion: project.episodes.find(episode => episode.id === episodeId)?.sourceVersion })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '章节内容保存失败')
            const persisted = json.data as Record<string, unknown> | undefined
            const missingField = Object.entries(data).find(([key, requested]) => {
                const stored = persisted?.[key]
                if (typeof requested === 'string') return (typeof stored === 'string' ? stored.trim() || null : (stored ?? null)) !== (requested.trim() || null)
                return (stored ?? null) !== (requested ?? null)
            })
            if (missingField) throw new Error(`章节内容保存失败：服务端未保存字段 ${missingField[0]}`)
            if (episodeDetails[episodeId]) {
                setEpisodeDetails(prev => ({ ...prev, [episodeId]: { ...prev[episodeId], ...json.data } }))
            }
            await loadEpisodeContent(episodeId, true)
            await onRefetch()
            return true
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
            return false
        } finally {
            setSavingChapterId(null)
        }
    }

    function scheduleAutoSave(episodeId: string, data: Partial<ChapterEpisode>, delayMs = 800) {
        const timers = autoSaveTimers.current
        if (timers[episodeId]) clearTimeout(timers[episodeId])
        timers[episodeId] = setTimeout(async () => {
            delete timers[episodeId]
            if (!(await patchEpisode(episodeId, data))) return
            setAutoSavedFlash(prev => ({ ...prev, [episodeId]: Date.now() }))
            setTimeout(() => {
                setAutoSavedFlash(prev => {
                    const next = { ...prev }
                    delete next[episodeId]
                    return next
                })
            }, 1500)
        }, delayMs)
    }

    function scheduleScriptAutoSave(episodeId: string, script: string, delayMs = 1200) {
        const timers = scriptAutoSaveTimers.current
        if (timers[episodeId]) clearTimeout(timers[episodeId])
        timers[episodeId] = setTimeout(async () => {
            delete timers[episodeId]
            if (!(await patchEpisode(episodeId, { script }))) return
            setScriptAutoSavedFlash(prev => ({ ...prev, [episodeId]: Date.now() }))
            setTimeout(() => {
                setScriptAutoSavedFlash(prev => {
                    const next = { ...prev }
                    delete next[episodeId]
                    return next
                })
            }, 1500)
        }, delayMs)
    }

    useEffect(() => {
        const timers = autoSaveTimers.current
        return () => {
            Object.values(timers).forEach(t => clearTimeout(t))
        }
    }, [])

    function cancelPendingAutoSaves(episodeId: string) {
        for (const timers of [autoSaveTimers.current, scriptAutoSaveTimers.current]) {
            if (timers[episodeId]) clearTimeout(timers[episodeId])
            delete timers[episodeId]
        }
    }

    async function generateChapter(episodeId: string) {
        const current = project.episodes.find(e => e.id === episodeId)
        const missingPrevious = current ? project.episodes.filter(e => e.episodeNumber < current.episodeNumber && !episodeHasChapterContent(e)) : []
        if (missingPrevious.length > 0) {
            onMessage({ type: 'error', text: `请先生成前文正文：第 ${missingPrevious.map(e => e.episodeNumber).join('、')} 章。小说必须按顺序承接生成。` })
            return
        }
        cancelPendingAutoSaves(episodeId)
        setGeneratingChapterIds(prev => {
            const next = new Set(prev)
            next.add(episodeId)
            return next
        })
        onMessage(null)
        try {
            const jobId = await startChapterJob(episodeId)
            const result = await pollChapterJob(jobId)
            clearExtractionClientState()
            await loadEpisodeContent(episodeId, true)
            onMessage({
                type: result.warning ? 'error' : 'success',
                text: result.warning ? `${t('已生成草稿')}: ${result.warning}` : t('第{number}章已生成', { number: current?.episodeNumber ?? '' })
            })
            setSelectedChapterId(episodeId)
            await onRefetch()
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setGeneratingChapterIds(prev => {
                const next = new Set(prev)
                next.delete(episodeId)
                return next
            })
        }
    }

    async function batchGenerate(mode: 'missing' | 'all') {
        if (mode === 'all') {
            const hasContent = project.episodes.some(e => episodeHasChapterContent(e) && !isChapterFinalized(e.status))
            if (hasContent) {
                const ok = await confirm({
                    title: '重新生成章节',
                    message: '确定要重新生成所有未定稿章节？已有正文将被覆盖。',
                    confirmText: '重新生成',
                    tone: 'warning'
                })
                if (!ok) return
            }
        }
        onMessage(null)
        const isLocked = isChapterFinalized
        const pending = project.episodes.filter(ep => {
            if (isLocked(ep.status)) return false
            if (mode === 'missing') return !episodeHasChapterContent(ep)
            return true
        })
        if (pending.length === 0) return
        pending.forEach(episode => cancelPendingAutoSaves(episode.id))

        setBatchRunning(true)
        setChapterBatchTotal(pending.length)
        setChapterBatchDone(0)
        setChapterBatchCurrentId(null)
        setChapterBatchPaused(null)
        setQueuedChapterIds(new Set(pending.map(ep => ep.id)))

        try {
            let completed = 0
            let pausedFailure: { num: number; msg: string } | null = null
            const warnings: string[] = []
            for (const ep of pending) {
                setSelectedChapterId(ep.id)
                setChapterBatchCurrentId(ep.id)
                setQueuedChapterIds(prev => {
                    const next = new Set(prev)
                    next.delete(ep.id)
                    return next
                })
                setGeneratingChapterIds(prev => {
                    const next = new Set(prev)
                    next.add(ep.id)
                    return next
                })
                let generated = false
                try {
                    const jobId = await startChapterJob(ep.id)
                    const result = await pollChapterJob(jobId)
                    if (result.warning) warnings.push(result.warning)
                    await loadEpisodeContent(ep.id, true)
                    generated = true
                } catch (e) {
                    pausedFailure = { num: ep.episodeNumber, msg: e instanceof Error ? e.message : String(e) }
                }
                setGeneratingChapterIds(prev => {
                    const next = new Set(prev)
                    next.delete(ep.id)
                    return next
                })
                if (generated) {
                    completed += 1
                    setChapterBatchDone(completed)
                }
                // 每一章完成就刷新一次，让已生成的章节立刻反映到 UI 上
                await refetchProjectQuietly()

                if (pausedFailure) break
            }
            if (pausedFailure) {
                // Keep the failure beside the chapter list; stacked toasts can cover the primary resume button.
                setChapterBatchPaused({ episodeNumber: pausedFailure.num, reason: pausedFailure.msg })
            } else {
                setChapterBatchPaused(null)
                onMessage({
                    type: warnings.length > 0 ? 'error' : 'success',
                    text: warnings.length > 0 ? `${t('批量生成完成，共 {count} 章', { count: pending.length })}; ${warnings.join('; ')}` : t('批量生成完成，共 {count} 章', { count: pending.length })
                })
            }
        } finally {
            setQueuedChapterIds(new Set())
            setGeneratingChapterIds(new Set())
            setBatchRunning(false)
            setChapterBatchTotal(0)
            setChapterBatchDone(0)
            setChapterBatchCurrentId(null)
            await refetchProjectQuietly()
        }
    }

    async function finalizeChapter(episodeId: string) {
        const draft = chapterDrafts[episodeId]
        if (draft) {
            const ep = project.episodes.find(e => e.id === episodeId)
            if (ep && (draft.title !== (ep.title ?? '') || draft.synopsis !== (ep.synopsis ?? '') || draft.chapterContent !== (ep.chapterContent ?? ''))) {
                await patchEpisode(episodeId, { title: draft.title, synopsis: draft.synopsis, chapterContent: draft.chapterContent })
            }
        }
        setSavingChapterId(episodeId)
        onMessage(null)
        try {
            const res = await clientFetch(`/api/episodes/${episodeId}/finalize`, { method: 'POST' })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            const finalizedAt = json.data?.episode?.finalizedAt ?? new Date().toISOString()
            setEpisodeStatusOverrides(prev => ({ ...prev, [episodeId]: { status: 'finalized', finalizedAt, sourceVersion: project.episodes.find(ep => ep.id === episodeId)?.sourceVersion } }))
            onMessage({ type: 'success', text: '本章已定稿' })
            await onRefetch()
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setSavingChapterId(null)
        }
    }

    async function batchFinalize(advance = false) {
        if (chapterActionsBusy) return
        const isLocked = isChapterFinalized
        const candidates = project.episodes.filter(e => !isLocked(e.status) && episodeHasChapterContent(e))
        const missing = project.episodes.filter(e => !isLocked(e.status) && !episodeHasChapterContent(e))
        if (candidates.length === 0) return
        if (missing.length > 0) {
            const ok = await confirm({
                title: '批量定稿',
                message: `还有 ${missing.length} 章没写正文（${missing
                    .slice(0, 5)
                    .map(e => t('第{number}章', { number: e.episodeNumber }))
                    .join('、')}${missing.length > 5 ? '...' : ''}），它们不会被定稿。仅定稿已有正文的 ${candidates.length} 章？`,
                confirmText: '仅定稿已有正文',
                tone: 'warning'
            })
            if (!ok) return
        } else {
            const ok = await confirm({
                title: '批量定稿',
                message: `确认批量定稿 ${candidates.length} 章？定稿后本章内容将被锁定，需解除定稿才能再次编辑。`,
                confirmText: advance ? t('确认定稿并继续') : '批量定稿'
            })
            if (!ok) return
        }

        setBatchFinalizing(true)
        onMessage(null)
        const failed: Array<{ num: number; msg: string }> = []
        const confirmedIds = new Set(project.episodes.filter(ep => isLocked(ep.status)).map(ep => ep.id))
        let skippedFinalized = 0
        try {
            // Save edits before any status update refreshes the chapter drafts.
            for (const ep of candidates) {
                clearTimeout(autoSaveTimers.current[ep.id])
                delete autoSaveTimers.current[ep.id]
            }
            for (const ep of candidates) {
                const draft = chapterDrafts[ep.id]
                if (!draft || !isEpisodeContentCurrent(ep, episodeDetails[ep.id])) continue
                const needPatch = draft.title !== (ep.title ?? '') || draft.synopsis !== (ep.synopsis ?? '') || draft.chapterContent !== (ep.chapterContent ?? '')
                if (!needPatch) continue
                try {
                    const res = await clientFetch(`/api/episodes/${ep.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: draft.title, synopsis: draft.synopsis, chapterContent: draft.chapterContent, expectedSourceVersion: ep.sourceVersion })
                    })
                    const json = await readApiJson(res)
                    if (!res.ok || !json.success) throw new Error(json.error ?? t('保存失败'))
                } catch (error) {
                    onMessage({ type: 'error', text: `${t('第')}${ep.episodeNumber}${t('章')} · ${error instanceof Error ? error.message : t('保存失败')}` })
                    return
                }
            }
            for (const ep of candidates) {
                // 项目列表可能是旧快照；批量操作前以服务端状态为准，避免对已定稿章节发 PATCH 导致 409。
                let latestStatus = project.episodes.find(item => item.id === ep.id)?.status
                try {
                    const latestRes = await clientFetch(`/api/episodes/${ep.id}`)
                    if (latestRes.ok) {
                        const latestJson = await latestRes.json()
                        latestStatus = latestJson.data?.status ?? latestStatus
                    }
                } catch {
                    // 读取失败时继续使用当前快照，后续定稿请求仍会给出明确结果。
                }
                if (isLocked(latestStatus)) {
                    confirmedIds.add(ep.id)
                    setEpisodeStatusOverrides(prev => ({ ...prev, [ep.id]: { status: latestStatus!, finalizedAt: ep.finalizedAt, sourceVersion: ep.sourceVersion } }))
                    skippedFinalized += 1
                    continue
                }
                try {
                    const res = await clientFetch(`/api/episodes/${ep.id}/finalize`, { method: 'POST' })
                    const json = await res.json()
                    if (!json.success) throw new Error(json.error)
                    confirmedIds.add(ep.id)
                    setEpisodeStatusOverrides(prev => ({
                        ...prev,
                        [ep.id]: {
                            status: 'finalized',
                            sourceVersion: ep.sourceVersion,
                            finalizedAt: json.data?.episode?.finalizedAt ?? new Date().toISOString()
                        }
                    }))
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e)
                    failed.push({ num: ep.episodeNumber, msg })
                }
            }
            const okCount = candidates.length - failed.length - skippedFinalized
            if (failed.length === 0) {
                const extra = skippedFinalized > 0 ? `，另有 ${skippedFinalized} 章已是定稿状态，已自动跳过` : ''
                onMessage({ type: 'success', text: `批量定稿完成，${okCount} 章已定稿${extra}` })
            } else {
                onMessage({
                    type: 'error',
                    text: `批量定稿：成功 ${okCount} 章，失败 ${failed.length} 章（${new Intl.ListFormat(locale).format(failed.map(f => t('第{number}章', { number: f.num })))}）${skippedFinalized > 0 ? `，另跳过 ${skippedFinalized} 章已定稿` : ''}`
                })
            }
            await onRefetch()
            if (advance && failed.length === 0 && project.episodes.every(ep => confirmedIds.has(ep.id))) setNovelStageView('finalized')
        } finally {
            setBatchFinalizing(false)
        }
    }

    async function unfinalizeChapter(episodeId: string) {
        setSavingChapterId(episodeId)
        onMessage(null)
        try {
            const res = await clientFetch(`/api/episodes/${episodeId}/unfinalize`, { method: 'POST' })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            setEpisodeStatusOverrides(prev => ({ ...prev, [episodeId]: { status: 'drafted', finalizedAt: null, sourceVersion: project.episodes.find(ep => ep.id === episodeId)?.sourceVersion } }))
            onMessage({ type: 'success', text: '已解除定稿' })
            await onRefetch()
        } catch (e) {
            onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setSavingChapterId(null)
        }
    }

    async function confirmOutlineAndProceed() {
        const draftedChapters = project.episodes.filter(e => episodeHasChapterContent(e) || episodeHasScript(e) || isChapterFinalized(e.status) || (e._count?.storyboards ?? 0) > 0)
        if (draftedChapters.length > 0) {
            const nums = new Intl.ListFormat(locale).format(draftedChapters.map(e => t('第{number}章', { number: e.episodeNumber })))
            const ok = await confirm({
                title: '清空旧正文',
                message: `检测到 ${draftedChapters.length} 个章节已有后续内容（${nums}）。继续将清空全部章节正文（包括已定稿章节）、剧本、角色、场景及参考图、分镜和视频，保留当前大纲，重新开始写正文。`,
                confirmText: '清空并继续',
                tone: 'warning'
            })
            if (!ok) return
            onMessage(null)
            try {
                const res = await clientFetch(`/api/projects/${project.id}/reset-drafts`, { method: 'POST', body: JSON.stringify({ clearAllDownstream: true }) })
                const json = await res.json()
                if (!json.success) throw new Error(json.error)
                if (json.data?.cleared !== project.episodes.length) throw new Error('后续内容未完整重置，请刷新页面后重试')
                clearDownstreamClientState()
                onMessage({ type: 'success', text: `已清空 ${json.data.cleared} 章旧正文，接下来可逐章重新生成` })
                await onRefetch()
            } catch (e) {
                onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
                return
            }
        }
        setNovelStageView('drafting')
    }

    async function generateSingleScript(episodeId: string) {
        const current = project.episodes.find(episode => episode.id === episodeId)
        if (current && (episodeHasScript(current) || (current._count?.storyboards ?? 0) > 0)) {
            const accepted = await confirm({
                title: '重新拆本集剧本',
                message: '新剧本通过检查并保存后，将清空旧角色、场景及参考图，以及本集旧分镜、插图、视频、字幕和合成成片，后续需要重新生成。大纲和定稿正文保留。',
                confirmText: '重新拆剧本',
                tone: 'warning'
            })
            if (!accepted) return
        }
        if (scriptBatchIssue?.episodeId === episodeId) setScriptBatchIssue(null)
        cancelPendingAutoSaves(episodeId)
        setScriptingIds(prev => {
            const next = new Set(prev)
            next.add(episodeId)
            return next
        })
        onMessage(null)
        try {
            const jobId = await startScriptJob(episodeId)
            const result = await pollScriptJob(jobId)
            clearExtractionClientState()
            await loadEpisodeContent(episodeId, true)
            onMessage({ type: 'success', text: t('第{number}集剧本已生成', { number: result.episodeNumber }) })
            await onRefetch()
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e)
            if (current) {
                setScriptBatchIssue({
                    episodeId,
                    episodeNumber: current.episodeNumber,
                    attempts: 1,
                    reason,
                    remainingCount: project.episodes.filter(ep => ep.episodeNumber > current.episodeNumber && !episodeHasScript(ep)).length
                })
            } else onMessage({ type: 'error', text: reason })
        } finally {
            setScriptingIds(prev => {
                const next = new Set(prev)
                next.delete(episodeId)
                return next
            })
        }
    }

    async function batchScripts(mode: 'missing' | 'all') {
        if (scriptBatchRunning || scriptingIds.size > 0) return
        const ready = (e: ChapterEpisode) => e.status === 'finalized' || e.status === 'scripted' || e.status === 'storyboarded'
        const initialCandidates = project.episodes.filter(e => {
            if (!ready(e)) return false
            if (mode === 'missing') return !episodeHasScript(e)
            return true
        })
        if (initialCandidates.length === 0) {
            onMessage({
                type: 'error',
                text: mode === 'missing' ? '所有已定稿章节都已拆剧本' : '没有可拆剧本的章节（需先完成章节定稿）'
            })
            return
        }
        if (mode === 'all') {
            const ok = await confirm({
                title: '重新生成剧本',
                message: `将重新生成全部 ${initialCandidates.length} 集剧本。每集新剧本成功保存后，会清空旧角色、场景及参考图，以及该集旧分镜、插图、视频、字幕和合成成片，后续需要重新生成；大纲和定稿正文保留。`,
                confirmText: '重新生成',
                tone: 'warning'
            })
            if (!ok) return
        }

        onMessage(null)
        initialCandidates.forEach(episode => cancelPendingAutoSaves(episode.id))
        setScriptQueuedIds(new Set(initialCandidates.map(e => e.id)))
        setScriptBatchTotal(initialCandidates.length)
        setScriptBatchDone(0)
        setScriptBatchRunning(true)

        setScriptBatchIssue(null)
        try {
            const issue = await runScriptBatch({
                episodes: initialCandidates,
                generate: async ep => {
                    const jobId = await startScriptJob(ep.id)
                    await pollScriptJob(jobId)
                },
                onAttempt: ep => {
                    setScriptBatchIssue(null)
                    setSelectedScriptId(ep.id)
                    setScriptQueuedIds(prev => {
                        const next = new Set(prev)
                        next.delete(ep.id)
                        return next
                    })
                    setScriptingIds(new Set([ep.id]))
                },
                onComplete: async ep => {
                    clearExtractionClientState()
                    setScriptingIds(new Set())
                    setScriptBatchDone(done => done + 1)
                    await loadEpisodeContent(ep.id, true)
                    await refetchProjectQuietly()
                },
                onRetry: retry => {
                    setScriptingIds(new Set())
                    setScriptQueuedIds(prev => new Set(prev).add(retry.episodeId))
                    setScriptBatchIssue(retry)
                }
            })
            setScriptBatchIssue(issue)
            if (!issue) onMessage({ type: 'success', text: t('拆剧本完成，共 {count} 集', { count: initialCandidates.length }) })
            await refetchProjectQuietly()
        } finally {
            setScriptQueuedIds(new Set())
            setScriptingIds(new Set())
            setScriptBatchRunning(false)
            setScriptBatchTotal(0)
            setScriptBatchDone(0)
        }
    }

    function updateCharList(key: 'mainCharacters' | 'supportingCharacters', index: number, patch: Partial<NovelCharacterInput>) {
        const list = [...(setup[key] ?? [])]
        list[index] = { ...list[index], ...patch }
        setSetup({ ...setup, [key]: list })
    }
    function addCharRow(key: 'mainCharacters' | 'supportingCharacters') {
        const list = [...(setup[key] ?? []), { name: '' }]
        setSetup({ ...setup, [key]: list })
    }
    function removeCharRow(key: 'mainCharacters' | 'supportingCharacters', index: number) {
        const list = [...(setup[key] ?? [])]
        list.splice(index, 1)
        setSetup({ ...setup, [key]: list })
    }
    function toggleAppeal(tag: string) {
        const curr = new Set(setup.appealTags ?? [])
        if (curr.has(tag)) curr.delete(tag)
        else curr.add(tag)
        setSetup({ ...setup, appealTags: Array.from(curr) })
    }
    function addCustomAppeal() {
        const tag = customAppealTag.trim()
        if (!tag) return
        const curr = new Set(setup.appealTags ?? [])
        curr.add(tag)
        setSetup({ ...setup, appealTags: Array.from(curr) })
        setCustomAppealTag('')
    }
    function updateKeyPlot(index: number, value: string) {
        const list = [...(setup.keyPlots ?? [])]
        list[index] = value
        setSetup({ ...setup, keyPlots: list })
    }
    function addKeyPlot() {
        setSetup({ ...setup, keyPlots: [...(setup.keyPlots ?? []), ''] })
    }
    function removeKeyPlot(index: number) {
        const list = [...(setup.keyPlots ?? [])]
        list.splice(index, 1)
        setSetup({ ...setup, keyPlots: list })
    }

    function toggleSynopsis(episodeId: string) {
        setExpandedSynopsisIds(prev => {
            const next = new Set(prev)
            if (next.has(episodeId)) next.delete(episodeId)
            else next.add(episodeId)
            return next
        })
    }

    const isStage3 = currentStage === 'drafting' || (currentStage === 'finalized' && !allFinalized)
    const isStage4 = currentStage === 'finalized' && allFinalized
    const outerCls = isStage3 || isStage4 ? 'studio-novel flex min-h-0 flex-col h-full' : 'studio-novel studio-novel-scroll space-y-6 overflow-y-auto h-full novel-scroll'

    return (
        <div className={outerCls}>
            {confirmDialog}
            {/* Stage 1: Setup */}
            {currentStage === 'setup' && (
                <div className="studio-panel rounded-2xl p-5 sm:p-7 space-y-7">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                            <h2 className="text-white font-semibold flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-purple-400" />
                                小说架构
                            </h2>
                            <p className="text-xs text-gray-400 mt-1">越具体，AI 生成的大纲和正文越贴近你的预期</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <WalletBalance compact />
                            <div className="min-w-[170px]">
                                <ModelSwitcher
                                    title="架构与大纲模型"
                                    prefix="架构/大纲"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 核心设定 */}
                    <div>
                        <div className="text-xs text-gray-300 font-medium mb-2">核心设定</div>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="剧集形态">
                                <CustomSelect
                                    ariaLabel="剧集形态"
                                    value={setup.episodeFormat ?? 'micro'}
                                    onChange={episodeFormat => setSetup({ ...setup, episodeFormat: episodeFormat as EpisodeFormat })}
                                    buttonClassName={inputCls}
                                    options={listEpisodeFormats().map(({ value, spec }) => ({ value, label: spec.label }))}
                                />
                            </Field>
                            <Field label="章节数（即剧集数）">
                                <input
                                    type="number"
                                    min={1}
                                    value={episodeCount}
                                    onFocus={event => event.currentTarget.select()}
                                    onChange={e => setEpisodeCount(Math.max(1, Number(e.target.value) || 1))}
                                    className={inputCls}
                                />
                            </Field>
                            <Field label="整部剧目标总字数（自动按章平分）">
                                <input
                                    type="number"
                                    value={setup.targetWordCount ?? ''}
                                    onChange={e => setSetup({ ...setup, targetWordCount: e.target.value ? Number(e.target.value) : undefined })}
                                    placeholder={`建议 ${episodeCount * getEpisodeFormatSpec(setup.episodeFormat).chapterWordHint}（约每章 ${getEpisodeFormatSpec(setup.episodeFormat).chapterWordHint} 字）`}
                                    className={inputCls}
                                />
                            </Field>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                            当前形态：<b className="text-gray-300">{getEpisodeFormatSpec(setup.episodeFormat).label}</b> · 单集剧本 {getEpisodeFormatSpec(setup.episodeFormat).minWords}-
                            {getEpisodeFormatSpec(setup.episodeFormat).maxWords} 字 · {getEpisodeFormatSpec(setup.episodeFormat).shotCountHint} ·{' '}
                            {getEpisodeFormatSpec(setup.episodeFormat).shotDurationHint}。 改这个**只影响新拆的剧本**，已有剧本不会自动重生成。
                        </p>
                        {episodeCount !== project.totalEpisodes && (
                            <p className="text-xs text-yellow-400 mt-2">
                                章节数已修改（{project.totalEpisodes} → {episodeCount}），点击「保存设定」或「生成大纲」后生效。
                                {episodeCount < project.totalEpisodes && '减少章节数时，已有正文或已定稿的章节会阻止保存。'}
                            </p>
                        )}
                    </div>

                    {/* 创作风格（可选） */}
                    <div>
                        <button
                            type="button"
                            onClick={() => setShowStyleOptions(v => !v)}
                            className="flex items-center gap-1 text-xs text-gray-300 font-medium mb-2 hover:text-white">
                            {showStyleOptions ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            类型与写作参数（高级）
                        </button>
                        {showStyleOptions && (
                            <>
                                <div className="mb-3">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <div className="text-xs text-gray-400">主类型</div>
                                        <div className="text-[10px] text-gray-500">单选</div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {PROJECT_GENRES.map(genre => {
                                            const active = canonicalProjectGenreLabel(setup.primaryGenre || project.genre) === genre.label
                                            return (
                                                <button
                                                    key={genre.code}
                                                    type="button"
                                                    onClick={() => setSetup({ ...setup, primaryGenre: genre.label })}
                                                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                                                        active ? 'bg-white text-gray-950' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                    }`}>
                                                    {t(genre.label)}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <Field label="叙事视角">
                                        <CustomSelect
                                            ariaLabel="叙事视角"
                                            value={setup.perspective ?? ''}
                                            onChange={perspective => setSetup({ ...setup, perspective })}
                                            buttonClassName={inputCls}
                                            options={[
                                                { value: '', label: '不限' },
                                                { value: '第一人称', label: '第一人称' },
                                                { value: '第三人称', label: '第三人称' },
                                                { value: '多人称切换', label: '多人称切换' }
                                            ]}
                                        />
                                    </Field>
                                    <Field label="节奏">
                                        <CustomSelect
                                            ariaLabel="叙事节奏"
                                            value={setup.pace ?? ''}
                                            onChange={pace => setSetup({ ...setup, pace })}
                                            buttonClassName={inputCls}
                                            options={[
                                                { value: '', label: '不限' },
                                                { value: '快节奏', label: '快节奏' },
                                                { value: '中等节奏', label: '中等节奏' },
                                                { value: '慢节奏', label: '慢节奏' }
                                            ]}
                                        />
                                    </Field>
                                    <Field label="语气">
                                        <input
                                            value={setup.tone ?? ''}
                                            onChange={e => setSetup({ ...setup, tone: e.target.value })}
                                            placeholder="如：冷峻、轻松、热血"
                                            className={inputCls}
                                        />
                                    </Field>
                                </div>
                                <div className="mt-3">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <div className="text-xs text-gray-400">爽点 / 辅类型标签</div>
                                        <div className="text-[10px] text-gray-500">可多选</div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {APPEAL_OPTIONS.map(tag => {
                                            const active = setup.appealTags?.includes(tag)
                                            return (
                                                <button
                                                    key={tag}
                                                    type="button"
                                                    onClick={() => toggleAppeal(tag)}
                                                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                                                        active ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                    }`}>
                                                    {tag}
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        <input
                                            value={customAppealTag}
                                            onChange={e => setCustomAppealTag(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault()
                                                    addCustomAppeal()
                                                }
                                            }}
                                            placeholder="自定义标签，如：克苏鲁、校园、追妻火葬场"
                                            className="flex-1 bg-gray-900 border border-gray-800 text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={addCustomAppeal}
                                            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700">
                                            添加
                                        </button>
                                    </div>
                                    {(setup.appealTags ?? []).some(tag => !APPEAL_OPTIONS.includes(tag)) && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {(setup.appealTags ?? [])
                                                .filter(tag => !APPEAL_OPTIONS.includes(tag))
                                                .map(tag => (
                                                    <button
                                                        key={tag}
                                                        type="button"
                                                        onClick={() => toggleAppeal(tag)}
                                                        className="rounded-full bg-purple-950/70 px-2.5 py-1 text-xs text-purple-100 hover:bg-purple-900">
                                                        {tag} ×
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <div className="text-xs text-gray-400">风格参考图</div>
                                        <div className="text-[10px] text-gray-500">最多 4 张，按排列顺序优先；样张只代表风格方向</div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {(setup.styleReferenceImages ?? []).map(url => (
                                            <div
                                                key={url}
                                                className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-800 group">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={url}
                                                    alt="风格参考"
                                                    className="w-full h-full object-cover"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeStyleImage(url)}
                                                    title="移除"
                                                    className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-black/75 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity">
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                        <label
                                            className={`w-24 h-24 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs cursor-pointer transition-colors ${
                                                uploadingStyleImage || (setup.styleReferenceImages?.length ?? 0) >= 4
                                                    ? 'border-gray-700 text-gray-500 cursor-not-allowed'
                                                    : 'border-gray-700 text-gray-400 hover:border-purple-500 hover:text-purple-300'
                                            }`}>
                                            <input
                                                ref={styleImageInputRef}
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp,image/gif"
                                                className="hidden"
                                                disabled={uploadingStyleImage || (setup.styleReferenceImages?.length ?? 0) >= 4}
                                                onChange={e => {
                                                    const file = e.target.files?.[0]
                                                    if (file) uploadStyleImage(file)
                                                }}
                                            />
                                            {uploadingStyleImage ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    <span>上传中</span>
                                                </>
                                            ) : (setup.styleReferenceImages?.length ?? 0) >= 4 ? (
                                                <span>已达 4 张上限</span>
                                            ) : (
                                                <>
                                                    <Upload className="w-4 h-4" />
                                                    <span>上传图片</span>
                                                </>
                                            )}
                                        </label>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 故事圣经 */}
                    <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={() => setShowStoryBible(v => !v)}
                                className="flex items-center gap-1 text-xs text-gray-300 font-medium hover:text-white">
                                {showStoryBible ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                故事架构
                                {setup.episodeStatePlan?.length ? <span className="text-gray-500 font-normal">已生成 {setup.episodeStatePlan.length} 集状态计划</span> : null}
                            </button>
                            <button
                                type="button"
                                onClick={runSetupArchitect}
                                disabled={!!runningAi || savingSetup}
                                className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50">
                                {runningAi === 'setup' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                {runningAi === 'setup' ? '生成中...' : 'AI 生成故事架构'}
                            </button>
                        </div>
                        {showStoryBible && (
                            <div className="space-y-3">
                                <Field label="核心种子">
                                    <textarea
                                        rows={3}
                                        value={setup.coreSeed ?? ''}
                                        onChange={e => setSetup({ ...setup, coreSeed: e.target.value })}
                                        placeholder="一句话故事承诺、主角欲望、核心冲突、反派阻力、爽点公式。例：被夺走身份的女主用商业天赋逆袭豪门，男主从利用到守护。"
                                        className={inputCls}
                                    />
                                </Field>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <Field label="世界观规则">
                                        <textarea
                                            rows={4}
                                            value={setup.worldBible ?? ''}
                                            onChange={e => setSetup({ ...setup, worldBible: e.target.value })}
                                            placeholder="时代、城市、阶层、职业系统、家族/组织规则、能力边界、禁忌、视觉边界。"
                                            className={inputCls}
                                        />
                                    </Field>
                                    <Field label="情节架构">
                                        <textarea
                                            rows={4}
                                            value={setup.plotArchitecture ?? ''}
                                            onChange={e => setSetup({ ...setup, plotArchitecture: e.target.value })}
                                            placeholder="开端事件、中段反转、阶段高潮、终局爆点，以及每一季/每一阶段承担的戏剧功能。"
                                            className={inputCls}
                                        />
                                    </Field>
                                </div>
                                <Field label="角色弧光 / 角色状态规则">
                                    <textarea
                                        rows={4}
                                        value={setup.characterArcs ?? ''}
                                        onChange={e => setSetup({ ...setup, characterArcs: e.target.value })}
                                        placeholder="主要角色的目标、秘密、关系张力、情绪变化、不可违背的行为准则。例：女主前 5 集不能主动暴露真实身份；男主第 8 集前只暗中保护。"
                                        className={inputCls}
                                    />
                                </Field>
                                {setup.episodeStatePlan?.length ? (
                                    <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                                        <div className="text-xs text-gray-400 mb-2">每集状态计划</div>
                                        <div className="space-y-1 max-h-36 overflow-y-auto novel-scroll">
                                            {setup.episodeStatePlan.map(item => (
                                                <div
                                                    key={item.episodeNumber}
                                                    className="text-[11px] text-gray-500 leading-relaxed">
                                                    <span className="text-gray-300">第{item.episodeNumber}集</span>
                                                    {item.openingState ? `｜开场：${item.openingState}` : ''}
                                                    {item.endingState ? `｜结尾：${item.endingState}` : ''}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>

                    {/* 人物设定 */}
                    <div>
                        <div className="text-xs text-gray-300 font-medium mb-2 flex items-center justify-between">
                            <span>主角</span>
                            <button
                                onClick={() => addCharRow('mainCharacters')}
                                className="text-purple-400 text-xs flex items-center gap-1">
                                <Plus className="w-3 h-3" />
                                添加
                            </button>
                        </div>
                        <div className="space-y-2">
                            {(setup.mainCharacters ?? []).map((c, i) => (
                                <CharRow
                                    key={i}
                                    value={c}
                                    onChange={p => updateCharList('mainCharacters', i, p)}
                                    onRemove={() => removeCharRow('mainCharacters', i)}
                                />
                            ))}
                            {(setup.mainCharacters ?? []).length === 0 && <div className="text-xs text-gray-500 italic">尚未添加主角</div>}
                        </div>
                        <div className="text-xs text-gray-300 font-medium mb-2 mt-4 flex items-center justify-between">
                            <span>配角</span>
                            <button
                                onClick={() => addCharRow('supportingCharacters')}
                                className="text-purple-400 text-xs flex items-center gap-1">
                                <Plus className="w-3 h-3" />
                                添加
                            </button>
                        </div>
                        <div className="space-y-2">
                            {(setup.supportingCharacters ?? []).map((c, i) => (
                                <CharRow
                                    key={i}
                                    value={c}
                                    onChange={p => updateCharList('supportingCharacters', i, p)}
                                    onRemove={() => removeCharRow('supportingCharacters', i)}
                                />
                            ))}
                        </div>
                        <div className="mt-3">
                            <Field label="人物关系">
                                <textarea
                                    rows={2}
                                    value={setup.relationships ?? ''}
                                    onChange={e => setSetup({ ...setup, relationships: e.target.value })}
                                    placeholder="如：林晓薇是陈默的青梅竹马，陈母反对两人在一起..."
                                    className={inputCls}
                                />
                            </Field>
                        </div>
                    </div>

                    {/* 剧情大纲 */}
                    <div>
                        <div className="text-xs text-gray-300 font-medium mb-2">剧情大纲</div>
                        <Field
                            label="整体大纲（自由描述）"
                            actions={
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => runOutlineTextAction('rewrite')}
                                        disabled={!!runningAi || savingSetup || !setup.outline?.trim()}
                                        title={t('改写')}
                                        aria-label={t('改写')}
                                        className="inline-flex h-7 items-center gap-1 rounded-md border border-purple-500/25 bg-purple-500/10 px-2 text-[11px] font-medium text-purple-200 transition-colors hover:border-purple-400/45 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40">
                                        <RefreshCw className={`h-3 w-3 ${runningAi === 'outline-rewrite' ? 'animate-spin' : ''}`} />
                                        {runningAi === 'outline-rewrite' ? t('改写中...') : t('改写')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => runOutlineTextAction('expand')}
                                        disabled={!!runningAi || savingSetup || !setup.outline?.trim()}
                                        title={t('扩写')}
                                        aria-label={t('扩写')}
                                        className="inline-flex h-7 items-center gap-1 rounded-md border border-purple-500/25 bg-purple-500/10 px-2 text-[11px] font-medium text-purple-200 transition-colors hover:border-purple-400/45 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40">
                                        <Sparkles className={`h-3 w-3 ${runningAi === 'outline-expand' ? 'animate-pulse' : ''}`} />
                                        {runningAi === 'outline-expand' ? t('扩写中...') : t('扩写')}
                                    </button>
                                </div>
                            }>
                            <textarea
                                rows={4}
                                value={setup.outline ?? ''}
                                onChange={e => setSetup({ ...setup, outline: e.target.value })}
                                placeholder="故事的主线剧情、起承转合..."
                                className={inputCls}
                            />
                        </Field>
                        <div className="mt-3">
                            <div className="text-xs text-gray-400 mb-1.5 flex items-center justify-between">
                                <span>关键情节点</span>
                                <button
                                    onClick={addKeyPlot}
                                    className="text-purple-400 text-xs flex items-center gap-1">
                                    <Plus className="w-3 h-3" />
                                    添加
                                </button>
                            </div>
                            <div className="space-y-2">
                                {(setup.keyPlots ?? []).map((p, i) => (
                                    <div
                                        key={i}
                                        className="flex gap-2">
                                        <input
                                            value={p}
                                            onChange={e => updateKeyPlot(i, e.target.value)}
                                            placeholder="如：女主发现男主藏着一个秘密"
                                            className={inputCls}
                                        />
                                        <button
                                            onClick={() => removeKeyPlot(i)}
                                            className="text-gray-500 hover:text-red-400">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 操作 */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={() => saveSetup()}
                            disabled={savingSetup}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-sm rounded-lg">
                            <Save className="w-4 h-4" />
                            {savingSetup ? '保存中...' : '保存设定'}
                        </button>
                        <button
                            onClick={runOutline}
                            disabled={!!runningAi}
                            className="flex items-center gap-2 px-4 py-2 studio-primary disabled:opacity-50 text-white text-sm rounded-lg">
                            <Wand2 className="w-4 h-4" />
                            {runningAi === 'outline' ? '生成大纲中...' : '生成大纲 →'}
                        </button>
                        {runningAi === 'outline' && (
                            <button
                                onClick={cancelOutline}
                                disabled={cancellingOutline}
                                className="flex items-center gap-2 px-4 py-2 border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-300 text-sm rounded-lg">
                                <Square className="w-3.5 h-3.5 fill-current" />
                                {cancellingOutline ? ui('正在取消...', 'Cancelling...') : ui('取消生成', 'Cancel generation')}
                            </button>
                        )}
                        {hasOutline && (
                            <button
                                onClick={() => setNovelStageView('outlined')}
                                className="text-sm text-purple-400 hover:text-purple-300 ms-auto">
                                已有大纲，跳到下一步 →
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Stage 2: Outline */}
            {currentStage === 'outlined' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex min-w-0 flex-1 basis-80 items-center gap-4">
                            <h2 className="shrink-0 text-white font-semibold">大纲确认</h2>
                            {runningAi === 'outline' && (
                                <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-purple-300">
                                    <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
                                    <div
                                        role="progressbar"
                                        aria-label={t('生成大纲中...')}
                                        aria-valuemin={0}
                                        aria-valuemax={outlineProgress?.total ?? project.totalEpisodes}
                                        aria-valuenow={outlineProgress?.received ?? 0}
                                        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-purple-950/70">
                                        <div
                                            className="progress-flow h-full rounded-full bg-purple-400"
                                            style={{ width: `${outlineProgress?.total ? Math.round((outlineProgress.received / outlineProgress.total) * 100) : 0}%` }}
                                        />
                                    </div>
                                    <span className="shrink-0 tabular-nums">
                                        {outlineProgress?.received ?? 0}/{outlineProgress?.total ?? project.totalEpisodes}
                                    </span>
                                    <button
                                        onClick={cancelOutline}
                                        disabled={cancellingOutline}
                                        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-red-400/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/20 disabled:opacity-50">
                                        <Square className="h-3 w-3 fill-current" />
                                        {cancellingOutline ? ui('正在取消...', 'Cancelling...') : ui('取消生成', 'Cancel')}
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 items-center flex-wrap">
                            <WalletBalance compact />
                            <div className="min-w-[160px]">
                                <ModelSwitcher
                                    title="架构与大纲模型"
                                    prefix="架构/大纲"
                                />
                            </div>
                            <button
                                onClick={runOutline}
                                disabled={!!runningAi}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-sm rounded-lg">
                                <RefreshCw className={`w-4 h-4 ${runningAi === 'outline' ? 'animate-spin' : ''}`} />
                                {runningAi === 'outline' ? '重新生成中...' : '重新生成大纲'}
                            </button>
                            {hasAnyOutline && missingOutlineNumbers.length > 0 && !runningAi && (
                                <button
                                    onClick={continueMissingOutline}
                                    className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg"
                                    title={`仅补充缺少梗概的章节：${missingOutlineNumbers.join('、')}`}>
                                    继续生成剩余大纲 ({missingOutlineNumbers.length})
                                </button>
                            )}
                            <button
                                onClick={confirmOutlineAndProceed}
                                disabled={!!runningAi || missingOutlineNumbers.length > 0}
                                title={missingOutlineNumbers.length > 0 ? `还有 ${missingOutlineNumbers.length} 章缺少大纲，请先补充完整` : undefined}
                                className="flex items-center gap-2 px-3 py-2 studio-primary disabled:opacity-40 text-white text-sm rounded-lg">
                                确认大纲，开始写正文 →
                            </button>
                        </div>
                    </div>
                    <div className="studio-outline-layout">
                        <div className="space-y-4 min-w-0">
                            {runningAi === 'outline' && project.episodes.length === 0
                                ? Array.from({ length: project.totalEpisodes || project.episodes.length || 6 }).map((_, idx) => (
                                      <div
                                          key={`skeleton-${idx}`}
                                          className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
                                          <div className="flex items-start gap-3">
                                              <div className="w-9 h-9 rounded-lg bg-gray-800 flex-shrink-0 flex items-center justify-center text-gray-700 font-bold text-xs">{idx + 1}</div>
                                              <div className="flex-1 space-y-3 min-w-0">
                                                  <div className="h-4 bg-gray-800 rounded w-1/3" />
                                                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3 space-y-2">
                                                      <div className="h-2.5 bg-gray-800 rounded w-full" />
                                                      <div className="h-2.5 bg-gray-800 rounded w-11/12" />
                                                      <div className="h-2.5 bg-gray-800 rounded w-9/12" />
                                                      <div className="h-2.5 bg-gray-800 rounded w-10/12" />
                                                  </div>
                                              </div>
                                              <span className="text-[10px] text-gray-700 bg-gray-800/60 px-1.5 py-0.5 rounded flex-shrink-0">⚡ —</span>
                                          </div>
                                      </div>
                                  ))
                                : project.episodes.map(ep => {
                                      const draft = chapterDrafts[ep.id] ?? { title: '', synopsis: '', chapterContent: '' }
                                      const waitingForOutline = runningAi === 'outline' && !draft.synopsis.trim()
                                      return (
                                          <div
                                              key={ep.id}
                                              className={`studio-outline-card border ${waitingForOutline ? 'border-amber-500/30' : 'border-gray-800'}`}>
                                              <div className="flex items-start gap-3">
                                                  <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center text-purple-400 font-bold text-xs flex-shrink-0">
                                                      {ep.episodeNumber}
                                                  </div>
                                                  <div className="flex-1 space-y-2 min-w-0">
                                                      <input
                                                          value={draft.title}
                                                          onChange={e => {
                                                              const next = e.target.value
                                                              setChapterDrafts({ ...chapterDrafts, [ep.id]: { ...draft, title: next } })
                                                              if (next !== (ep.title ?? '')) scheduleAutoSave(ep.id, { title: next })
                                                          }}
                                                          onBlur={() => {
                                                              if (draft.title !== (ep.title ?? '')) patchEpisode(ep.id, { title: draft.title })
                                                          }}
                                                          placeholder={t('第{number}章标题', { number: ep.episodeNumber })}
                                                          className="w-full bg-transparent border-b border-gray-800 text-white font-medium focus:outline-none focus:border-purple-500 pb-1"
                                                      />
                                                      {(() => {
                                                          const expanded = expandedSynopsisIds.has(ep.id)
                                                          return (
                                                              <div className={`rounded-lg border bg-gray-950 transition-colors ${expanded ? 'border-purple-500/50' : 'border-gray-800'}`}>
                                                                  <div className={`flex items-center justify-between gap-2 px-3 py-2 ${expanded ? 'border-b border-gray-800' : ''}`}>
                                                                      <div className="flex min-w-0 items-center gap-2">
                                                                          <div className="text-[11px] font-medium text-gray-300">本章梗概</div>
                                                                          <div className={`text-[10px] ${waitingForOutline ? 'text-amber-400/80' : 'text-gray-600'}`}>
                                                                              {waitingForOutline ? t('本批漏章，正在自动补齐…') : t('{count} 字', { count: draft.synopsis.trim().length || 0 })}
                                                                          </div>
                                                                      </div>
                                                                      <button
                                                                          type="button"
                                                                          onClick={() => toggleSynopsis(ep.id)}
                                                                          aria-expanded={expanded}
                                                                          aria-controls={`chapter-synopsis-${ep.id}`}
                                                                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-purple-300 hover:bg-purple-500/10">
                                                                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                                                          {expanded ? '收起' : '展开'}
                                                                      </button>
                                                                  </div>
                                                                  {!expanded && (
                                                                      <p
                                                                          data-i18n-skip
                                                                          className="line-clamp-3 px-4 pb-4 text-sm leading-7 text-slate-300">
                                                                          {draft.synopsis || t('本章梗概')}
                                                                      </p>
                                                                  )}
                                                                  {expanded && (
                                                                      <textarea
                                                                          id={`chapter-synopsis-${ep.id}`}
                                                                          value={draft.synopsis}
                                                                          onChange={e => {
                                                                              const next = e.target.value
                                                                              setChapterDrafts({ ...chapterDrafts, [ep.id]: { ...draft, synopsis: next } })
                                                                              if (next !== (ep.synopsis ?? '')) scheduleAutoSave(ep.id, { synopsis: next })
                                                                          }}
                                                                          onBlur={() => {
                                                                              if (draft.synopsis !== (ep.synopsis ?? '')) patchEpisode(ep.id, { synopsis: draft.synopsis })
                                                                          }}
                                                                          rows={9}
                                                                          placeholder={waitingForOutline ? '正在自动补齐本章梗概，请稍候…' : '本章梗概'}
                                                                          className="min-h-56 w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed text-gray-300 focus:outline-none novel-scroll"
                                                                      />
                                                                  )}
                                                              </div>
                                                          )
                                                      })()}
                                                  </div>
                                                  {ep.intensity != null && (
                                                      <span
                                                          className="text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded flex-shrink-0"
                                                          title={`情节强度 ${ep.intensity}/10`}>
                                                          ⚡{ep.intensity}
                                                      </span>
                                                  )}
                                                  {savingChapterId === ep.id && <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />}
                                                  {savingChapterId !== ep.id && autoSavedFlash[ep.id] && <span className="text-[10px] text-green-400 flex-shrink-0">✓ 已保存</span>}
                                              </div>
                                          </div>
                                      )
                                  })}
                        </div>
                        <IntensityCurve episodes={project.episodes} />
                    </div>
                </div>
            )}

            {isStage3 && project.episodes.length > 0 && (
                <section
                    aria-label={t('章节正文')}
                    className="studio-chapter-toolbar flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-purple-500/15 bg-purple-500/[0.04] px-4 py-1 lg:px-6">
                    <dl
                        className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs"
                        aria-live="polite">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <dt className="text-slate-400">{t('已生成')}</dt>
                            <dd className="flex items-center gap-1.5 font-medium tabular-nums text-blue-300">
                                {batchRunning && <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-purple-300" />}
                                {chapterProgress.generated}/{chapterProgress.total}
                            </dd>
                        </div>
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <dt className="text-slate-400">{t('已定稿')}</dt>
                            <dd className="font-medium tabular-nums text-emerald-200/80">
                                {chapterProgress.finalized}/{chapterProgress.total}
                            </dd>
                        </div>
                    </dl>
                    {batchRunning && (
                        <div
                            className="flex min-w-[180px] max-w-[520px] flex-1 items-center gap-2"
                            title="严格按章节顺序生成，失败会暂停，避免剧情断层">
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-800">
                                <div
                                    className="progress-flow h-full rounded-full bg-gradient-to-r from-purple-400 to-blue-400"
                                    style={{ width: `${chapterBatchProgress}%` }}
                                />
                            </div>
                            <span className="shrink-0 text-[11px] tabular-nums text-purple-200">
                                {chapterBatchDone}/{chapterBatchTotal}
                            </span>
                        </div>
                    )}
                    <div className="ms-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <WalletBalance compact />
                        <div className="hidden min-w-[160px] md:block">
                            <ModelSwitcher
                                providerKey="chapter_model"
                                title="章节正文模型"
                                prefix="正文"
                                defaultModel={GEMINI_FLASH_TEXT_MODEL_ID}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                if (allFinalized) setNovelStageView('finalized')
                                else if (chapterProgress.missing === 0) void batchFinalize(true)
                                else void batchGenerate('missing')
                            }}
                            disabled={chapterActionsBusy}
                            className="studio-primary disabled:cursor-not-allowed disabled:opacity-50">
                            {chapterActionsBusy ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : allFinalized ? (
                                <Split className="h-3.5 w-3.5" />
                            ) : chapterProgress.missing > 0 ? (
                                <Wand2 className="h-3.5 w-3.5" />
                            ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            {batchFinalizing
                                ? t('批量定稿中...')
                                : batchRunning || generatingChapterIds.size > 0
                                  ? t('生成中...')
                                  : savingChapterId !== null
                                    ? t('保存中...')
                                    : allFinalized
                                      ? t('进入拆剧本')
                                      : chapterProgress.missing === 0
                                        ? t('确认定稿并继续')
                                        : chapterProgress.generated === 0 && !chapterBatchPaused
                                          ? t('生成章节正文')
                                          : t('继续生成剩余章节')}
                        </button>
                    </div>
                </section>
            )}

            {/* Stage 3: Drafting — 全宽左右分栏 */}
            {isStage3 &&
                (() => {
                    const selected = project.episodes.find(e => e.id === selectedChapterId) ?? project.episodes[0]
                    if (!selected) return null
                    const draft = chapterDrafts[selected.id] ?? { title: '', synopsis: '', chapterContent: '' }
                    const isFinalized = isChapterFinalized(selected.status)
                    const hasContent = episodeHasChapterContent(selected) || !!draft.chapterContent.trim()
                    const contentLoading = loadingEpisodeIds.has(selected.id) || (episodeHasChapterContent(selected) && !isEpisodeContentCurrent(selected, episodeDetails[selected.id]))
                    const gen = generatingChapterIds.has(selected.id)
                    const queued = queuedChapterIds.has(selected.id)
                    const saving = savingChapterId === selected.id
                    const missingPreviousForSelected = project.episodes.filter(e => e.episodeNumber < selected.episodeNumber && !episodeHasChapterContent(e))
                    const canGenerateSelected = missingPreviousForSelected.length === 0
                    return (
                        <div className="studio-writing-layout flex-1 min-h-0 flex">
                            {/* 左侧章节菜单 —— 贴页面左边 */}
                            <aside className="w-64 flex-shrink-0 border-e border-gray-800 bg-gray-950 flex flex-col">
                                <nav className="flex-1 overflow-y-auto novel-scroll p-2 space-y-1">
                                    {project.episodes.map(ep => {
                                        const epGen = generatingChapterIds.has(ep.id)
                                        const epQueued = queuedChapterIds.has(ep.id)
                                        const epFinal = isChapterFinalized(ep.status)
                                        const epHasContent = episodeHasChapterContent(ep) || !!chapterDrafts[ep.id]?.chapterContent?.trim()
                                        const epFailed = !epHasContent && chapterBatchPaused?.episodeNumber === ep.episodeNumber
                                        const isActive = selected.id === ep.id
                                        return (
                                            <button
                                                key={ep.id}
                                                type="button"
                                                aria-current={isActive ? 'true' : undefined}
                                                onClick={() => setSelectedChapterId(ep.id)}
                                                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-accent) ${
                                                    isActive
                                                        ? 'border-(--app-border-strong) bg-(--app-accent-soft)'
                                                        : epFailed
                                                          ? 'border-red-500/25 bg-red-500/5 hover:bg-red-500/10'
                                                          : 'border-transparent hover:bg-gray-800/60'
                                                }`}>
                                                <span
                                                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                                        epFinal
                                                            ? 'bg-emerald-500/10 text-emerald-400'
                                                            : epGen
                                                              ? 'bg-purple-500/20 text-purple-200'
                                                              : epQueued
                                                                ? 'bg-amber-500/15 text-amber-300'
                                                                : epFailed
                                                                  ? 'bg-red-500/15 text-red-300'
                                                                  : epHasContent
                                                                    ? 'bg-blue-500/15 text-blue-300'
                                                                    : 'bg-gray-800/50 text-gray-400'
                                                    }`}>
                                                    {ep.episodeNumber}
                                                </span>
                                                <span
                                                    data-i18n-skip
                                                    className={`flex-1 min-w-0 text-sm truncate ${isActive ? 'font-medium text-(--app-text)' : 'text-gray-300'}`}>
                                                    {ep.title ?? t('第{number}章', { number: ep.episodeNumber })}
                                                </span>
                                                {epGen ? (
                                                    <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-200">
                                                        <RefreshCw className="h-3 w-3 animate-spin" />
                                                        {t('生成中')}
                                                    </span>
                                                ) : epQueued ? (
                                                    <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                                                        <Clock3 className="h-3 w-3" />
                                                        {t('即将')}
                                                    </span>
                                                ) : epFinal ? (
                                                    <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                                                        <Lock className="h-3 w-3" />
                                                        {t('已定稿')}
                                                    </span>
                                                ) : epFailed ? (
                                                    <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        {t('失败')}
                                                    </span>
                                                ) : epHasContent ? (
                                                    <span className="flex flex-shrink-0 items-center gap-1 rounded-md border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        {t('已生成')}
                                                    </span>
                                                ) : (
                                                    <span className="flex-shrink-0 text-[11px] text-gray-500">{t('未生成')}</span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </nav>
                                {(batchRunning || chapterBatchPaused || unfinalizedChapterCount > 0) && (
                                    <div className="shrink-0 space-y-2 border-t border-gray-800 p-2">
                                        {chapterBatchPaused && !batchRunning && (
                                            <div
                                                role="status"
                                                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                                                <div className="text-[11px] font-medium text-amber-200">{t('顺序生成已暂停')}</div>
                                                <div className="mt-1 text-[10px] leading-relaxed text-amber-200/70">
                                                    {t('第 {chapter} 章生成中断，已完成的正文已保留。请使用顶部按钮继续生成。').replace('{chapter}', String(chapterBatchPaused.episodeNumber))}
                                                </div>
                                                <div className="mt-1 max-h-20 overflow-y-auto break-words text-[10px] leading-relaxed text-amber-200/70">{chapterBatchPaused.reason}</div>
                                            </div>
                                        )}
                                        {unfinalizedChapterCount > 0 && (
                                            <div className="space-y-2">
                                                <button
                                                    type="button"

                                                    onClick={() => void batchGenerate('all')}
                                                    disabled={chapterActionsBusy}
                                                    className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50">
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                    {t('顺序重写全部')}
                                                </button>
                                                {chapterProgress.missing > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void batchFinalize()}
                                                        disabled={chapterActionsBusy}
                                                        className="studio-secondary flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50">
                                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                                        {batchFinalizing ? t('批量定稿中...') : `${t('仅定稿已有正文')} (${unfinalizedChapterCount})`}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </aside>

                            {/* 右侧编辑区 */}
                            <section className="flex-1 min-w-0 flex flex-col bg-gray-950">
                                {/* 主体 */}
                                <div className="flex-1 min-h-0 overflow-y-auto novel-scroll px-6 py-4 flex flex-col gap-4">
                                    <div className="flex-1 flex flex-col min-h-0">
                                        {draft.chapterContent && <div className="mb-1 text-end text-[11px] text-gray-500">{draft.chapterContent.length} 字</div>}
                                        {hasContent || gen || queued ? (
                                            <textarea
                                                value={draft.chapterContent}
                                                onChange={e => {
                                                    const next = e.target.value
                                                    setChapterDrafts({ ...chapterDrafts, [selected.id]: { ...draft, chapterContent: next } })
                                                    // eslint-disable-next-line react-hooks/refs
                                                    if (next !== (selected.chapterContent ?? '')) scheduleAutoSave(selected.id, { chapterContent: next }, 2000)
                                                }}
                                                disabled={isFinalized || gen || queued || contentLoading || batchFinalizing}
                                                placeholder={contentLoading ? '正在加载本章正文...' : gen ? '生成中...' : queued ? '即将开始...' : ''}
                                                className="studio-chapter-editor flex-1 min-h-[420px] w-full bg-gray-900 border border-gray-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-purple-500 resize-none font-mono leading-relaxed novel-scroll disabled:opacity-80"
                                            />
                                        ) : (
                                            <div className="flex-1 min-h-[420px] border border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center text-center p-8">
                                                <Wand2 className="w-10 h-10 text-gray-700 mb-3" />
                                                <p className="text-sm text-gray-400 mb-1">本章还未生成正文</p>
                                                <p className="text-xs text-gray-500 mb-4">
                                                    {canGenerateSelected
                                                        ? '点击下方按钮让 AI 根据大纲和全部前文创作本章'
                                                        : t('请先生成第 {number} 章', { number: new Intl.ListFormat(locale).format(missingPreviousForSelected.map(e => String(e.episodeNumber))) })}
                                                </p>
                                                <button
                                                    // eslint-disable-next-line react-hooks/refs
                                                    onClick={() => generateChapter(selected.id)}
                                                    disabled={gen || queued || batchRunning || !canGenerateSelected}
                                                    className="flex items-center gap-1.5 px-4 py-2 studio-primary disabled:opacity-50 text-white text-sm rounded-lg">
                                                    {gen ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                                    {gen ? '生成中...' : queued ? '即将开始' : '生成本章'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* 底部操作栏 */}
                                {hasContent && (
                                    <div className="studio-writing-footer px-6 py-3 border-t border-gray-800 flex gap-2 flex-wrap">
                                        {!isFinalized && (
                                            <>
                                                <button
                                                    onClick={() => patchEpisode(selected.id, { chapterContent: draft.chapterContent, title: draft.title, synopsis: draft.synopsis })}
                                                    disabled={saving || gen || queued || contentLoading || batchFinalizing}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg">
                                                    <Save className="w-3.5 h-3.5" />
                                                    保存草稿
                                                </button>
                                                <button
                                                    onClick={() => generateChapter(selected.id)}
                                                    disabled={chapterActionsBusy || queued || !canGenerateSelected}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg">
                                                    <RefreshCw className={`w-3.5 h-3.5 ${gen ? 'animate-spin' : ''}`} />
                                                    {gen ? '生成中...' : queued ? '即将开始' : '重新生成'}
                                                </button>
                                                <button
                                                    onClick={() => finalizeChapter(selected.id)}
                                                    disabled={chapterActionsBusy || contentLoading}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 studio-secondary text-white text-xs rounded-lg ms-auto">
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    定稿
                                                </button>
                                            </>
                                        )}
                                        {isFinalized && (
                                            <button
                                                onClick={() => unfinalizeChapter(selected.id)}
                                                disabled={chapterActionsBusy || selected.status === 'scripted' || selected.status === 'storyboarded'}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg ms-auto">
                                                <Unlock className="w-3.5 h-3.5" />
                                                解除定稿
                                            </button>
                                        )}
                                    </div>
                                )}
                            </section>
                        </div>
                    )
                })()}

            {/* Stage 4: Downstream — 左右两栏，左侧集列表右侧剧本 */}
            {isStage4 &&
                (() => {
                    const selectedEp = project.episodes.find(e => e.id === selectedScriptId) ?? project.episodes[0]
                    if (!selectedEp) return null
                    const scriptedCount = project.episodes.filter(e => episodeHasScript(e) || e.status === 'storyboarded').length
                    // Imported scripts can have complete episode scripts even
                    // when an older import path left the project-level stage
                    // at `finalized`. Use the actual episode data so extraction
                    // is not incorrectly disabled by stale aggregate state.
                    const allScripted = project.episodes.length > 0 && project.episodes.every(episode => episodeHasScript(episode))
                    const hasMissingScripts = project.episodes.some(episode => isChapterFinalized(episode.status) && !episodeHasScript(episode))

                    const isLocked = isScriptGenerated
                    const sel = selectedEp
                    const selScripting = scriptingIds.has(sel.id)
                    const selQueued = scriptQueuedIds.has(sel.id)
                    const selHasScript = episodeHasScript(sel)
                    const contentLoading = loadingEpisodeIds.has(sel.id) || (selHasScript && !isEpisodeContentCurrent(sel, episodeDetails[sel.id]))
                    const selStoryboardCount = sel._count?.storyboards ?? 0
                    const selectedScriptIssue = scriptBatchIssue?.episodeId === sel.id ? scriptBatchIssue : null
                    const selectedScriptIssueGuidance = selectedScriptIssue ? getGenerationErrorGuidance(selectedScriptIssue.reason) : null
                    const selectedRuntimeMatch = selectedScriptIssue?.reason.match(/按对白语速和可见动作估算[仅约]\s*([\d.]+)\s*秒，明显(?:低于|超过)\s*([^；]+)/)

                    return (
                        <div className="studio-writing-layout flex-1 min-h-0 flex">
                            {/* 左侧集数列表 */}
                            <aside className="w-64 flex-shrink-0 border-e border-gray-800 bg-gray-950 flex flex-col">
                                <div className="px-4 py-3 border-b border-gray-800">
                                    <div className="flex items-center gap-3">
                                        <div className="shrink-0 text-white font-semibold text-sm">
                                            {scriptedCount} / {project.episodes.length}
                                        </div>
                                        <div className="h-1 flex-1 bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className="progress-flow h-full bg-gradient-to-r from-blue-500 to-teal-400"
                                                style={{ width: `${(scriptedCount / Math.max(project.episodes.length, 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-3">
                                        <ModelSwitcher
                                            providerKey="script_model"
                                            title="拆剧本模型"
                                            prefix="拆剧本"
                                            defaultModel={GEMINI_FLASH_TEXT_MODEL_ID}
                                        />
                                    </div>
                                </div>
                                {scriptBatchIssue &&
                                    (getGenerationErrorGuidance(scriptBatchIssue.reason).configurationIssue ? (
                                        <div className="mx-3 mt-3 overflow-hidden rounded-lg border border-amber-500/25">
                                            <GenerationFailureNotice
                                                errorMessage={scriptBatchIssue.reason}
                                                taskLabel="拆剧本"
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            role={scriptBatchRunning ? 'status' : 'alert'}
                                            className="mx-3 mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                                            <div className="flex items-center gap-1.5 font-medium">
                                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                                {ui('第 {episode} 集拆分{state}', 'Episode {episode}: {state}')
                                                    .replace('{episode}', String(scriptBatchIssue.episodeNumber))
                                                    .replace('{state}', scriptBatchRunning ? ui('正在重试', 'retrying') : ui('已暂停', 'paused'))}
                                            </div>
                                            <div
                                                className="mt-1 max-h-24 overflow-y-auto break-words leading-relaxed"
                                                data-i18n-skip>
                                                {scriptBatchIssue.reason}
                                            </div>
                                            <div className="mt-2 text-[10px] leading-relaxed text-amber-200/70">
                                                {ui('已尝试 {attempts} 次，后续 {remaining} 集等待中。', 'Attempted {attempts} time(s); {remaining} later episode(s) are waiting.')
                                                    .replace('{attempts}', String(scriptBatchIssue.attempts))
                                                    .replace('{remaining}', String(scriptBatchIssue.remainingCount))}
                                                {!scriptBatchRunning && ui('处理上述问题后，点击“拆剩余剧本”继续。', 'Resolve the issue, then select “Adapt remaining scripts” to continue.')}
                                            </div>
                                        </div>
                                    ))}
                                <nav className="flex-1 overflow-y-auto novel-scroll p-2 space-y-1">
                                    {project.episodes.map(ep => {
                                        const sc = scriptingIds.has(ep.id)
                                        const sq = scriptQueuedIds.has(ep.id)
                                        // 详情接口可能已返回剧本文本，而项目摘要的 status 仍在刷新。
                                        // 以真实剧本内容兜底，避免右侧已有剧本、左侧仍显示未拆状态。
                                        const done = isLocked(ep.status) || episodeHasScript(ep)
                                        const storyboarded = ep.status === 'storyboarded'
                                        const isActive = sel.id === ep.id
                                        const sbCount = ep._count?.storyboards ?? 0
                                        return (
                                            <button
                                                key={ep.id}
                                                onClick={() => setSelectedScriptId(ep.id)}
                                                className={`w-full text-start px-3 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
                                                    isActive ? 'bg-blue-500/15 border border-blue-500/40' : 'border border-transparent hover:bg-gray-800/60'
                                                }`}>
                                                <span
                                                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                                        storyboarded || sbCount > 0
                                                            ? 'bg-yellow-900/40 text-yellow-400'
                                                            : done
                                                              ? 'bg-blue-900/40 text-blue-400'
                                                              : isActive
                                                                ? 'bg-blue-600 text-white'
                                                                : 'bg-gray-800 text-gray-400'
                                                    }`}>
                                                    {ep.episodeNumber}
                                                </span>
                                                <span
                                                    data-i18n-skip
                                                    className={`flex-1 min-w-0 text-sm truncate ${isActive ? 'text-white' : 'text-gray-300'}`}>
                                                    {ep.title ?? t('第{number}集', { number: ep.episodeNumber })}
                                                </span>
                                                {sc ? (
                                                    <span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">
                                                        <RefreshCw className="h-3 w-3 animate-spin" />
                                                        {ui('拆分中', 'Adapting')}
                                                    </span>
                                                ) : sq ? (
                                                    <span className="flex-shrink-0 whitespace-nowrap rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                                                        {ui('排队中', 'Queued')}
                                                    </span>
                                                ) : storyboarded || sbCount > 0 ? (
                                                    <span
                                                        className="flex-shrink-0 whitespace-nowrap rounded border border-yellow-500/25 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-300"
                                                        title={`${sbCount} 个分镜`}>
                                                        {ui('已分镜', 'Storyboarded')} · {sbCount}
                                                    </span>
                                                ) : done ? (
                                                    <CheckCircle2
                                                        className="h-4 w-4 flex-shrink-0 text-emerald-400"
                                                        aria-label={ui('已拆剧本', 'Adapted')}
                                                    />
                                                ) : (
                                                    <span className="flex-shrink-0 whitespace-nowrap rounded border border-gray-700 bg-gray-800/80 px-1.5 py-0.5 text-[10px] text-gray-400">
                                                        {ui('待拆分', 'Pending')}
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </nav>
                                <StudioSidebarActions busy={scriptBatchRunning}>
                                    <button
                                        onClick={() => batchScripts('missing')}
                                        disabled={scriptBatchRunning || scriptingIds.size > 0 || !hasMissingScripts}
                                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 studio-secondary disabled:opacity-50 text-white text-xs rounded-lg">
                                        <Split className="w-3.5 h-3.5" />
                                        {scriptBatchRunning
                                            ? scriptBatchTotal > 0
                                                ? `${ui('拆剧本中', 'Adapting scripts')} ${scriptBatchDone}/${scriptBatchTotal}`
                                                : ui('拆剧本中...', 'Adapting scripts...')
                                            : hasMissingScripts
                                              ? ui('拆剩余剧本', 'Adapt remaining scripts')
                                              : ui('剧本已全部就绪', 'All scripts ready')}
                                    </button>
                                    <button
                                        onClick={() => batchScripts('all')}
                                        disabled={scriptBatchRunning || scriptingIds.size > 0}
                                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg">
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        {ui('全部重拆（覆盖）', 'Re-adapt all (overwrite)')}
                                    </button>
                                    <div className="space-y-1">
                                        <button
                                            onClick={openExtractModal}
                                            disabled={(!hasProjectEntities && !allScripted) || showExtractModal}
                                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 studio-primary disabled:opacity-40 text-white text-xs rounded-lg">
                                            <UserPlus className="w-3.5 h-3.5" />
                                            {extractJobId
                                                ? ui('继续查看提取进度', 'Continue extraction')
                                                : hasProjectEntities
                                                  ? ui('查看角色和场景', 'Review characters and scenes')
                                                  : ui('提取角色和场景', 'Extract characters and scenes')}
                                        </button>
                                        {hasProjectEntities && (
                                            <div className="text-[11px] text-gray-500 text-center">
                                                已入库 {projectCharacterCount} 个角色 / {projectSceneCount} 个场景
                                            </div>
                                        )}
                                    </div>
                                    {projectCharacterCount > 0 && (
                                        <button
                                            onClick={onOpenCharacters}
                                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded-lg">
                                            <Sparkles className="w-3.5 h-3.5" />
                                            {ui('去角色图片编辑', 'Edit character images')}
                                        </button>
                                    )}
                                </StudioSidebarActions>
                            </aside>

                            {/* 右侧剧本区 */}
                            <section className="flex-1 min-w-0 flex flex-col bg-gray-950">
                                <div
                                    className={`flex items-center gap-3 flex-wrap px-6 py-4 border-b ${sel.status === 'storyboarded' || selStoryboardCount > 0 ? 'border-yellow-700/40' : selHasScript ? 'border-blue-700/40' : 'border-gray-800'}`}>
                                    <div
                                        className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                                            sel.status === 'storyboarded' || selStoryboardCount > 0
                                                ? 'bg-yellow-900/40 text-yellow-400'
                                                : selHasScript
                                                  ? 'bg-blue-900/40 text-blue-400'
                                                  : 'bg-gray-800 text-purple-400'
                                        }`}>
                                        {sel.episodeNumber}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div
                                            data-i18n-skip
                                            className="text-white font-semibold text-base truncate">
                                            {sel.title ?? t('第{number}集', { number: sel.episodeNumber })}
                                        </div>
                                        {sel.synopsis && (
                                            <div
                                                data-i18n-skip
                                                className="text-xs text-gray-500 truncate mt-0.5">
                                                {sel.synopsis}
                                            </div>
                                        )}
                                    </div>
                                    <WalletBalance compact />
                                    {selScripting ? (
                                        <span className="flex items-center gap-1 text-xs text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded">
                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                            拆剧本中...
                                        </span>
                                    ) : selQueued ? (
                                        <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">即将开始</span>
                                    ) : sel.status === 'storyboarded' || selStoryboardCount > 0 ? (
                                        <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded">已分镜 · {selStoryboardCount} 个</span>
                                    ) : selHasScript ? (
                                        <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">已拆剧本</span>
                                    ) : (
                                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">未拆</span>
                                    )}
                                </div>

                                <div className="flex-1 min-h-0 flex flex-col px-6 py-4">
                                    {selectedScriptIssue && !selScripting && !selQueued && (
                                        <div className="mb-4 overflow-hidden rounded-lg border border-red-500/30 bg-red-500/5">
                                            {selectedRuntimeMatch && (
                                                <dl className="grid grid-cols-2 gap-3 border-b border-red-500/20 px-3 py-2 text-xs">
                                                    <div>
                                                        <dt className="text-gray-500">{ui('当前预计', 'Estimated')}</dt>
                                                        <dd className="mt-0.5 font-medium text-red-200">
                                                            {selectedRuntimeMatch[1]} {t('秒')}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt className="text-gray-500">{ui('目标时长', 'Target duration')}</dt>
                                                        <dd className="mt-0.5 font-medium text-white">{t(selectedRuntimeMatch[2].trim())}</dd>
                                                    </div>
                                                </dl>
                                            )}
                                            <GenerationFailureNotice
                                                errorMessage={selectedScriptIssue.reason}
                                                taskLabel="拆剧本"
                                                onRetry={() => {
                                                    // Timer refs are read only in this click handler, never while rendering the enclosing stage view.
                                                    // eslint-disable-next-line react-hooks/refs
                                                    void generateSingleScript(sel.id)
                                                }}
                                                retryLabel={ui('重新拆本集', 'Re-adapt this episode')}
                                                retryDisabled={scriptBatchRunning || scriptingIds.size > 0}
                                                onEdit={
                                                    selectedScriptIssueGuidance?.editTarget === 'chapter' && !selHasScript
                                                        ? () => {
                                                              setSelectedChapterId(sel.id)
                                                              setNovelStageView('drafting')
                                                          }
                                                        : undefined
                                                }
                                                editLabel={ui('返回章节修改', 'Back to edit chapter')}
                                            />
                                        </div>
                                    )}
                                    {contentLoading ? (
                                        <div className="flex-1 min-h-[360px] border border-dashed border-blue-800/50 rounded-lg flex flex-col items-center justify-center text-center p-8">
                                            <RefreshCw className="w-8 h-8 text-blue-500 mb-3 animate-spin" />
                                            <p className="text-sm text-blue-300">正在加载本集剧本...</p>
                                        </div>
                                    ) : selHasScript ? (
                                        <div className="flex flex-col flex-1 min-h-0">
                                            <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                                                <span>本集剧本（{(scriptDrafts[sel.id] ?? sel.script ?? '').length} 字）</span>
                                                {scriptAutoSavedFlash[sel.id] && <span className="text-[10px] text-green-400">✓ 已保存</span>}
                                            </div>
                                            {sel.staleReason && <p className="mb-2 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">{sel.staleReason}</p>}
                                            <ScriptRuntimeNotice
                                                script={scriptDrafts[sel.id] ?? sel.script ?? ''}
                                                episodeFormat={setup.episodeFormat}
                                            />
                                            <textarea
                                                value={scriptDrafts[sel.id] ?? sel.script ?? ''}
                                                onChange={e => {
                                                    const next = e.target.value
                                                    setScriptDrafts(prev => ({ ...prev, [sel.id]: next }))
                                                    if (next !== (sel.script ?? '')) scheduleScriptAutoSave(sel.id, next)
                                                }}
                                                className="flex-1 min-h-0 w-full bg-gray-900 border border-gray-800 text-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none font-mono leading-relaxed novel-scroll"
                                            />
                                        </div>
                                    ) : selScripting || selQueued ? (
                                        <div className="flex-1 min-h-[360px] border border-dashed border-blue-800/50 rounded-lg flex flex-col items-center justify-center text-center p-8">
                                            <RefreshCw className="w-10 h-10 text-blue-500 mb-3 animate-spin" />
                                            <p className="text-sm text-blue-300">{selScripting ? '正在拆剧本，这可能需要 2-3 分钟...' : '排队中，即将开始'}</p>
                                        </div>
                                    ) : (
                                        <div className="flex-1 min-h-[360px] border border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center text-center p-8">
                                            <Split className="w-10 h-10 text-gray-700 mb-3" />
                                            <p className="text-sm text-gray-400 mb-1">本集尚未拆剧本</p>
                                            <p className="text-xs text-gray-500 mb-4">点击按钮根据章节正文生成短剧剧本</p>
                                            <button
                                                onClick={() => {
                                                    void generateSingleScript(sel.id)
                                                }}
                                                disabled={selScripting || scriptBatchRunning}
                                                className="flex items-center gap-1.5 px-4 py-2 studio-secondary disabled:opacity-50 text-white text-sm rounded-lg">
                                                <Split className="w-4 h-4" />
                                                拆本集剧本
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* 底部操作：进入分镜 */}
                                {selHasScript && (
                                    <div className="studio-writing-footer px-6 py-3 border-t border-gray-800 flex items-center gap-3 flex-wrap">
                                        <button
                                            onClick={() => generateSingleScript(sel.id)}
                                            disabled={selScripting || scriptBatchRunning}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg">
                                            <RefreshCw className={`w-3.5 h-3.5 ${selScripting ? 'animate-spin' : ''}`} />
                                            {selScripting ? ui('拆剧本中...', 'Adapting script...') : ui('重新拆剧本', 'Re-adapt script')}
                                        </button>
                                        <div className="ms-auto flex items-center gap-3">
                                            {selStoryboardCount > 0 && (
                                                <a
                                                    href={`/projects/${project.id}/episodes/${sel.id}`}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white">
                                                    {ui('直接进入', 'Open storyboard')}
                                                </a>
                                            )}
                                            <button
                                                type="button"

                                                onClick={() => generateStoryboardsAndEnter(sel)}
                                                disabled={storyboardingIds.has(sel.id) || selScripting || scriptBatchRunning}
                                                className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-1.5 text-xs text-white hover:bg-purple-700 disabled:opacity-50">
                                                {storyboardingIds.has(sel.id) ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                                {storyboardingIds.has(sel.id)
                                                    ? ui('正在规划镜头...', 'Planning shots...')
                                                    : selStoryboardCount > 0
                                                      ? ui('重新生成分镜并进入', 'Regenerate storyboards and open')
                                                      : ui('生成分镜并进入', 'Generate storyboards and open')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>
                    )
                })()}

            {showExtractModal && (
                <ExtractReviewModal
                    projectId={project.id}
                    initialJobId={extractJobId}
                    onJobIdChange={setExtractJobId}
                    onResetStarted={async () => {
                        onMessage({ type: 'success', text: '旧角色、场景及参考图已清空，正在重新提取。' })
                        await onRefetch()
                    }}
                    existingCharacters={project.characters?.map(character => ({
                        name: character.name ?? '',
                        role: character.role ?? undefined,
                        gender: character.gender ?? undefined,
                        age: character.age ?? undefined,
                        appearancePrompt: character.appearancePrompt ?? '',
                        personality: character.personality ?? undefined,
                        frequency: 1
                    }))}
                    existingScenes={project.scenes?.map(scene => ({
                        name: scene.name ?? '',
                        description: scene.description ?? undefined,
                        locationPrompt: scene.locationPrompt ?? '',
                        timeOfDay: scene.timeOfDay ?? undefined,
                        frequency: 1
                    }))}
                    onClose={() => setShowExtractModal(false)}
                    onCommitted={async (newChars, newScenes, ids) => {
                        setExtractJobId(null)
                        setShowExtractModal(false)
                        onMessage({
                            type: 'success',
                            text: `角色和场景已按本次提取结果更新（新增角色 ${newChars} 个、新增场景 ${newScenes} 个）`
                        })
                        await onRefetch()
                        await onExtractCommitted?.({ ...ids, newChars, newScenes })
                    }}
                    onError={msg => onMessage({ type: 'error', text: msg })}
                />
            )}
        </div>
    )
}

const inputCls = 'w-full bg-gray-950 border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500'

function Field({ label, actions, children }: { label: string; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                <span>{label}</span>
                {actions}
            </div>
            {children}
        </div>
    )
}

function IntensityCurve({ episodes }: { episodes: ChapterEpisode[] }) {
    const hasAny = episodes.some(e => e.intensity != null)
    const W = 260
    const H = 320
    const padL = 28
    const padR = 16
    const padT = 20
    const padB = 28
    const innerW = W - padL - padR
    const innerH = H - padT - padB

    const n = episodes.length

    if (n === 0) {
        return (
            <aside className="sticky top-20 bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-white text-sm font-semibold mb-1">剧情走向</h3>
                <p className="text-[11px] text-gray-500">生成大纲后会在这里展示每章情节强度的起落曲线。</p>
            </aside>
        )
    }

    const fallbackIntensity = (i: number, total: number) => {
        if (total <= 1) return 5
        const pos = i / (total - 1)
        const climax = 0.85
        const distance = Math.abs(pos - climax)
        const peak = Math.max(0, 1 - Math.pow(distance / 0.55, 2))
        const raw = 2 + 8 * peak + (pos < climax ? pos * 1.5 : -(pos - climax) * 3)
        return Math.max(1, Math.min(10, Math.round(raw)))
    }

    const xFor = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW)
    const yFor = (v: number) => padT + innerH - ((v - 1) / 9) * innerH

    const points = episodes.map((e, i) => {
        const intensity = e.intensity ?? fallbackIntensity(i, n)
        return {
            x: xFor(i),
            y: yFor(intensity),
            v: intensity,
            ep: e,
            isFallback: e.intensity == null
        }
    })

    // Catmull-Rom -> cubic Bezier for a smooth curve
    function curvePath(pts: { x: number; y: number }[]): string {
        if (pts.length === 0) return ''
        if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
        let d = `M ${pts[0].x} ${pts[0].y}`
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] ?? pts[i]
            const p1 = pts[i]
            const p2 = pts[i + 1]
            const p3 = pts[i + 2] ?? p2
            const c1x = p1.x + (p2.x - p0.x) / 6
            const c1y = p1.y + (p2.y - p0.y) / 6
            const c2x = p2.x - (p3.x - p1.x) / 6
            const c2y = p2.y - (p3.y - p1.y) / 6
            d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
        }
        return d
    }

    const linePath = curvePath(points)
    const areaPath = linePath + ` L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`

    const yTicks = [1, 5, 10]
    const baselineY = yFor(1)

    return (
        <aside className="sticky top-20 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-white text-sm font-semibold">剧情走向</h3>
                <span className="text-[10px] text-gray-500">强度 1–10</span>
            </div>
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-auto">
                <defs>
                    <linearGradient
                        id="intensityFill"
                        x1="0"
                        x2="0"
                        y1="0"
                        y2="1">
                        <stop
                            offset="0%"
                            stopColor="rgb(168, 85, 247)"
                            stopOpacity="0.45"
                        />
                        <stop
                            offset="100%"
                            stopColor="rgb(168, 85, 247)"
                            stopOpacity="0"
                        />
                    </linearGradient>
                    <linearGradient
                        id="intensityStroke"
                        x1="0"
                        x2="1"
                        y1="0"
                        y2="0">
                        <stop
                            offset="0%"
                            stopColor="rgb(139, 92, 246)"
                        />
                        <stop
                            offset="100%"
                            stopColor="rgb(236, 72, 153)"
                        />
                    </linearGradient>
                </defs>

                {/* Y 轴刻度虚线 */}
                {yTicks.map(t => (
                    <g key={t}>
                        <line
                            x1={padL}
                            x2={padL + innerW}
                            y1={yFor(t)}
                            y2={yFor(t)}
                            stroke="rgba(75, 85, 99, 0.35)"
                            strokeDasharray="2 3"
                        />
                        <text
                            x={padL - 4}
                            y={yFor(t) + 3}
                            textAnchor="end"
                            fontSize="9"
                            fill="rgb(107, 114, 128)">
                            {t}
                        </text>
                    </g>
                ))}

                {/* 基线 */}
                <line
                    x1={padL}
                    x2={padL + innerW}
                    y1={baselineY}
                    y2={baselineY}
                    stroke="rgba(75, 85, 99, 0.5)"
                />

                {/* 面积 */}
                <path
                    d={areaPath}
                    fill="url(#intensityFill)"
                />
                {/* 曲线 */}
                <path
                    d={linePath}
                    fill="none"
                    stroke="url(#intensityStroke)"
                    strokeWidth="2"
                />

                {/* 点 */}
                {points.map((p, i) => (
                    <g key={p.ep.id}>
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r="3"
                            fill="rgb(244, 114, 182)"
                            stroke="rgb(15, 23, 42)"
                            strokeWidth="1.5">
                            <title>
                                第{p.ep.episodeNumber}章 {p.ep.title ?? ''}｜强度 {p.v}/10
                            </title>
                        </circle>
                        {(i === 0 || i === points.length - 1 || p.v >= 8) && (
                            <text
                                x={p.x}
                                y={p.y - 6}
                                textAnchor="middle"
                                fontSize="9"
                                fill="rgb(196, 181, 253)">
                                {p.v}
                            </text>
                        )}
                    </g>
                ))}

                {/* X 轴 章节号（前后+每第几个） */}
                {points.map((p, i) => {
                    const step = Math.max(1, Math.ceil(n / 8))
                    if (i !== 0 && i !== n - 1 && i % step !== 0) return null
                    return (
                        <text
                            key={`xlbl-${p.ep.id}`}
                            x={p.x}
                            y={H - 10}
                            textAnchor="middle"
                            fontSize="9"
                            fill="rgb(107, 114, 128)">
                            {p.ep.episodeNumber}
                        </text>
                    )
                })}

                <text
                    x={padL + innerW / 2}
                    y={H - 2}
                    textAnchor="middle"
                    fontSize="9"
                    fill="rgb(107, 114, 128)">
                    章节
                </text>
            </svg>
            <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                曲线越高 = 本章情节越激烈（反转、爆点、高潮）。悬停圆点查看章节信息。
                {!hasAny && <span className="block text-yellow-500/80 mt-1">* 当前曲线为系统默认节奏；重新生成大纲可获得 AI 针对剧情定制的强度。</span>}
            </div>
        </aside>
    )
}

function CharRow({ value, onChange, onRemove }: { value: NovelCharacterInput; onChange: (patch: Partial<NovelCharacterInput>) => void; onRemove: () => void }) {
    return (
        <div className="grid grid-cols-12 gap-2 items-center">
            <input
                className={`${inputCls} col-span-2`}
                placeholder="姓名"
                value={value.name}
                onChange={e => onChange({ name: e.target.value })}
            />
            <input
                className={`${inputCls} col-span-2`}
                placeholder="定位（主角/反派等）"
                value={value.role ?? ''}
                onChange={e => onChange({ role: e.target.value })}
            />
            <input
                className={`${inputCls} col-span-1`}
                placeholder="性别"
                value={value.gender ?? ''}
                onChange={e => onChange({ gender: e.target.value })}
            />
            <input
                className={`${inputCls} col-span-1`}
                placeholder="年龄"
                value={value.age ?? ''}
                onChange={e => onChange({ age: e.target.value })}
            />
            <input
                className={`${inputCls} col-span-5`}
                placeholder="一句话人设"
                value={value.persona ?? ''}
                onChange={e => onChange({ persona: e.target.value })}
            />
            <button
                onClick={onRemove}
                className="col-span-1 text-gray-500 hover:text-red-400 flex justify-center">
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    )
}
