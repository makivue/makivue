'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link, { useParams, useRouter } from '@/i18n/navigation'
import {
    ArrowLeft,
    Users,
    MapPin,
    Film,
    Plus,
    ChevronLeft,
    ChevronRight,
    Sparkles,
    BookOpen,
    ImageIcon,
    RefreshCw,
    Check,
    AlertTriangle,
    X,
    Trash2,
    BarChart3,
    ArrowUpRight,
    Clapperboard,
    Pencil,
    CircleMinus,
    CirclePlus,
    Globe
} from 'lucide-react'
import NovelTab, { STAGES, stageIndexValue } from './NovelTab'
import ProductionInsightsPanel from './ProductionInsightsPanel'
import ReferenceLibraryHeader from '@/components/ReferenceLibraryHeader'
import ReferenceThumbnail from '@/components/ReferenceThumbnail'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import CreationJourney, { type CreationStage } from '@/components/CreationJourney'
import { getChapterProgress, getMissingChapterOutlineNumbers } from '@/lib/chapter-progress'
import CustomSelect from '@/components/CustomSelect'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { getImageResolutionDetail, getImageResolutionLabel, IMAGE_QUALITY_OPTIONS, normalizeImageQuality, type ImageQuality } from '@/lib/image-quality'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getPollingDelay } from '@/lib/polling'
import { isUnavailablePageStatus, isValidRouteResourceId, redirectToHomepage } from '@/lib/home-redirect'
import { pushToast } from '@/components/Toast'
import { useI18n } from '@/i18n/I18nProvider'
import { isTransientReferenceJobError, REF_IMAGE_STALE_WINDOW_MS, type ReferenceGenerationProgress, type ReferenceGenerationTimings } from '@/lib/reference-generation-progress'
import type { ImageGenerationRecovery, ImageProviderSwitch } from '@/lib/image-generation-recovery'
import { characterTurnaroundLayout } from '@/lib/character-reference-retry'
import { applyCharacterReferenceResult } from '@/lib/character-reference-result'
import { isProductionImageProvider, type ProductionImageProvider } from '@/lib/provider-capabilities'
import { createSceneReferenceSelection, getSelectedSceneReferenceUrls, MAX_SELECTED_SCENE_REFERENCES } from '@/lib/scene-reference-selection'
import { formatPointBalance } from '@/lib/points'
import HomeLogoLink from '@/components/HomeLogoLink'

interface Character {
    id: string
    name: string
    role: string | null
    age: string | null
    gender: string | null
    appearancePrompt: string | null
    referenceImageUrl: string | null
    referenceCandidates: string | null
    referenceAssetRows?: Array<{
        id: string
        role: string
        stateKey: string | null
        url: string
        status: string
        promptVersion?: string | null
    }>
    seedanceAssetGroupId: string | null
    seedancePortraitStatus: 'unverified' | 'pending' | 'authorized' | 'failed'
    seedancePortraitAssets?: Array<{
        id: string
        role: string | null
        sourceUrl: string
        status: 'uploading' | 'processing' | 'active' | 'failed'
        errorMsg: string | null
        createdAt: string
    }>
}

type CharacterIdentityRole = 'turnaround_sheet' | 'full_body' | 'three_quarter_view' | 'profile' | 'back' | 'face'

function referenceCandidateKey(kind: 'characters' | 'scenes', targetId: string, url: string, role?: CharacterIdentityRole) {
    return JSON.stringify([kind, targetId, url, role ?? null])
}

const CHARACTER_IDENTITY_REFERENCE_ROLES: Array<{
    role: CharacterIdentityRole
    label: string
    shortLabel: string
}> = [{ role: 'turnaround_sheet', label: '多视图角色设定板', shortLabel: '设定板' }]

interface Scene {
    id: string
    name: string
    description: string | null
    locationPrompt: string | null
    referenceImageUrl: string | null
    referenceCandidates: string | null
    referenceAssets?: unknown
}

type SceneReferenceBatchQuote = {
    requestedCount: number
    affordableCount: number
    balancePoints: number
    requiredPoints: number
    affordablePoints: number
    minimumPoints: number
    affordableSceneIds: string[]
}

type ReferencePreview =
    | { kind: 'character'; targetId: string; role: CharacterIdentityRole; title: string; urls: string[]; index: number }
    | { kind: 'scene'; targetId: string; title: string; urls: string[]; index: number }

interface Episode {
    id: string
    episodeNumber: number
    title: string | null
    synopsis: string | null
    chapterContent: string | null
    script: string | null
    hasChapterContent?: boolean
    hasScript?: boolean
    hasMergedVideo?: boolean
    intensity: number | null
    status: string
    finalizedAt: string | null
    _count: { storyboards: number }
}

interface Project {
    id: string
    title: string
    description: string | null
    genre: string | null
    totalEpisodes: number
    novel: string | null
    novelSetup: string | null
    novelStage: string
    status: string
    characters: Character[]
    scenes: Scene[]
    episodes: Episode[]
}

type ReferencePromptEditor = { kind: 'character'; id: string } | { kind: 'scene'; id: string }

type PromptOptimizationInput = {
    feedback: string
    issues: string[]
}

type PromptAiActionResult = {
    prompt: string
    summary: string[]
    visualDiagnosisUsed: boolean
}

const PROMPT_OPTIMIZATION_ISSUES = ['构图不理想', '内容与描述不符', '光线或色调不对', '不够写实', '元素太多', '缺少关键元素', '出现多余人物或文字'] as const

interface ReferencePromptDialogProps {
    kindLabel: string
    name: string
    initialValue: string
    savedValue: string
    saving: boolean
    hasReferences: boolean
    referenceImageUrl?: string | null
    placeholder: string
    onClose: () => void
    onSave: (value: string) => Promise<void>
    onAiAction: (action: 'rewrite' | 'expand', value: string, optimization?: PromptOptimizationInput) => Promise<PromptAiActionResult | null>
}

function ReferencePromptDialog({ kindLabel, name, initialValue, savedValue, saving, hasReferences, referenceImageUrl, placeholder, onClose, onSave, onAiAction }: ReferencePromptDialogProps) {
    const { t } = useI18n()
    const [draft, setDraft] = useState(initialValue)
    const [aiAction, setAiAction] = useState<'rewrite' | 'expand' | null>(null)
    const [optimizerOpen, setOptimizerOpen] = useState(false)
    const [optimizationFeedback, setOptimizationFeedback] = useState('')
    const [optimizationIssues, setOptimizationIssues] = useState<Set<string>>(new Set())
    const [suggestion, setSuggestion] = useState<PromptAiActionResult | null>(null)
    const dirty = draft.trim() !== savedValue.trim()
    const busy = saving || aiAction !== null
    const canOptimize = Boolean(referenceImageUrl || optimizationFeedback.trim() || optimizationIssues.size)

    async function runAiAction(action: 'rewrite' | 'expand', optimization?: PromptOptimizationInput) {
        if (busy || !draft.trim()) return
        setAiAction(action)
        try {
            const improved = await onAiAction(action, draft, optimization)
            if (!improved) return
            if (action === 'rewrite') setSuggestion(improved)
            else setDraft(improved.prompt)
        } finally {
            setAiAction(null)
        }
    }

    function toggleOptimizationIssue(issue: string) {
        setOptimizationIssues(current => {
            const next = new Set(current)
            if (next.has(issue)) next.delete(issue)
            else next.add(issue)
            return next
        })
    }

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onClose()
        }
        document.addEventListener('keydown', closeOnEscape)
        return () => document.removeEventListener('keydown', closeOnEscape)
    }, [busy, onClose])

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/80 px-4 py-6 backdrop-blur-sm"
            onMouseDown={event => {
                if (event.target === event.currentTarget && !busy) onClose()
            }}>
            <form
                role="dialog"
                aria-modal="true"
                aria-labelledby="reference-prompt-title"
                onSubmit={event => {
                    event.preventDefault()
                    void onSave(draft)
                }}
                className="studio-reference-prompt-dialog relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-purple-500/25 bg-gray-950 shadow-2xl shadow-black/60">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-purple-500/15 to-transparent" />
                <div className="relative p-4">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-purple-400/30 bg-purple-500/10 text-purple-200">
                            <Pencil className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="shrink-0 text-xs font-medium text-purple-300">
                                {t(kindLabel)} {t('提示词')}
                            </span>
                            <h2
                                id="reference-prompt-title"
                                data-i18n-skip
                                title={name}
                                className="min-w-0 truncate text-sm font-semibold text-white">
                                {name}
                            </h2>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            aria-label="关闭"
                            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <label
                            htmlFor="reference-prompt-editor"
                            className="text-xs font-medium text-gray-300">
                            完整视觉描述
                        </label>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setOptimizerOpen(current => !current)}
                                disabled={busy || !draft.trim()}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-purple-500/25 bg-purple-500/10 px-2 text-[11px] font-medium text-purple-200 transition-colors hover:border-purple-400/45 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40">
                                <RefreshCw className={`h-3 w-3 ${aiAction === 'rewrite' ? 'animate-spin' : ''}`} />
                                {aiAction === 'rewrite' ? '优化中...' : 'AI 优化'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void runAiAction('expand')}
                                disabled={busy || !draft.trim()}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-purple-500/25 bg-purple-500/10 px-2 text-[11px] font-medium text-purple-200 transition-colors hover:border-purple-400/45 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40">
                                <Sparkles className={`h-3 w-3 ${aiAction === 'expand' ? 'animate-pulse' : ''}`} />
                                {aiAction === 'expand' ? t('扩写中...') : `AI ${t('扩写')}`}
                            </button>
                        </div>
                    </div>
                    {optimizerOpen && (
                        <div className="mt-2 rounded-lg border border-purple-500/25 bg-purple-500/[0.06] p-3">
                            <div className="flex gap-2.5">
                                {referenceImageUrl && (
                                    <div className="relative hidden h-20 w-30 shrink-0 overflow-hidden rounded-lg border border-gray-700 bg-black sm:block">
                                        <ReferenceThumbnail
                                            src={referenceImageUrl}
                                            alt={`${name} 当前参考图`}
                                            sizes="120px"
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-purple-100">这次希望 AI 改善什么？</p>
                                    <p className="mt-1 text-[11px] leading-4 text-gray-500">
                                        {referenceImageUrl ? '会自动分析当前选中的参考图，并结合你的要求重写 Prompt。' : '当前没有参考图，请选择问题或填写具体修改目标。'}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {PROMPT_OPTIMIZATION_ISSUES.map(issue => {
                                            const selected = optimizationIssues.has(issue)
                                            return (
                                                <button
                                                    key={issue}
                                                    type="button"
                                                    aria-pressed={selected}
                                                    onClick={() => toggleOptimizationIssue(issue)}
                                                    disabled={busy}
                                                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${selected ? 'border-purple-400 bg-purple-500/25 text-purple-100' : 'border-gray-700 bg-gray-900/70 text-gray-400 hover:border-gray-600 hover:text-gray-200'}`}>
                                                    {issue}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                            <textarea
                                value={optimizationFeedback}
                                maxLength={1000}
                                rows={2}
                                disabled={busy}
                                onChange={event => setOptimizationFeedback(event.target.value)}
                                placeholder="例如：不要赛博朋克霓虹，改成真实政府大楼地下车库；空间更开阔，灯光更自然。"
                                className="mt-2 block w-full resize-y rounded-lg border border-gray-700 bg-gray-950/80 px-2.5 py-2 text-xs leading-5 text-gray-200 outline-none placeholder:text-gray-600 focus:border-purple-400"
                            />
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-[10px] tabular-nums text-gray-600">{optimizationFeedback.length} / 1,000</span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        void runAiAction('rewrite', {
                                            feedback: optimizationFeedback.trim(),
                                            issues: Array.from(optimizationIssues)
                                        })
                                    }
                                    disabled={busy || !canOptimize}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40">
                                    <Sparkles className={`h-3.5 w-3.5 ${aiAction === 'rewrite' ? 'animate-pulse' : ''}`} />
                                    {aiAction === 'rewrite' ? '正在分析并优化...' : referenceImageUrl ? '分析图片并优化' : '开始优化'}
                                </button>
                            </div>
                        </div>
                    )}
                    <textarea
                        id="reference-prompt-editor"
                        autoFocus
                        value={draft}
                        maxLength={20_000}
                        rows={6}
                        disabled={busy}
                        onChange={event => {
                            setDraft(event.target.value)
                            setSuggestion(null)
                        }}
                        placeholder={placeholder}
                        className="mt-1.5 block min-h-36 w-full resize-y rounded-lg border border-gray-700 bg-gray-900/90 px-3 py-2 text-[13px] leading-5 text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-purple-400"
                    />

                    {suggestion && (
                        <div className="mt-2.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-medium text-emerald-200">AI 优化建议</p>
                                    <p className="mt-0.5 text-[11px] text-gray-500">{suggestion.visualDiagnosisUsed ? '已结合当前参考图进行分析' : '已根据文字要求优化'}</p>
                                </div>
                                <div className="flex gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setSuggestion(null)}
                                        className="rounded-md border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-white">
                                        放弃
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDraft(suggestion.prompt)
                                            setSuggestion(null)
                                            setOptimizerOpen(false)
                                        }}
                                        className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500">
                                        应用到编辑框
                                    </button>
                                </div>
                            </div>
                            {suggestion.summary.length > 0 && <p className="mt-2 text-[11px] leading-5 text-emerald-100/75">修改：{suggestion.summary.join('；')}</p>}
                            <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-800 bg-gray-950/80 p-3 font-mono text-xs leading-5 text-gray-200">
                                {suggestion.prompt}
                            </div>
                        </div>
                    )}

                    {(hasReferences || !draft.trim()) && (
                        <div
                            className={`mt-2.5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5 ${draft.trim() ? 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-100' : 'border-amber-400/20 bg-amber-400/[0.07] text-amber-100'}`}>
                            {draft.trim() ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
                            <span>{!draft.trim() ? '清空 Prompt 后将无法生成候选图。' : '保存 Prompt 不会删除现有参考图或已生成视频；新的 Prompt 将用于之后重新生成的内容。'}</span>
                        </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className={dirty ? 'text-amber-300' : 'text-gray-500'}>{dirty ? '修改尚未保存' : '当前内容已保存'}</span>
                            <span className="tabular-nums text-gray-500">{draft.length.toLocaleString()} / 20,000</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={busy}
                                className="h-8 rounded-lg border border-gray-700 bg-gray-900/80 px-3 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                                取消
                            </button>
                            <button
                                type="submit"
                                disabled={!dirty || busy}
                                className="studio-primary disabled:cursor-not-allowed disabled:opacity-40">
                                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                {saving ? '保存中...' : '保存修改'}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    )
}

type ProjectTab = 'insights' | 'novel' | 'episodes' | 'characters' | 'scenes'

const IMAGE_PROVIDER_OPTIONS = [
    { value: 'banana', label: 'Nano Banana', desc: 'Gemini 图像模型，适合风格一致和参考图生成' },
    { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash', desc: 'Himodels Gemini Flash，支持参考图' },
    { value: 'seedream-5-0-lite', label: 'Seedream 5.0 Lite', desc: 'Himodels Seedream 5.0 Lite，2K 文生图' },
    { value: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro', desc: '阿里百炼图片模型，支持文生图和参考图' }
] as const
type ImageProvider = ProductionImageProvider

const EPISODE_STATUS: Record<string, { label: string; color: string }> = {
    draft: { label: '草稿', color: 'text-gray-400' },
    scripted: { label: '已写剧本', color: 'text-blue-400' },
    storyboarding: { label: '分镜中', color: 'text-pink-400' },
    storyboarded: { label: '已分镜', color: 'text-yellow-400' },
    generating: { label: '生成中', color: 'text-orange-400' },
    completed: { label: '已完成', color: 'text-green-400' }
}

const REF_IMAGE_POLL_STEPS = [2000, 3000, 5000, 8000, 10000]

function nextRefImagePollInterval(attempt: number): number {
    return getPollingDelay({ baseMs: REF_IMAGE_POLL_STEPS[Math.min(attempt, REF_IMAGE_POLL_STEPS.length - 1)], jitterRatio: 0.15 })
}

interface RefImageJobResult {
    targetType: 'character' | 'scene'
    targetId: string
    candidateUrl: string
    referenceImageUrl: string | null
    referenceCandidates: string[]
    selectedReferenceUrls?: string[]
    role?: string
    stateKey?: string
    timings?: ReferenceGenerationTimings
    provider?: string
    requestedProvider?: string
    recovery?: ImageGenerationRecovery
    fallbackReason?: string
    providerSwitch?: ImageProviderSwitch
    inspectionWarning?: string
    promptVersion?: string
}

interface CharacterBatchFailure {
    key: string
    reason: string
}

interface CharacterBatchState {
    done: number
    total: number
    failed: number
    mode: 'missing' | 'all'
}

interface SceneBatchState {
    done: number
    total: number
    failed: number
    quality: ImageQuality
    mode: 'missing' | 'all'
}

interface SceneReferenceBatchStatus {
    id: string
    phase: string
    total: number
    completed: number
    failed: number
    error?: string
    quality?: ImageQuality
    mode?: 'missing' | 'all'
    items: Array<{ jobId: string; sceneId: string; phase: string; error?: string; progress?: ReferenceGenerationProgress; result?: RefImageJobResult }>
}

async function pollSceneReferenceBatch(
    projectId: string,
    jobId: string,
    onStatus: (status: SceneReferenceBatchStatus) => void,
    options: { signal: AbortSignal; initialStatus?: SceneReferenceBatchStatus }
) {
    let snapshot = options.initialStatus
    let failures = 0
    let unchanged = 0
    let lastSignature = ''
    const deadline = Date.now() + 60 * 60_000
    while (Date.now() < deadline) {
        options.signal.throwIfAborted()
        try {
            if (!snapshot) {
                const response = await clientFetch(`/api/projects/${projectId}/scene-references/status/${jobId}`, { signal: options.signal, cache: 'no-store' })
                const json = await readApiJson(response)
                if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? `任务状态查询失败 (${response.status})`)
                snapshot = json.data as SceneReferenceBatchStatus
            }
            options.signal.throwIfAborted()
            const signature = snapshot.items.map(item => `${item.jobId}:${item.phase}:${item.progress?.stage}`).join('|')
            unchanged = signature === lastSignature ? unchanged + 1 : 0
            lastSignature = signature
            failures = 0
            onStatus(snapshot)
            if (['done', 'error', 'cancelled'].includes(snapshot.phase)) return snapshot
        } catch (error) {
            options.signal.throwIfAborted()
            failures += 1
            if (failures >= 5) throw error
        }
        snapshot = undefined
        await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs: Math.min(3_000 + unchanged * 2_000, 10_000), failureCount: failures, jitterRatio: 0.15 })))
    }
    throw new Error('场景批次仍在后台运行，请刷新查看最新进度')
}

interface CharacterReferenceBatchStatusItem {
    jobId: string
    characterId: string
    role: CharacterIdentityRole
    phase: 'queued' | 'generating' | 'writing_db' | 'done' | 'error' | 'cancelled'
    error?: string
    progress?: ReferenceGenerationProgress
    result?: RefImageJobResult
}

interface CharacterReferenceBatchStatus {
    id: string
    phase: string
    error?: string
    total: number
    completed: number
    failed: number
    queued: number
    active: number
    concurrency: number
    mode?: 'missing' | 'all'
    replaceSelected?: boolean
    items: CharacterReferenceBatchStatusItem[]
}

function characterReferenceGenerationKey(characterId: string, role: CharacterIdentityRole): string {
    return role === 'turnaround_sheet' ? characterId : `${characterId}:${role}`
}

function characterReferenceBatchFinished(status: CharacterReferenceBatchStatus) {
    return ['done', 'error', 'cancelled'].includes(status.phase) || (status.total > 0 && status.completed >= status.total)
}

async function pollCharacterReferenceBatch(
    projectId: string,
    jobId: string,
    onStatus: (status: CharacterReferenceBatchStatus) => void,
    options: { signal: AbortSignal; initialStatus?: CharacterReferenceBatchStatus }
) {
    const deadline = Date.now() + 30 * 60 * 1000
    let initialStatus = options.initialStatus
    let attempt = 0
    let lastPollingError = ''
    while (Date.now() < deadline) {
        try {
            options.signal.throwIfAborted()
            let status = initialStatus
            initialStatus = undefined
            if (!status) {
                const response = await clientFetch(`/api/projects/${projectId}/character-references/status/${jobId}`, { signal: options.signal, cache: 'no-store' })
                if ([429, 502, 503, 504].includes(response.status)) throw new Error('服务暂时不可用，请稍后重试')
                const json = await response.json()
                if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? '轮询角色参考图批次失败')
                status = json.data as CharacterReferenceBatchStatus
            }
            options.signal.throwIfAborted()
            lastPollingError = ''
            // Keep successful polls responsive; back off only when status requests fail.
            attempt = 0
            onStatus(status)
            if (characterReferenceBatchFinished(status)) return status
        } catch (error) {
            options.signal.throwIfAborted()
            const message = error instanceof Error ? error.message : String(error)
            if (!isTransientReferenceJobError(message)) throw error
            lastPollingError = message
        }
        await new Promise(resolve => setTimeout(resolve, nextRefImagePollInterval(attempt++)))
    }
    throw new Error(`角色参考图批次超时（30 分钟未完成）${lastPollingError ? `，最近一次状态查询失败：${lastPollingError}` : ''}`)
}

async function pollRefImageJob(
    kind: 'characters' | 'scenes',
    parentId: string,
    jobId: string,
    timeoutMs = 30 * 60 * 1000,
    onProgress?: (progress: ReferenceGenerationProgress) => void,
    onPhase?: (phase: string) => void
): Promise<RefImageJobResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    let lastPollingError = ''
    let lastActivityAt = Date.now()
    let lastActivitySignature = ''
    while (Date.now() < deadline) {
        try {
            const res = await clientFetch(`/api/${kind}/${parentId}/reference/status/${jobId}`)
            if ([429, 502, 503, 504].includes(res.status)) throw new Error('服务暂时不可用，请稍后重试')
            const json = await res.json()
            if (!json.success) throw new Error(json.error ?? '轮询参考图任务失败')
            const data = json.data ?? {}
            onPhase?.(String(data.phase ?? ''))
            lastPollingError = ''
            const progress = data.progress as ReferenceGenerationProgress | undefined
            const activitySignature = [data.phase, data.attempts, progress?.stage, progress?.attempt, progress?.timings?.totalMs].join(':')
            if (activitySignature !== lastActivitySignature) {
                lastActivitySignature = activitySignature
                lastActivityAt = Date.now()
            } else if (data.phase !== 'queued' && Date.now() - lastActivityAt >= REF_IMAGE_STALE_WINDOW_MS) {
                const stalledMessage = '图片任务超过 2 分钟没有心跳，已自动回收，请重试'
                throw new Error(`REF_IMAGE_JOB_ERROR:${stalledMessage}`)
            }
            if (progress) onProgress?.(progress)
            if (data.phase === 'done') {
                if (!data.result) throw new Error('参考图任务已完成但未返回结果')
                return data.result as RefImageJobResult
            }
            if (data.phase === 'error') throw new Error(`REF_IMAGE_JOB_ERROR:${data.error ?? '参考图任务失败'}`)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.startsWith('REF_IMAGE_JOB_ERROR:')) throw new Error(message.slice('REF_IMAGE_JOB_ERROR:'.length))
            if (!isTransientReferenceJobError(message)) throw error
            // The generation runs on the server. A temporary status-request
            // failure must not mark the image itself as failed; keep polling
            // until the job returns its persisted result.
            lastPollingError = message
        }
        await new Promise(r => setTimeout(r, nextRefImagePollInterval(attempt++)))
    }
    throw new Error(`参考图任务超时（30 分钟未完成）${lastPollingError ? `，最近一次状态查询失败：${lastPollingError}` : ''}`)
}

async function pollPromptEnhancementJob(jobId: string, timeoutMs = 5 * 60 * 1000): Promise<PromptAiActionResult> {
    const deadline = Date.now() + timeoutMs
    let attempt = 0
    while (Date.now() < deadline) {
        const res = await clientFetch(`/api/ai/expand-prompt/status/${jobId}`)
        const json = await readApiJson(res)
        if (!res.ok || !json.success) throw new Error(json.error ?? '轮询 Prompt 优化任务失败')
        const data = json.data ?? {}
        if (data.phase === 'done') {
            const improved = data.result?.expanded
            if (typeof improved !== 'string' || !improved.trim()) throw new Error('Prompt 优化任务已完成但未返回结果')
            return {
                prompt: improved.trim(),
                summary: Array.isArray(data.result?.optimizationSummary) ? data.result.optimizationSummary.map(String).filter(Boolean) : [],
                visualDiagnosisUsed: data.result?.visualDiagnosisUsed === true
            }
        }
        if (data.phase === 'error') throw new Error(data.error ?? 'Prompt 优化失败')
        await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs: Math.min(1000 + attempt++ * 500, 5000), jitterRatio: 0.15 })))
    }
    throw new Error('Prompt 优化任务超时（5 分钟未完成）')
}

const REFERENCE_STAGE_LABELS: Record<ReferenceGenerationProgress['stage'], string> = {
    generating: '模型出图',
    inspecting: '质量检查',
    uploading: '上传图片',
    writing_db: '保存结果'
}

function referenceProgressLabel(progress: ReferenceGenerationProgress | undefined, t: ReturnType<typeof useI18n>['t']): string {
    if (!progress) return t('准备任务')
    const retry = progress.attempt > 1 ? ` · ${t('第 {attempt}/{maxAttempts} 轮', { attempt: progress.attempt, maxAttempts: progress.maxAttempts })}` : ''
    const elapsedSeconds = Math.max(0, Math.round(progress.timings.totalMs / 1000))
    return `${t(REFERENCE_STAGE_LABELS[progress.stage])}${retry} · ${t('{seconds} 秒', { seconds: elapsedSeconds })}`
}

function conciseCharacterGenerationError(message: string): string {
    const errorCode = message.match(/\[(HIMODELS_IMAGE_[A-Z_]+)\]/)?.[1]
    const cleaned = message
        .replace(/\[HIMODELS_IMAGE_[A-Z_]+\]\s*/g, '')
        .replace(/\s*\(request\s*id\s*:[^)]+\)/gi, '')
        .replace(/(?:^|\s*\|\s*|[,，;；]\s*)?(?:x[-_]?request[-_]?id|request[-_\s]?id|x[-_]?trace[-_]?id|trace[-_\s]?id|gw[-_]?trace[-_]?id|task[-_]?id)\s*[:=：]\s*[\w-]+/gi, '')
        .replace(/(?:^|\s*\|\s*|[,，;；]\s*)?topLevelKeys\s*[:=：]\s*(?:\[[^\]]*\]|[^|;；]+)/gi, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s*\|\s*(?=\||$)/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    if (errorCode === 'HIMODELS_IMAGE_THINKING_ROUTE' || /thinking[_\s-]*level.*(?:not supported|不支持|不兼容|线路)/i.test(cleaned)) return '模型线路参数不兼容（thinking_level）'
    if (errorCode === 'HIMODELS_IMAGE_ROUTE_UNAVAILABLE') return '模型线路暂时不可用'
    if (errorCode === 'HIMODELS_IMAGE_EMPTY_RESPONSE') return '模型未返回图片'
    if (errorCode === 'HIMODELS_IMAGE_ASYNC_PENDING') return '上游任务仍在处理，已避免重复提交'
    if (errorCode === 'HIMODELS_IMAGE_SAFETY_BLOCK') return '图片被模型安全策略拦截'
    if (errorCode === 'HIMODELS_IMAGE_PROVIDER_RESPONSE') return '模型服务返回异常'
    if (/未返回图片(?:内容)?|did not return (?:an )?image|no image (?:content|data)/i.test(cleaned)) return '模型未返回图片'
    if (/没有心跳|任务租约过期|自动回收|timed?\s*out|超时/i.test(cleaned)) return '任务超时或无响应'
    if (/429|rate.?limit|限流/i.test(cleaned)) return '模型服务限流'
    if (/503|no available image provider|route_exhausted|暂无可用.*(?:模型|线路)/i.test(cleaned)) return '模型线路暂时不可用'
    if (/上传 local storage 失败|upload.*failed/i.test(cleaned)) return '图片上传失败'
    if (/Reference quality inspection failed.*finishReason=MAX_TOKENS/i.test(cleaned)) return '图片已生成，但质检响应被截断，请重试该角色'

    if (/身份\/构图门禁|quality gate|质检失败/i.test(cleaned)) {
        const reasons: string[] = []
        if (/物种|身体结构|subject.?type|wrong species|human substitute|required animal species/i.test(cleaned)) reasons.push('物种或身体结构不正确')
        if (/不是同一角色|identity (?:inconsistency|drift|mismatch)|identity.*not consistent/i.test(cleaned)) reasons.push('角色身份不一致')
        if (/duplicate|near-duplicate|重复|distinct/i.test(cleaned)) reasons.push('视角重复')
        if (/missing .*view|incorrect.*(?:angle|view|order)|angle.*(?:incorrect|wrong|failed)|角度不正确|视图覆盖不完整|有效不同.*角度|角度覆盖/i.test(cleaned)) reasons.push('角度覆盖不足')
        if (/background|shadow|背景|阴影/i.test(cleaned)) reasons.push('背景不合格')
        if (/crop|cropp|裁切|全身/i.test(cleaned)) reasons.push('主体未完整入镜')
        if (/text|typography|watermark|文字|水印/i.test(cleaned)) reasons.push('包含文字或水印')
        return `图片质检未通过${reasons.length > 0 ? `（${[...new Set(reasons)].slice(0, 3).join('、')}）` : ''}`
    }

    return cleaned.length > 96 ? `${cleaned.slice(0, 96)}…` : cleaned || '参考图生成失败'
}

function parseReferenceCandidates(raw: string | null | undefined): string[] {
    if (!raw) return []
    try {
        const value = JSON.parse(raw)
        return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
    } catch {
        return []
    }
}

function characterRoleAssets(character: Character, role: CharacterIdentityRole) {
    const assets = (character.referenceAssetRows ?? []).filter(asset => asset.role === role)
    if (role !== 'full_body') return assets
    const knownUrls = new Set((character.referenceAssetRows ?? []).map(asset => asset.url))
    const legacyAssets = Array.from(new Set([character.referenceImageUrl, ...parseReferenceCandidates(character.referenceCandidates)].filter((url): url is string => Boolean(url))))
        .filter(url => !knownUrls.has(url))
        .map((url, index) => ({
            id: `legacy-full-body:${index}:${url}`,
            role: 'full_body',
            stateKey: null,
            promptVersion: null,
            url,
            status: url === character.referenceImageUrl ? 'selected' : 'candidate'
        }))
    return [...assets, ...legacyAssets]
}

function selectedCharacterRoleAsset(character: Character, role: CharacterIdentityRole) {
    const selected = characterRoleAssets(character, role).find(asset => asset.status === 'selected')
    if (selected) return selected
    if (role === 'full_body' && character.referenceImageUrl) {
        return {
            id: `legacy-full-body:selected:${character.referenceImageUrl}`,
            role,
            stateKey: null,
            promptVersion: null,
            url: character.referenceImageUrl,
            status: 'selected'
        }
    }
    return null
}

function updateCharacterReferenceSelection(character: Character, url: string | null, role: CharacterIdentityRole): Character {
    return {
        ...character,
        referenceImageUrl: role === 'turnaround_sheet' ? url : character.referenceImageUrl,
        referenceAssetRows: character.referenceAssetRows?.map(asset =>
            asset.role === role ? { ...asset, status: asset.url === url ? 'selected' : asset.status === 'selected' ? 'candidate' : asset.status } : asset
        )
    }
}

function productionCharacterIdentityRoles(): CharacterIdentityRole[] {
    return ['turnaround_sheet']
}

function missingCharacterIdentityRoleCount(character: Character) {
    if (!character.appearancePrompt?.trim()) return 0
    return productionCharacterIdentityRoles().filter(role => !selectedCharacterRoleAsset(character, role)).length
}

function getInitialProjectNavigation(routeTab: ProjectTab): { tab: ProjectTab; stage: string } {
    if (typeof window === 'undefined') return { tab: routeTab, stage: 'setup' }
    const searchParams = new URLSearchParams(window.location.search)
    const tab = searchParams.get('tab')
    const stage = searchParams.get('stage')
    const validTab = tab === 'insights' || tab === 'novel' || tab === 'episodes' || tab === 'characters' || tab === 'scenes' ? tab : routeTab
    const validStage = stage === 'setup' || stage === 'outlined' || stage === 'drafting' || stage === 'finalized' ? stage : 'setup'
    return { tab: routeTab === 'characters' || routeTab === 'scenes' ? routeTab : stage ? 'novel' : validTab, stage: validStage }
}

function projectTabHref(projectId: string, tab: ProjectTab) {
    if (tab === 'characters' || tab === 'scenes') return `/projects/${projectId}/${tab}`
    if (tab === 'novel') return `/projects/${projectId}?tab=novel&stage=setup`
    return `/projects/${projectId}?tab=${tab}`
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'local-studio.project-sidebar-collapsed'

export function ProjectWorkspace({ initialTab = 'novel' }: { initialTab?: ProjectTab }) {
    const { locale, t, href } = useI18n()
    const { confirm, confirmDialog } = useConfirmDialog()
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const [project, setProject] = useState<Project | null>(null)
    const [editingProjectTitle, setEditingProjectTitle] = useState(false)
    const [projectTitleDraft, setProjectTitleDraft] = useState('')
    const [savingProjectTitle, setSavingProjectTitle] = useState(false)
    const projectRequestVersion = useRef(0)
    const [initialNav] = useState(() => getInitialProjectNavigation(initialTab))
    const [activeTab, setActiveTab] = useState<ProjectTab>(initialNav.tab)
    const [novelStageView, setNovelStageViewState] = useState<string>(initialNav.stage)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return typeof window !== 'undefined' && localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
        } catch {
            return false
        }
    })
    const [showAddChar, setShowAddChar] = useState(false)
    const [showAddScene, setShowAddScene] = useState(false)
    const [charForm, setCharForm] = useState({ name: '', role: '', age: '', gender: '', appearancePrompt: '', personality: '' })
    const [sceneForm, setSceneForm] = useState({ name: '', description: '', locationPrompt: '', timeOfDay: '' })
    const [aiMsg, setAiMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    // aiMsg 是历史遗留的"左下角小卡片"状态；改造为右上角 toast 后，只作为触发源，
    // 每次非空就 push 一条 toast，不再在页面里渲染那张卡片。
    useEffect(() => {
        if (!aiMsg) return
        pushToast(aiMsg.type, aiMsg.text)
    }, [aiMsg])
    const [generatingRefFor, setGeneratingRefFor] = useState<Set<string>>(new Set())
    const [characterGenerationProgress, setCharacterGenerationProgress] = useState<Record<string, ReferenceGenerationProgress>>({})
    const [characterGenerationErrors, setCharacterGenerationErrors] = useState<Record<string, string>>({})
    const [lastCharacterBatchFailures, setLastCharacterBatchFailures] = useState<CharacterBatchFailure[]>([])
    const manuallyGeneratingCharacterRefs = useRef(new Set<string>())
    const supersededCharacterBatchFailures = useRef(new Set<string>())
    const [generatingSceneRefFor, setGeneratingSceneRefFor] = useState<Set<string>>(new Set())
    const sceneBatchPreflightPending = useRef(false)
    const sceneBatchController = useRef<AbortController | null>(null)
    const [sceneBatchRestoring, setSceneBatchRestoring] = useState(true)
    const [sceneBatchPreparingMode, setSceneBatchPreparingMode] = useState<'missing' | 'all' | null>(null)
    const sceneBatchPreparing = sceneBatchPreparingMode !== null
    const [charBatch, setCharBatch] = useState<CharacterBatchState | null>(null)
    const [characterBatchRestoring, setCharacterBatchRestoring] = useState(true)
    const characterBatchController = useRef<AbortController | null>(null)
    const [sceneBatch, setSceneBatch] = useState<SceneBatchState | null>(null)
    const [sceneGenerationErrors, setSceneGenerationErrors] = useState<Record<string, string>>({})
    const [sceneGenerationProgress, setSceneGenerationProgress] = useState<Record<string, ReferenceGenerationProgress>>({})
    const [savingCharacterPromptFor, setSavingCharacterPromptFor] = useState<Set<string>>(new Set())
    const [expandedSceneDescriptionIds, setExpandedSceneDescriptionIds] = useState<Set<string>>(new Set())
    const [savingScenePromptFor, setSavingScenePromptFor] = useState<Set<string>>(new Set())
    const [promptEditor, setPromptEditor] = useState<ReferencePromptEditor | null>(null)
    const [imageProvider, setImageProvider] = useState<ImageProvider>('banana')
    const [savingImageProvider, setSavingImageProvider] = useState(false)
    const [imageQuality, setImageQuality] = useState<ImageQuality>('standard')
    const [savingImageQuality, setSavingImageQuality] = useState(false)
    const [referencePreview, setReferencePreview] = useState<ReferencePreview | null>(null)
    const [hiddenReferenceCandidateKeys, setHiddenReferenceCandidateKeys] = useState<ReadonlySet<string>>(new Set())
    const referenceCandidateDeletionKeys = useRef(new Set<string>())
    const [savingCharacterReferenceFor, setSavingCharacterReferenceFor] = useState<ReadonlySet<string>>(new Set())
    const pendingCharacterReferenceSelections = useRef(new Set<string>())
    const [savingSceneReferenceFor, setSavingSceneReferenceFor] = useState<ReadonlySet<string>>(new Set())
    const pendingSceneReferenceSelections = useRef(new Set<string>())
    const characterReferenceSelectionVersions = useRef(new Map<string, number>())
    const imageSettingsLoaded = useRef(false)
    const providerSwitchToastKeys = useRef<Set<string>>(new Set())

    useEffect(() => {
        if (!referencePreview) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setReferencePreview(null)
                return
            }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const direction = event.key === 'ArrowLeft' ? -1 : 1
            setReferencePreview(current => {
                if (!current || current.urls.length < 2) return current
                return { ...current, index: (current.index + direction + current.urls.length) % current.urls.length }
            })
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [referencePreview])

    function moveReferencePreview(direction: -1 | 1) {
        setReferencePreview(current => {
            if (!current || current.urls.length < 2) return current
            return { ...current, index: (current.index + direction + current.urls.length) % current.urls.length }
        })
    }

    function updateWorkspaceUrl(path: string) {
        const target = href(path)
        if (target === `${window.location.pathname}${window.location.search}`) return
        // These sections share one mounted workspace. Updating history avoids a
        // route request (and its reload fallback) while preserving Back/Forward.
        window.history.pushState(null, '', target)
    }

    function navigateToProjectTab(tab: ProjectTab) {
        setActiveTab(tab)
        if (tab === 'novel') setNovelStageViewState('setup')
        updateWorkspaceUrl(projectTabHref(id, tab))
    }

    function navigateToNovelStage(stage: string) {
        setActiveTab('novel')
        setNovelStageViewState(stage)
        updateWorkspaceUrl(`/projects/${id}?tab=novel&stage=${encodeURIComponent(stage)}`)
    }

    function toggleSidebar() {
        const collapsed = !sidebarCollapsed
        setSidebarCollapsed(collapsed)
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
        } catch {
            // Navigation still preserves the live state without browser storage.
        }
    }

    function imageProviderSwitchToastKey(providerSwitch: ImageProviderSwitch | undefined, contentKey: string) {
        if (!providerSwitch || ![422, 429].includes(providerSwitch.status ?? 0)) return null
        return `${contentKey}:${providerSwitch.from}:${providerSwitch.to}:${providerSwitch.status}`
    }

    function rememberImageProviderSwitch(providerSwitch: ImageProviderSwitch | undefined, contentKey: string) {
        const key = imageProviderSwitchToastKey(providerSwitch, contentKey)
        if (key) providerSwitchToastKeys.current.add(key)
    }

    function notifyImageProviderSwitch(providerSwitch: ImageProviderSwitch | undefined, contentKey: string, fallbackContentLabel: string) {
        const key = imageProviderSwitchToastKey(providerSwitch, contentKey)
        if (!providerSwitch || !key) return
        if (providerSwitchToastKeys.current.has(key)) return
        providerSwitchToastKeys.current.add(key)
        const fromLabel = IMAGE_PROVIDER_OPTIONS.find(option => option.value === providerSwitch.from)?.label ?? providerSwitch.from
        const toLabel = IMAGE_PROVIDER_OPTIONS.find(option => option.value === providerSwitch.to)?.label ?? providerSwitch.to
        const contentLabel = fallbackContentLabel || providerSwitch.contentLabel || '当前图片'
        pushToast(
            'success',
            providerSwitch.status === 429
                ? `“${contentLabel}”连续 ${providerSwitch.attempts ?? 3} 次触发 429，已从 ${fromLabel} 切换至 ${toLabel}`
                : `“${contentLabel}”角度未通过检查，已仅将当前图片从 ${fromLabel} 切换至 ${toLabel} 重试`
        )
    }

    useLayoutEffect(() => {
        const syncNavigationFromUrl = () => {
            const navigation = getInitialProjectNavigation(initialTab)
            setActiveTab(navigation.tab)
            setNovelStageViewState(navigation.stage)
        }
        syncNavigationFromUrl()
        window.addEventListener('popstate', syncNavigationFromUrl)
        return () => window.removeEventListener('popstate', syncNavigationFromUrl)
    }, [initialTab])

    async function fetchProject(): Promise<Project | null> {
        const requestVersion = ++projectRequestVersion.current
        const selectionVersions = new Map(characterReferenceSelectionVersions.current)
        const pendingSelections = new Set(pendingCharacterReferenceSelections.current)
        try {
            const res = await clientFetch(`/api/projects/${id}?__fresh=${requestVersion}`)
            if (isUnavailablePageStatus(res.status)) {
                redirectToHomepage()
                return null
            }
            const json = await res.json()
            if (!json.success) throw new Error(json.error ?? '项目加载失败')
            const nextProject = json.data as Project
            if (requestVersion !== projectRequestVersion.current) return null
            setProject(previous => {
                if (!previous || previous.id !== nextProject.id) return nextProject
                return {
                    ...nextProject,
                    characters: nextProject.characters.map(character => {
                        const keepLocalSelection =
                            pendingSelections.has(character.id) ||
                            pendingCharacterReferenceSelections.current.has(character.id) ||
                            selectionVersions.get(character.id) !== characterReferenceSelectionVersions.current.get(character.id)
                        const local = keepLocalSelection ? previous.characters.find(item => item.id === character.id) : undefined
                        if (!local) return character
                        // A refresh started before/during a save may contain the
                        // old selection. Still accept new candidates and metadata.
                        const selected = selectedCharacterRoleAsset(local, 'turnaround_sheet')
                        const merged = updateCharacterReferenceSelection(character, local.referenceImageUrl, 'turnaround_sheet')
                        if (selected && !merged.referenceAssetRows?.some(asset => asset.role === selected.role && asset.stateKey === selected.stateKey && asset.url === selected.url)) {
                            merged.referenceAssetRows = [...(merged.referenceAssetRows ?? []), selected]
                        }
                        return merged
                    })
                }
            })
            return nextProject
        } catch (error) {
            if (requestVersion !== projectRequestVersion.current) return null
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '项目加载失败，请重试' })
            return null
        }
    }

    async function loadImageProvider() {
        try {
            const res = await clientFetch('/api/settings')
            const json = await res.json()
            const rows: Array<{ provider: string; modelName?: string | null }> = json.data ?? []
            const image = rows.find(c => c.provider === 'image')
            if (isProductionImageProvider(image?.modelName)) {
                setImageProvider(image.modelName)
            }
            const quality = rows.find(c => c.provider === 'image_quality')
            setImageQuality(normalizeImageQuality(quality?.modelName))
        } catch {
            // Settings are optional; keep the default provider.
        }
    }

    function displayCharacterReferenceResults(results: Array<{ jobId: string; result: RefImageJobResult }>, selectionVersions: ReadonlyMap<string, number>) {
        if (results.length === 0) return
        // A project request started before this completion must not hide its image.
        projectRequestVersion.current += 1
        setProject(previous => {
            if (!previous || previous.id !== id) return previous
            return {
                ...previous,
                characters: previous.characters.map(character => {
                    const preserveSelection =
                        pendingCharacterReferenceSelections.current.has(character.id) || selectionVersions.get(character.id) !== characterReferenceSelectionVersions.current.get(character.id)
                    return results.reduce((current, { jobId, result }) => applyCharacterReferenceResult(current, jobId, result, preserveSelection), character)
                })
            }
        })
    }

    useEffect(() => {
        // 图片配置不阻塞小说首屏；只在用户真正进入相关页签时加载一次。
        if ((activeTab === 'characters' || activeTab === 'scenes') && !imageSettingsLoaded.current) {
            imageSettingsLoaded.current = true
            void loadImageProvider()
        }
    }, [activeTab])

    function startEditingProjectTitle() {
        if (!project || savingProjectTitle) return
        setProjectTitleDraft(project.title)
        setEditingProjectTitle(true)
    }

    function cancelEditingProjectTitle() {
        if (savingProjectTitle) return
        setEditingProjectTitle(false)
        setProjectTitleDraft('')
    }

    async function saveProjectTitle() {
        if (!project || savingProjectTitle) return
        const title = projectTitleDraft.trim()
        if (!title) {
            setAiMsg({ type: 'error', text: '项目名称不能为空' })
            return
        }
        if (title === project.title) {
            cancelEditingProjectTitle()
            return
        }

        setSavingProjectTitle(true)
        setAiMsg(null)
        try {
            const response = await clientFetch(`/api/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '项目名称保存失败')
            const savedTitle = typeof json.data?.title === 'string' ? json.data.title : null
            if (savedTitle !== title) throw new Error('项目名称保存失败：服务端未确认新名称')
            setProject(current => (current ? { ...current, title: savedTitle } : current))
            setEditingProjectTitle(false)
            setProjectTitleDraft('')
            setAiMsg({ type: 'success', text: '项目名称已保存' })
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '项目名称保存失败' })
        } finally {
            setSavingProjectTitle(false)
        }
    }

    async function changeImageProvider(next: ImageProvider) {
        if (next === imageProvider || savingImageProvider) return
        const previous = imageProvider
        setSavingImageProvider(true)
        setImageProvider(next)
        setAiMsg(null)
        try {
            const res = await clientFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'image', modelName: next })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '参考图生成模型保存失败')
            if (json.data?.provider !== 'image' || json.data?.modelName !== next) throw new Error('参考图生成模型保存失败：服务端未确认新设置')
            setAiMsg({ type: 'success', text: `参考图生成模型已切换为 ${IMAGE_PROVIDER_OPTIONS.find(p => p.value === next)?.label ?? next}` })
        } catch (e) {
            setImageProvider(previous)
            setAiMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setSavingImageProvider(false)
        }
    }

    async function changeImageQuality(next: ImageQuality) {
        if (next === imageQuality || savingImageQuality) return
        const previous = imageQuality
        setSavingImageQuality(true)
        setImageQuality(next)
        setAiMsg(null)
        try {
            const res = await clientFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'image_quality', modelName: next })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '图片生成清晰度保存失败')
            if (json.data?.provider !== 'image_quality' || json.data?.modelName !== next) throw new Error('图片生成清晰度保存失败：服务端未确认新设置')
            setAiMsg({ type: 'success', text: `图片生成清晰度已切换为 ${IMAGE_QUALITY_OPTIONS.find(p => p.value === next)?.label ?? next}` })
        } catch (e) {
            setImageQuality(previous)
            setAiMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) })
        } finally {
            setSavingImageQuality(false)
        }
    }

    async function generateCharRef(
        charId: string,
        options: { silent?: boolean; refresh?: boolean; quality?: ImageQuality; role?: CharacterIdentityRole; replaceSelected?: boolean; retryBatchFailure?: boolean } = {}
    ): Promise<{ ok: true } | { ok: false; error: string }> {
        const role = options.role ?? 'turnaround_sheet'
        const generationKey = role === 'turnaround_sheet' ? charId : `${charId}:${role}`
        manuallyGeneratingCharacterRefs.current.add(generationKey)
        if (options.retryBatchFailure) supersededCharacterBatchFailures.current.add(generationKey)
        setCharacterGenerationErrors(prev => {
            if (!(generationKey in prev)) return prev
            const next = { ...prev }
            delete next[generationKey]
            return next
        })
        setLastCharacterBatchFailures(prev => prev.filter(failure => failure.key !== generationKey))
        setGeneratingRefFor(prev => new Set(prev).add(generationKey))
        if (!options.silent) setAiMsg(null)
        const requestId = crypto.randomUUID()
        const selectionVersions = new Map(characterReferenceSelectionVersions.current)
        try {
            const runOnce = async (): Promise<RefImageJobResult> => {
                const res = await clientFetch(`/api/characters/${charId}/reference`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: imageProvider,
                        imageQuality: options.quality ?? imageQuality,
                        role,
                        replaceSelected: options.replaceSelected === true,
                        requestId
                    })
                })
                const json = await res.json()
                if (!json.success) throw new Error(json.error)
                const jobId = json.data?.jobId as string | undefined
                if (!jobId) throw new Error('参考图任务未返回 jobId')
                const result = await pollRefImageJob('characters', charId, jobId, undefined, progress => {
                    setCharacterGenerationProgress(prev => ({ ...prev, [generationKey]: progress }))
                    const roleLabel = CHARACTER_IDENTITY_REFERENCE_ROLES.find(item => item.role === role)?.label ?? '参考图'
                    notifyImageProviderSwitch(
                        progress.providerSwitch,
                        `character:${jobId}`,
                        `${project?.characters.find(character => character.id === charId)?.name ?? `角色 ${charId}`} · ${roleLabel}`
                    )
                })
                const roleLabel = CHARACTER_IDENTITY_REFERENCE_ROLES.find(item => item.role === role)?.label ?? '参考图'
                notifyImageProviderSwitch(result.providerSwitch, `character:${jobId}`, `${project?.characters.find(character => character.id === charId)?.name ?? `角色 ${charId}`} · ${roleLabel}`)
                displayCharacterReferenceResults([{ jobId, result }], selectionVersions)
                return result
            }

            try {
                await runOnce()
            } catch (firstError) {
                const msg = firstError instanceof Error ? firstError.message : String(firstError)
                if (!isTransientReferenceJobError(msg)) throw firstError
                await new Promise(r => setTimeout(r, 1500))
                await runOnce()
            }
            if (options.refresh !== false) await fetchProject()
            return { ok: true }
        } catch (e) {
            const error = conciseCharacterGenerationError(e instanceof Error ? e.message : String(e))
            setCharacterGenerationErrors(prev => ({ ...prev, [generationKey]: error }))
            if (options.retryBatchFailure) {
                setLastCharacterBatchFailures(prev => [...prev.filter(failure => failure.key !== generationKey), { key: generationKey, reason: error }])
            }
            if (!options.silent) setAiMsg({ type: 'error', text: error })
            return { ok: false, error }
        } finally {
            manuallyGeneratingCharacterRefs.current.delete(generationKey)
            setCharacterGenerationProgress(prev => {
                const next = { ...prev }
                delete next[generationKey]
                return next
            })
            setGeneratingRefFor(prev => {
                const next = new Set(prev)
                next.delete(generationKey)
                return next
            })
        }
    }

    function getCharacterPromptValue(char: Character) {
        return char.appearancePrompt ?? ''
    }

    async function saveCharacterPrompt(charId: string, prompt: string, opts: { silent?: boolean } = {}): Promise<boolean> {
        const normalizedPrompt = prompt.trim() || null
        setSavingCharacterPromptFor(prev => new Set(prev).add(charId))
        if (!opts.silent) setAiMsg(null)
        try {
            const res = await clientFetch(`/api/characters/${charId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appearancePrompt: normalizedPrompt })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '角色视觉描述保存失败')
            if ((json.data?.appearancePrompt ?? null) !== normalizedPrompt) throw new Error('角色视觉描述保存失败：服务端未保存完整内容')
            await fetchProject()
            if (!opts.silent) setAiMsg({ type: 'success', text: '角色视觉描述已保存' })
            return true
        } catch (e) {
            setAiMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) })
            return false
        } finally {
            setSavingCharacterPromptFor(prev => {
                const next = new Set(prev)
                next.delete(charId)
                return next
            })
        }
    }

    async function generateCharRefFromCard(char: Character, role: CharacterIdentityRole = 'turnaround_sheet', retryBatchFailure = false) {
        if (characterBatchRestoring) return
        const prompt = getCharacterPromptValue(char).trim()
        if (!prompt) {
            setAiMsg({ type: 'error', text: '请先填写角色视觉描述，再生成候选图' })
            return
        }
        if (prompt !== (char.appearancePrompt ?? '')) {
            const saved = await saveCharacterPrompt(char.id, prompt, { silent: true })
            if (!saved) return
        }
        await generateCharRef(char.id, { role, retryBatchFailure })
    }

    function getScenePromptValue(scene: Scene) {
        return scene.locationPrompt ?? ''
    }

    async function saveScenePrompt(sceneId: string, prompt: string, opts: { silent?: boolean } = {}): Promise<boolean> {
        const normalizedPrompt = prompt.trim() || null
        setSavingScenePromptFor(prev => new Set(prev).add(sceneId))
        if (!opts.silent) setAiMsg(null)
        try {
            const res = await clientFetch(`/api/scenes/${sceneId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locationPrompt: normalizedPrompt })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '场景视觉描述保存失败')
            if ((json.data?.locationPrompt ?? null) !== normalizedPrompt) throw new Error('场景视觉描述保存失败：服务端未保存完整内容')
            await fetchProject()
            if (!opts.silent) setAiMsg({ type: 'success', text: '场景视觉描述已保存' })
            return true
        } catch (e) {
            setAiMsg({ type: 'error', text: e instanceof Error ? e.message : String(e) })
            return false
        } finally {
            setSavingScenePromptFor(prev => {
                const next = new Set(prev)
                next.delete(sceneId)
                return next
            })
        }
    }

    function openCharacterPromptEditor(character: Character) {
        setPromptEditor({ kind: 'character', id: character.id })
    }

    function openScenePromptEditor(scene: Scene) {
        setPromptEditor({ kind: 'scene', id: scene.id })
    }

    function closePromptEditor() {
        setPromptEditor(null)
    }

    async function savePromptEditor(value: string) {
        if (!promptEditor || !project) return
        if (promptEditor.kind === 'character') {
            const character = project.characters.find(item => item.id === promptEditor.id)
            if (!character) return
            const saved = await saveCharacterPrompt(character.id, value)
            if (saved) setPromptEditor(null)
            return
        }
        const scene = project.scenes.find(item => item.id === promptEditor.id)
        if (!scene) return
        const saved = await saveScenePrompt(scene.id, value)
        if (saved) setPromptEditor(null)
    }

    async function runPromptAiAction(action: 'rewrite' | 'expand', sourceValue: string, optimization?: PromptOptimizationInput): Promise<PromptAiActionResult | null> {
        if (!promptEditor || !project) return null
        const isCharacter = promptEditor.kind === 'character'
        const entity = isCharacter ? project.characters.find(item => item.id === promptEditor.id) : project.scenes.find(item => item.id === promptEditor.id)
        if (!entity) return null
        const source = sourceValue.trim()
        if (!source) return null

        setAiMsg(null)
        try {
            const context = isCharacter
                ? {
                      name: entity.name,
                      role: (entity as Character).role,
                      gender: (entity as Character).gender,
                      age: (entity as Character).age,
                      imageProvider
                  }
                : {
                      name: entity.name,
                      description: (entity as Scene).description,
                      imageProvider
                  }
            const res = await clientFetch('/api/ai/expand-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: project.id,
                    field: isCharacter ? 'characterPrompt' : 'scenePrompt',
                    action,
                    text: source,
                    referenceTargetId: entity.id,
                    optimizationFeedback: optimization?.feedback ?? '',
                    optimizationIssues: optimization?.issues ?? [],
                    referencePromptContext: context
                })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? `${action === 'rewrite' ? '改写' : '扩写'}失败`)
            const jobId = json.data?.jobId
            if (typeof jobId !== 'string' || !jobId) throw new Error('Prompt 优化任务未返回 jobId')
            const improved = await pollPromptEnhancementJob(jobId)
            setAiMsg({ type: 'success', text: `${action === 'rewrite' ? '优化' : t('扩写')} ✓` })
            return improved
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : String(error) })
            return null
        }
    }

    async function selectCharRef(charId: string, url: string, role: CharacterIdentityRole = 'turnaround_sheet') {
        const character = project?.characters.find(item => item.id === charId)
        if (!character || pendingCharacterReferenceSelections.current.has(charId) || referenceCandidateDeletionKeys.current.has(referenceCandidateKey('characters', charId, url, role))) return
        const previousUrl = selectedCharacterRoleAsset(character, role)?.url ?? (role === 'turnaround_sheet' ? character.referenceImageUrl : null)
        if (previousUrl === url) return

        pendingCharacterReferenceSelections.current.add(charId)
        characterReferenceSelectionVersions.current.set(charId, (characterReferenceSelectionVersions.current.get(charId) ?? 0) + 1)
        setSavingCharacterReferenceFor(new Set(pendingCharacterReferenceSelections.current))
        const applySelection = (selectedUrl: string | null) => {
            setProject(current =>
                current ? { ...current, characters: current.characters.map(item => (item.id === charId ? updateCharacterReferenceSelection(item, selectedUrl, role) : item)) } : current
            )
        }
        applySelection(url)

        try {
            const response = await clientFetch(`/api/characters/${charId}/reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'select', url, role })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '定稿参考图失败')
        } catch (error) {
            applySelection(previousUrl)
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '定稿参考图失败' })
        } finally {
            characterReferenceSelectionVersions.current.set(charId, (characterReferenceSelectionVersions.current.get(charId) ?? 0) + 1)
            pendingCharacterReferenceSelections.current.delete(charId)
            setSavingCharacterReferenceFor(new Set(pendingCharacterReferenceSelections.current))
        }
    }

    async function deleteRefCandidate(kind: 'characters' | 'scenes', targetId: string, url: string, role?: CharacterIdentityRole) {
        if (kind === 'characters' && pendingCharacterReferenceSelections.current.has(targetId)) return
        const key = referenceCandidateKey(kind, targetId, url, role)
        if (referenceCandidateDeletionKeys.current.has(key)) return
        referenceCandidateDeletionKeys.current.add(key)
        setHiddenReferenceCandidateKeys(new Set(referenceCandidateDeletionKeys.current))

        try {
            const res = await clientFetch(`/api/${kind}/${targetId}/reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', url, role })
            })
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '删除候选图失败')
            // Keep successful deletions hidden for this workspace session so a
            // late project refresh cannot bring an already deleted image back.
        } catch (error) {
            referenceCandidateDeletionKeys.current.delete(key)
            setHiddenReferenceCandidateKeys(new Set(referenceCandidateDeletionKeys.current))
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '删除候选图失败' })
        }
    }

    async function generateAllCharRefs(
        mode: 'missing' | 'all' = 'missing',
        options: { sourceProject?: Project; confirm?: boolean; replaceSelected?: boolean; existingBatch?: CharacterReferenceBatchStatus } = {}
    ) {
        const activeProject = options.sourceProject ?? project
        const existingBatch = options.existingBatch
        if (!activeProject || characterBatchController.current || (characterBatchRestoring && !existingBatch)) return
        const replaceSelected = (existingBatch?.replaceSelected ?? options.replaceSelected) === true
        const eligibleCharacters = activeProject.characters.filter(character => character.appearancePrompt?.trim())
        const plannedIdentityTasks = eligibleCharacters.flatMap(character =>
            productionCharacterIdentityRoles()
                .filter(role => mode === 'all' || !selectedCharacterRoleAsset(character, role))
                .map(role => ({ character, role }))
        )
        if (!existingBatch && plannedIdentityTasks.length === 0) return
        if (!existingBatch && mode === 'all' && options.confirm !== false) {
            const approved = await confirm({
                title: replaceSelected ? t('重新生成多视图角色设定板？') : `${t('全部重新生成候选')}？`,
                message: `${t('将为 {count} 个角色各生成一张 16:9 多视图设定板，包含面部特写和正面、45°、侧面、背面四个全身视图。生成失败时保留旧图。').replace(
                    '{count}',
                    String(eligibleCharacters.length)
                )} ${t('当前定稿图和已有候选图都会保留；每张新图都会扣除对应金币。')}`,
                confirmText: t('开始重新生成'),
                tone: 'warning'
            })
            if (!approved) return
        }
        if (characterBatchController.current) return
        const controller = new AbortController()
        characterBatchController.current = controller
        const batchQuality: ImageQuality = 'ultra'
        const plannedGenerationKeys = new Set(
            existingBatch
                ? existingBatch.items.map(item => characterReferenceGenerationKey(item.characterId, item.role))
                : plannedIdentityTasks.map(task => characterReferenceGenerationKey(task.character.id, task.role))
        )
        const observedGenerationKeys = new Set(plannedGenerationKeys)
        const displayedCharacterReferenceJobIds = new Set<string>()
        // Completed results were already loaded from the project. Replaying an
        // old job could overwrite a newer selection or restore a deleted image.
        for (const item of existingBatch?.items ?? []) {
            if (item.phase === 'done') displayedCharacterReferenceJobIds.add(item.jobId)
            rememberImageProviderSwitch(item.progress?.providerSwitch ?? item.result?.providerSwitch, `character:${item.jobId}`)
        }
        const selectionVersions = new Map(characterReferenceSelectionVersions.current)
        const charactersById = new Map(activeProject.characters.map(character => [character.id, character]))
        supersededCharacterBatchFailures.current.clear()
        setAiMsg(null)
        setCharacterGenerationErrors(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !plannedGenerationKeys.has(key))))
        setLastCharacterBatchFailures([])
        setCharBatch({ done: existingBatch?.completed ?? 0, total: existingBatch?.total ?? plannedIdentityTasks.length, failed: existingBatch?.failed ?? 0, mode })
        if (!existingBatch) setGeneratingRefFor(previous => new Set([...previous, ...plannedGenerationKeys]))
        try {
            let jobId = existingBatch?.id
            if (!jobId) {
                const response = await clientFetch(`/api/projects/${activeProject.id}/character-references`, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: imageProvider,
                        imageQuality: batchQuality,
                        replaceSelected,
                        mode,
                        tasks: plannedIdentityTasks.map(task => ({ characterId: task.character.id, role: task.role }))
                    })
                })
                const responseJson = await response.json()
                if (!responseJson.success) throw new Error(responseJson.error ?? '批量提交角色参考图失败')
                jobId = responseJson.data?.jobId as string | undefined
            }
            controller.signal.throwIfAborted()
            if (!jobId) throw new Error('角色参考图批次未返回 jobId')

            const finalStatus = await pollCharacterReferenceBatch(
                activeProject.id,
                jobId,
                status => {
                    const runningKeys = new Set<string>()
                    const progressByKey: Record<string, ReferenceGenerationProgress> = {}
                    const errorsByKey: Record<string, string> = {}
                    const completedResults: Array<{ jobId: string; result: RefImageJobResult }> = []
                    for (const item of status.items) {
                        const key = characterReferenceGenerationKey(item.characterId, item.role)
                        observedGenerationKeys.add(key)
                        if (supersededCharacterBatchFailures.current.has(key)) continue
                        if (!['done', 'error', 'cancelled'].includes(item.phase)) runningKeys.add(key)
                        if (item.phase === 'done' && item.result && !displayedCharacterReferenceJobIds.has(item.jobId)) {
                            displayedCharacterReferenceJobIds.add(item.jobId)
                            completedResults.push({ jobId: item.jobId, result: item.result })
                        }
                        if (item.progress) progressByKey[key] = item.progress
                        if (item.phase === 'error' || item.phase === 'cancelled') {
                            const reason = conciseCharacterGenerationError(item.error ?? '生成失败')
                            errorsByKey[key] = reason
                        }
                        const providerSwitch = item.progress?.providerSwitch ?? item.result?.providerSwitch
                        if (providerSwitch) {
                            notifyImageProviderSwitch(providerSwitch, `character:${item.jobId}`, `${charactersById.get(item.characterId)?.name ?? `角色 ${item.characterId}`} · 多视图角色设定板`)
                        }
                    }
                    displayCharacterReferenceResults(completedResults, selectionVersions)
                    setGeneratingRefFor(previous => {
                        const next = new Set(previous)
                        for (const key of observedGenerationKeys) {
                            if (!manuallyGeneratingCharacterRefs.current.has(key) && !supersededCharacterBatchFailures.current.has(key)) next.delete(key)
                        }
                        for (const key of runningKeys) next.add(key)
                        return next
                    })
                    setCharacterGenerationProgress(previous => {
                        const next = { ...previous }
                        for (const key of observedGenerationKeys) {
                            if (!manuallyGeneratingCharacterRefs.current.has(key) && !supersededCharacterBatchFailures.current.has(key)) delete next[key]
                        }
                        return { ...next, ...progressByKey }
                    })
                    setCharacterGenerationErrors(previous => {
                        const next = { ...previous }
                        for (const key of observedGenerationKeys) {
                            if (!manuallyGeneratingCharacterRefs.current.has(key) && !supersededCharacterBatchFailures.current.has(key)) delete next[key]
                        }
                        return { ...next, ...errorsByKey }
                    })
                    setCharBatch({ done: status.completed, total: status.total, failed: status.failed, mode })
                },
                { signal: controller.signal, initialStatus: existingBatch }
            )

            const failures: CharacterBatchFailure[] = finalStatus.items.flatMap(item => {
                if (item.phase !== 'error' && item.phase !== 'cancelled') return []
                const key = characterReferenceGenerationKey(item.characterId, item.role)
                return [
                    {
                        key,
                        reason: conciseCharacterGenerationError(item.error ?? '生成失败')
                    }
                ]
            })
            const failureCounts = new Map<string, number>()
            for (const failure of failures) failureCounts.set(failure.reason, (failureCounts.get(failure.reason) ?? 0) + 1)
            const failed = Math.max(failures.length, finalStatus.failed)
            const batchInterrupted = finalStatus.phase === 'error' || finalStatus.phase === 'cancelled'
            const success = Math.max(0, finalStatus.total - failed)
            const primaryFailure = finalStatus.error ?? [...failureCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
            await fetchProject()
            controller.signal.throwIfAborted()
            const supersededKeys = new Set(supersededCharacterBatchFailures.current)
            setLastCharacterBatchFailures(previous => [...failures.filter(failure => !supersededKeys.has(failure.key)), ...previous.filter(failure => supersededKeys.has(failure.key))])
            if (!existingBatch || !characterReferenceBatchFinished(existingBatch) || (batchInterrupted && finalStatus.items.length === 0))
                setAiMsg({
                    type: failed === 0 && !batchInterrupted ? 'success' : 'error',
                    text:
                        batchInterrupted && finalStatus.items.length === 0
                            ? conciseCharacterGenerationError(primaryFailure ?? '角色参考图批次失败')
                            : failed === 0
                              ? mode === 'all'
                                  ? replaceSelected
                                      ? `多视图角色设定板重新生成完成：已替换 ${success} 张定稿图`
                                      : `${t('全部重新生成候选')}：${t('成功')} ${success}`
                                  : t('多视图角色设定板生成完成：{count} 张', { count: success })
                              : `角色参考图生成结束：成功 ${success} 张，失败 ${failed} 张。${primaryFailure ? `主要原因：${primaryFailure}` : '可在对应角色卡里重试。'}`
                })
        } catch (error) {
            if (controller.signal.aborted) return
            const message = conciseCharacterGenerationError(error instanceof Error ? error.message : String(error))
            setAiMsg({ type: 'error', text: message })
        } finally {
            if (!controller.signal.aborted && characterBatchController.current === controller) {
                characterBatchController.current = null
                setGeneratingRefFor(previous => {
                    const next = new Set(previous)
                    for (const key of observedGenerationKeys) {
                        if (!manuallyGeneratingCharacterRefs.current.has(key) && !supersededCharacterBatchFailures.current.has(key)) next.delete(key)
                    }
                    return next
                })
                setCharacterGenerationProgress(previous => {
                    const next = { ...previous }
                    for (const key of observedGenerationKeys) {
                        if (!manuallyGeneratingCharacterRefs.current.has(key) && !supersededCharacterBatchFailures.current.has(key)) delete next[key]
                    }
                    return next
                })
                setCharBatch(null)
            }
        }
    }

    async function restoreCharacterReferenceBatch(sourceProject: Project, signal: AbortSignal) {
        try {
            if (signal.aborted) return
            setCharacterBatchRestoring(true)
            const response = await clientFetch(`/api/projects/${id}/character-references/status/latest`, { signal, cache: 'no-store' })
            const json = await readApiJson(response)
            signal.throwIfAborted()
            if (!response.ok || !json.success) throw new Error(json.error ?? '任务状态查询失败')
            const existingBatch = json.data as CharacterReferenceBatchStatus | null
            setCharacterBatchRestoring(false)
            if (existingBatch?.id && !characterBatchController.current) {
                await generateAllCharRefs(existingBatch.mode ?? 'missing', { sourceProject, existingBatch })
            }
        } catch (error) {
            if (!signal.aborted) setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '任务状态查询失败' })
        } finally {
            if (!signal.aborted) setCharacterBatchRestoring(false)
        }
    }

    async function handleExtractCommitted(payload: { characterIds: string[]; sceneIds: string[]; newChars: number; newScenes: number; replaceAll: boolean }) {
        navigateToProjectTab('characters')
        const refreshedProject = await fetchProject()
        if (!payload.replaceAll) {
            setAiMsg({
                type: 'success',
                text: payload.characterIds.length > 0 || payload.sceneIds.length > 0 ? '角色和场景已更新。请点击“补齐多视图设定板”生成所需参考图。' : '角色和场景已更新，没有需要重新生成的参考图。'
            })
            return
        }
        if (!refreshedProject || (payload.characterIds.length === 0 && payload.sceneIds.length === 0)) {
            setAiMsg({ type: 'success', text: '角色和场景已替换，没有可生成的参考图。' })
            return
        }
        setAiMsg({ type: 'success', text: '旧角色、旧场景及参考图已清空，正在按本次提取结果重新生成角色参考图。' })
        await generateAllCharRefs('all', { sourceProject: refreshedProject, confirm: false, replaceSelected: true })
        const afterCharacters = (await fetchProject()) ?? refreshedProject
        navigateToProjectTab('scenes')
        setAiMsg({ type: 'success', text: '角色参考图处理完成，正在重新生成场景参考图。' })
        await generateAllSceneRefs('all', afterCharacters, { confirm: false })
    }

    async function generateSceneRef(
        sceneId: string,
        options: { silent?: boolean; refresh?: boolean; quality?: ImageQuality } = {}
    ): Promise<{ ok: true; result: RefImageJobResult } | { ok: false; error: string }> {
        if (sceneBatchController.current || sceneBatchPreflightPending.current || sceneBatchRestoring) return { ok: false, error: '场景参考图批次进行中，请稍候' }
        setGeneratingSceneRefFor(prev => new Set(prev).add(sceneId))
        setSceneGenerationProgress(previous => {
            const next = { ...previous }
            delete next[sceneId]
            return next
        })
        setSceneGenerationErrors(previous => {
            const next = { ...previous }
            delete next[sceneId]
            return next
        })
        if (!options.silent) setAiMsg(null)
        try {
            const res = await clientFetch(`/api/scenes/${sceneId}/reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: imageProvider, imageQuality: options.quality ?? imageQuality, requestId: crypto.randomUUID() })
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
            const jobId = json.data?.jobId as string | undefined
            if (!jobId) throw new Error('参考图任务未返回 jobId')
            const result = await pollRefImageJob('scenes', sceneId, jobId, undefined, progress => {
                setSceneGenerationProgress(previous => ({ ...previous, [sceneId]: progress }))
                notifyImageProviderSwitch(progress.providerSwitch, `scene:${jobId}`, project?.scenes.find(scene => scene.id === sceneId)?.name ?? `场景 ${sceneId}`)
            })
            notifyImageProviderSwitch(result.providerSwitch, `scene:${jobId}`, project?.scenes.find(scene => scene.id === sceneId)?.name ?? `场景 ${sceneId}`)
            setProject(previous => {
                if (!previous) return previous
                return {
                    ...previous,
                    scenes: previous.scenes.map(scene =>
                        scene.id === sceneId
                            ? {
                                  ...scene,
                                  referenceImageUrl: result.referenceImageUrl ?? result.candidateUrl,
                                  referenceCandidates: JSON.stringify(result.referenceCandidates),
                                  referenceAssets: createSceneReferenceSelection(
                                      result.selectedReferenceUrls ?? getSelectedSceneReferenceUrls(scene.referenceAssets, result.referenceImageUrl ?? result.candidateUrl)
                                  )
                              }
                            : scene
                    )
                }
            })
            setSceneGenerationErrors(previous => {
                const next = { ...previous }
                delete next[sceneId]
                return next
            })
            if (options.refresh !== false) await fetchProject()
            return { ok: true, result }
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e)
            const sceneAlreadyHasImage = project?.scenes.some(scene => scene.id === sceneId && Boolean(scene.referenceImageUrl || parseReferenceCandidates(scene.referenceCandidates).length)) ?? false
            setSceneGenerationErrors(previous => {
                const next = { ...previous }
                if (sceneAlreadyHasImage) delete next[sceneId]
                else next[sceneId] = error
                return next
            })
            if (!options.silent) setAiMsg({ type: 'error', text: error })
            return { ok: false, error }
        } finally {
            setGeneratingSceneRefFor(prev => {
                const next = new Set(prev)
                next.delete(sceneId)
                return next
            })
            setSceneGenerationProgress(previous => {
                const next = { ...previous }
                delete next[sceneId]
                return next
            })
        }
    }

    async function generateSceneRefFromCard(scene: Scene) {
        const prompt = getScenePromptValue(scene).trim()
        if (!prompt) {
            setAiMsg({ type: 'error', text: '请先填写场景视觉描述，再生成候选图' })
            return
        }
        if (prompt !== (scene.locationPrompt ?? '')) {
            const saved = await saveScenePrompt(scene.id, prompt, { silent: true })
            if (!saved) return
        }
        await generateSceneRef(scene.id)
    }

    async function setSceneRefSelection(sceneId: string, url: string, selected: boolean) {
        const key = referenceCandidateKey('scenes', sceneId, url)
        if (pendingSceneReferenceSelections.current.has(key)) return

        pendingSceneReferenceSelections.current.add(key)
        setSavingSceneReferenceFor(new Set(pendingSceneReferenceSelections.current))
        let receivedResponse = false
        try {
            const res = await clientFetch(`/api/scenes/${sceneId}/reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: selected ? 'unselect' : 'select', url })
            })
            receivedResponse = true
            const json = await readApiJson(res)
            if (!res.ok || !json.success) throw new Error(json.error ?? '更新场景参考视角失败')
            await fetchProject()
        } catch (error) {
            // The connection may close after the idempotent mutation committed.
            // Refresh before reporting failure so the UI reflects server truth.
            const refreshedProject = await fetchProject()
            const refreshedScene = refreshedProject?.scenes.find(scene => scene.id === sceneId)
            const selectedAfterRefresh = refreshedScene ? getSelectedSceneReferenceUrls(refreshedScene.referenceAssets, refreshedScene.referenceImageUrl).includes(url) : selected
            if (refreshedScene && selectedAfterRefresh === !selected) return
            setAiMsg({
                type: 'error',
                text: receivedResponse && error instanceof Error ? error.message : '网络连接中断，未能确认场景参考视角是否更新，请重试'
            })
        } finally {
            pendingSceneReferenceSelections.current.delete(key)
            setSavingSceneReferenceFor(new Set(pendingSceneReferenceSelections.current))
        }
    }

    async function generateAllSceneRefs(mode: 'missing' | 'all' = 'missing', sourceProject: Project | null = project, options: { confirm?: boolean } = {}) {
        const toGen = sourceProject?.scenes.filter(s => (mode === 'all' || !s.referenceImageUrl) && s.locationPrompt?.trim()) ?? []
        if (toGen.length === 0 || generatingSceneRefFor.size > 0 || sceneBatchPreflightPending.current || sceneBatchController.current || sceneBatchRestoring) return
        sceneBatchPreflightPending.current = true
        setSceneBatchPreparingMode(mode)
        const batchQuality: ImageQuality = imageQuality === 'ultra' ? 'clear' : imageQuality
        let scenesToGenerate = toGen
        try {
            const response = await clientFetch(`/api/projects/${sourceProject?.id ?? id}/scene-reference-quote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sceneIds: toGen.map(scene => scene.id), provider: imageProvider, imageQuality: batchQuality })
            })
            const json = (await readApiJson(response)) as { success?: boolean; data?: SceneReferenceBatchQuote; error?: string }
            if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? '场景参考图金币核算失败')
            const quote = json.data

            if (quote.affordableCount === 0) {
                const goRecharge = await confirm({
                    title: t('金币不足'),
                    message: t('当前可用 {balance} 金币，生成一张至少需要预留 {minimum} 金币，暂时无法开始本次批量生成。模型完成后会按实际费用结算并退回多余预留。')
                        .replace('{balance}', formatPointBalance(quote.balancePoints, locale))
                        .replace('{minimum}', formatPointBalance(quote.minimumPoints, locale)),
                    confirmText: t('立即充值'),
                    cancelText: t('取消'),
                    tone: 'warning'
                })
                if (goRecharge) router.push('/wallet')
                return
            }

            const affordableSceneIds = new Set(quote.affordableSceneIds)
            scenesToGenerate = toGen.filter(scene => affordableSceneIds.has(scene.id))
            const partialBatch = scenesToGenerate.length < toGen.length
            if (partialBatch) {
                const approved = await confirm({
                    title: t('金币不足'),
                    message: t(
                        '本次计划生成 {total} 张，全部需要预留 {required} 金币；当前可用 {balance} 金币，只够按页面顺序生成前 {affordable} 张。模型完成后会按实际费用结算并退回多余预留。是否继续？'
                    )
                        .replace('{total}', String(toGen.length))
                        .replace('{required}', formatPointBalance(quote.requiredPoints, locale))
                        .replace('{balance}', formatPointBalance(quote.balancePoints, locale))
                        .replace('{affordable}', String(scenesToGenerate.length)),
                    confirmText: t('生成 {count} 张').replace('{count}', String(scenesToGenerate.length)),
                    cancelText: t('取消'),
                    tone: 'warning'
                })
                if (!approved) return
            } else if (mode === 'all' && options.confirm !== false) {
                const approved = await confirm({
                    title: `${t('全部重新生成候选')}？`,
                    message: t('将为 {count} 个场景各生成一张新候选图。当前定稿图和已有候选图都会保留；每张新图都会扣除对应金币。').replace('{count}', String(scenesToGenerate.length)),
                    confirmText: t('开始重新生成'),
                    tone: 'warning'
                })
                if (!approved) return
            }
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '场景参考图金币核算失败' })
            return
        } finally {
            sceneBatchPreflightPending.current = false
            setSceneBatchPreparingMode(null)
        }
        const controller = new AbortController()
        sceneBatchController.current = controller
        setAiMsg(null)
        setSceneBatch({ done: 0, total: scenesToGenerate.length, failed: 0, quality: batchQuality, mode })
        try {
            const response = await clientFetch(`/api/projects/${sourceProject?.id ?? id}/scene-references`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({ sceneIds: scenesToGenerate.map(scene => scene.id), provider: imageProvider, imageQuality: batchQuality, mode })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success || !json.data?.jobId) throw new Error(json.error ?? '场景批次提交失败')
            await followSceneReferenceBatch(String(json.data.jobId), controller)
        } catch (error) {
            if (!controller.signal.aborted) setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '场景批次提交失败' })
        } finally {
            if (sceneBatchController.current === controller) {
                sceneBatchController.current = null
                setSceneBatch(null)
                setGeneratingSceneRefFor(new Set())
            }
        }
    }

    async function followSceneReferenceBatch(jobId: string, controller: AbortController, initial?: SceneReferenceBatchStatus) {
        // On restore, project data is authoritative for already completed items.
        // Apply new results once so later polls cannot undo manual selections.
        const appliedResults = new Set(initial?.items.filter(item => item.phase === 'done').map(item => item.jobId))
        for (const item of initial?.items ?? []) rememberImageProviderSwitch(item.progress?.providerSwitch ?? item.result?.providerSwitch, `scene:${item.jobId}`)
        const status = await pollSceneReferenceBatch(
            id,
            jobId,
            status => {
                setSceneBatch({ done: status.completed, total: status.total, failed: status.failed, quality: status.quality ?? 'standard', mode: status.mode ?? 'missing' })
                setGeneratingSceneRefFor(new Set(status.items.filter(item => !['done', 'error', 'cancelled'].includes(item.phase)).map(item => item.sceneId)))
                setSceneGenerationProgress(previous => ({ ...previous, ...Object.fromEntries(status.items.filter(item => item.progress).map(item => [item.sceneId, item.progress!])) }))
                setSceneGenerationErrors(previous => {
                    const next = { ...previous }
                    for (const item of status.items) {
                        if (item.error) next[item.sceneId] = item.error
                        else delete next[item.sceneId]
                    }
                    return next
                })
                for (const item of status.items) {
                    notifyImageProviderSwitch(
                        item.progress?.providerSwitch ?? item.result?.providerSwitch,
                        `scene:${item.jobId}`,
                        project?.scenes.find(scene => scene.id === item.sceneId)?.name ?? `场景 ${item.sceneId}`
                    )
                }
                const freshResults = status.items.filter(item => item.result && !appliedResults.has(item.jobId))
                const results = new Map(freshResults.map(item => [item.sceneId, item.result!]))
                freshResults.forEach(item => appliedResults.add(item.jobId))
                if (results.size > 0)
                    setProject(previous =>
                        previous
                            ? {
                                  ...previous,
                                  scenes: previous.scenes.map(scene => {
                                      const result = results.get(scene.id)
                                      return result
                                          ? {
                                                ...scene,
                                                referenceImageUrl: result.referenceImageUrl ?? result.candidateUrl,
                                                referenceCandidates: JSON.stringify(result.referenceCandidates),
                                                referenceAssets: createSceneReferenceSelection(result.selectedReferenceUrls ?? [result.referenceImageUrl ?? result.candidateUrl])
                                            }
                                          : scene
                                  })
                              }
                            : previous
                    )
            },
            { signal: controller.signal, initialStatus: initial }
        )
        await fetchProject()
        controller.signal.throwIfAborted()
        const failureCounts = new Map<string, number>()
        for (const item of status.items) {
            if (item.error) failureCounts.set(item.error, (failureCounts.get(item.error) ?? 0) + 1)
        }
        const primaryFailure = [...failureCounts].sort((a, b) => b[1] - a[1])[0]
        setAiMsg({
            type: status.failed > 0 || status.phase !== 'done' ? 'error' : 'success',
            text:
                status.error ??
                `场景批量生成结束：成功 ${status.completed - status.failed} 个，失败 ${status.failed} 个。${primaryFailure ? `主要原因（${primaryFailure[1]} 个）：${primaryFailure[0]}` : ''}`
        })
    }

    async function restoreSceneReferenceBatch(signal: AbortSignal) {
        try {
            const response = await clientFetch(`/api/projects/${id}/scene-references/status/latest`, { signal, cache: 'no-store' })
            const json = await readApiJson(response)
            signal.throwIfAborted()
            if (!response.ok || !json.success) throw new Error(json.error ?? '任务状态查询失败')
            const status = json.data as SceneReferenceBatchStatus | null
            setSceneBatchRestoring(false)
            if (!status || ['done', 'error', 'cancelled'].includes(status.phase) || sceneBatchController.current) return
            const controller = new AbortController()
            sceneBatchController.current = controller
            try {
                await followSceneReferenceBatch(status.id, controller, status)
            } finally {
                if (sceneBatchController.current === controller) {
                    sceneBatchController.current = null
                    setSceneBatch(null)
                    setGeneratingSceneRefFor(new Set())
                }
            }
        } catch (error) {
            if (!signal.aborted) setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '任务状态查询失败' })
        } finally {
            if (!signal.aborted) setSceneBatchRestoring(false)
        }
    }

    useEffect(() => {
        if (!isValidRouteResourceId(id)) {
            redirectToHomepage()
            return
        }
        const recovery = new AbortController()
        // Reset the recovery guard when switching to another project.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSceneBatchRestoring(true)
        void fetchProject().then(sourceProject => {
            if (sourceProject && !recovery.signal.aborted) return Promise.all([restoreCharacterReferenceBatch(sourceProject, recovery.signal), restoreSceneReferenceBatch(recovery.signal)])
            if (!recovery.signal.aborted) setSceneBatchRestoring(false)
        })
        return () => {
            recovery.abort()
            characterBatchController.current?.abort()
            characterBatchController.current = null
            sceneBatchController.current?.abort()
            sceneBatchController.current = null
            projectRequestVersion.current += 1
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    function openNovelFinalizeStep() {
        navigateToNovelStage('finalized')
    }

    function openFirstEpisodeForStoryboard() {
        const target = project?.episodes.find(e => e.script || e.status === 'scripted' || e.status === 'storyboarded') ?? project?.episodes[0]
        if (target) {
            router.push(`/projects/${id}/episodes/${target.id}`)
            return
        }
        navigateToProjectTab('episodes')
    }

    function renderImageProviderSwitcher() {
        return (
            <>
                <CustomSelect
                    ariaLabel="图片生成模型"
                    value={imageProvider}
                    onChange={value => changeImageProvider(value as ImageProvider)}
                    disabled={savingImageProvider || !!charBatch || !!sceneBatch || sceneBatchPreparing}
                    className="studio-reference-model"
                    buttonClassName="studio-reference-select"
                    options={IMAGE_PROVIDER_OPTIONS.map(option => ({
                        value: option.value,
                        label: option.label,
                        description: option.desc
                    }))}
                />
                <CustomSelect
                    ariaLabel="图片生成清晰度"
                    value={imageQuality}
                    onChange={value => changeImageQuality(value as ImageQuality)}
                    disabled={savingImageQuality || !!charBatch || !!sceneBatch || sceneBatchPreparing}
                    className="studio-reference-quality"
                    buttonClassName="studio-reference-select"
                    options={IMAGE_QUALITY_OPTIONS.map(option => ({
                        value: option.value,
                        label: `${option.label} · ${getImageResolutionLabel(imageProvider, option.value)}`,
                        description: `${option.desc} · ${getImageResolutionDetail(imageProvider, option.value)}`
                    }))}
                />
            </>
        )
    }

    async function addCharacter() {
        if (!charForm.name.trim()) return
        try {
            const response = await clientFetch('/api/characters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...charForm, name: charForm.name.trim(), projectId: id })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '添加角色失败')
            if (json.data?.name !== charForm.name.trim()) throw new Error('添加角色失败：服务端未保存完整内容')
            setShowAddChar(false)
            setCharForm({ name: '', role: '', age: '', gender: '', appearancePrompt: '', personality: '' })
            await fetchProject()
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '添加角色失败' })
        }
    }

    async function addScene() {
        if (!sceneForm.name.trim()) return
        try {
            const response = await clientFetch('/api/scenes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...sceneForm, name: sceneForm.name.trim(), projectId: id })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '添加场景失败')
            if (json.data?.name !== sceneForm.name.trim()) throw new Error('添加场景失败：服务端未保存完整内容')
            setShowAddScene(false)
            setSceneForm({ name: '', description: '', locationPrompt: '', timeOfDay: '' })
            await fetchProject()
        } catch (error) {
            setAiMsg({ type: 'error', text: error instanceof Error ? error.message : '添加场景失败' })
        }
    }

    if (!project || project.id !== id)
        return (
            <div className="app-page relative flex min-h-screen items-center justify-center text-gray-500">
                <HomeLogoLink className="absolute start-4 top-3" />
                {t('加载中...')}
            </div>
        )

    const episodesCount = project.episodes?.length ?? project.totalEpisodes
    const chapterProgress = getChapterProgress(project.episodes)
    const projectStageIdx = stageIndexValue(project.novelStage)
    // The persisted stage advances after the first chapter succeeds. A complete
    // outline must already allow navigation to the page that starts that work.
    const canOpenChapterDrafting = project.totalEpisodes > 0 && getMissingChapterOutlineNumbers(project.episodes, project.totalEpisodes).length === 0
    const sidebarNavButtonClass = sidebarCollapsed ? 'h-10 justify-center px-0' : 'gap-3 px-3 py-2.5'
    const missingCharacterIdentityRefCount = project.characters.reduce((sum, character) => sum + missingCharacterIdentityRoleCount(character), 0)
    const regeneratableCharacterIdentityRefCount = project.characters.reduce((sum, character) => sum + (character.appearancePrompt?.trim() ? productionCharacterIdentityRoles().length : 0), 0)
    const regeneratableSceneRefCount = project.scenes.filter(scene => scene.locationPrompt?.trim()).length
    const visibleCharacterBatchFailureCount = charBatch?.failed ?? lastCharacterBatchFailures.length
    const storyboardCount = project.episodes.filter(episode => episode._count.storyboards > 0).length
    const mergedCount = project.episodes.filter(episode => episode.hasMergedVideo).length
    const productionEpisode = project.episodes.find(episode => episode._count.storyboards > 0 && !episode.hasMergedVideo) ?? project.episodes.find(episode => episode.hasScript) ?? project.episodes[0]
    const productionHref = productionEpisode ? `/projects/${id}/episodes/${productionEpisode.id}` : projectTabHref(id, 'episodes')
    const projectArtwork = project.scenes.find(scene => scene.referenceImageUrl)?.referenceImageUrl ?? project.characters.find(character => character.referenceImageUrl)?.referenceImageUrl
    const promptEditorCharacter = promptEditor?.kind === 'character' ? project.characters.find(character => character.id === promptEditor.id) : undefined
    const promptEditorScene = promptEditor?.kind === 'scene' ? project.scenes.find(scene => scene.id === promptEditor.id) : undefined
    const referencePreviewUrl = referencePreview?.urls[referencePreview.index] ?? null
    const referencePreviewScene = referencePreview?.kind === 'scene' ? project.scenes.find(scene => scene.id === referencePreview.targetId) : undefined
    const referencePreviewCharacter = referencePreview?.kind === 'character' ? project.characters.find(character => character.id === referencePreview.targetId) : undefined
    const referencePreviewSceneSelections = referencePreviewScene ? getSelectedSceneReferenceUrls(referencePreviewScene.referenceAssets, referencePreviewScene.referenceImageUrl) : []
    const referencePreviewSelected =
        referencePreview?.kind === 'scene'
            ? Boolean(referencePreviewUrl && referencePreviewSceneSelections.includes(referencePreviewUrl))
            : referencePreview?.kind === 'character'
              ? Boolean(referencePreviewUrl && referencePreviewCharacter && selectedCharacterRoleAsset(referencePreviewCharacter, referencePreview.role)?.url === referencePreviewUrl)
              : false
    const referencePreviewSelectionFull = referencePreviewSceneSelections.length >= MAX_SELECTED_SCENE_REFERENCES
    const referencePreviewSelectionBusy =
        referencePreview?.kind === 'scene' && referencePreviewUrl
            ? savingSceneReferenceFor.has(referenceCandidateKey('scenes', referencePreview.targetId, referencePreviewUrl))
            : referencePreview?.kind === 'character'
              ? savingCharacterReferenceFor.has(referencePreview.targetId)
              : false
    const journeyStage: CreationStage =
        activeTab === 'novel'
            ? novelStageView === 'finalized'
                ? 'extract'
                : novelStageView === 'drafting'
                  ? 'script'
                  : 'outline'
            : activeTab === 'characters' || activeTab === 'scenes'
              ? 'extract'
              : 'storyboard'
    const stageLink = (stage: string) => ({
        href: `/projects/${id}?tab=novel&stage=${stage}`,
        onClick: () => {
            setActiveTab('novel')
            setNovelStageViewState(stage)
        }
    })

    return (
        <div className="studio-workspace h-dvh flex overflow-hidden text-sm">
            {/* 左侧导航栏 */}
            <aside className={`flex-shrink-0 border-e border-gray-800 bg-gray-950 flex flex-col transition-[width] duration-200 ease-out ${sidebarCollapsed ? 'w-16' : 'w-60'}`}>
                {/* 项目头 */}
                <div className={`${sidebarCollapsed ? 'px-2 py-3' : 'px-4 py-3'} border-b border-gray-800`}>
                    <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-1' : 'justify-between gap-2 mb-2'}`}>
                        <HomeLogoLink
                            compact
                            showName={!sidebarCollapsed}
                            nameClassName="truncate text-sm"
                        />
                        <div className={`flex items-center gap-1 ${sidebarCollapsed ? 'flex-col' : ''}`}>
                            <button
                                type="button"
                                onClick={toggleSidebar}
                                aria-label={sidebarCollapsed ? '展开主导航' : '收起主导航'}
                                title={sidebarCollapsed ? '展开主导航' : '收起主导航'}
                                className="h-8 w-8 flex-shrink-0 rounded-md border border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-gray-900 hover:text-gray-200 transition-colors flex items-center justify-center">
                                {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {!sidebarCollapsed && (
                        <Link
                            href="/projects"
                            className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-300">
                            <ArrowLeft className="h-3.5 w-3.5 flex-shrink-0 rtl:rotate-180" /> 全部项目
                        </Link>
                    )}

                    {sidebarCollapsed ? (
                        <Link
                            href="/projects"
                            title="全部项目"
                            aria-label="全部项目"
                            className="mt-2 flex h-10 w-full items-center justify-center rounded-md text-gray-500 hover:bg-gray-900 hover:text-gray-200 transition-colors">
                            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                        </Link>
                    ) : (
                        <>
                            {editingProjectTitle ? (
                                <form
                                    className="flex min-w-0 items-center gap-1"
                                    onSubmit={event => {
                                        event.preventDefault()
                                        void saveProjectTitle()
                                    }}>
                                    <input
                                        data-i18n-skip
                                        autoFocus
                                        aria-label="项目名称"
                                        value={projectTitleDraft}
                                        maxLength={255}
                                        disabled={savingProjectTitle}
                                        onChange={event => setProjectTitleDraft(event.target.value)}
                                        onKeyDown={event => {
                                            if (event.key === 'Escape') cancelEditingProjectTitle()
                                        }}
                                        className="h-8 min-w-0 flex-1 rounded-md border border-purple-400/50 bg-gray-900 px-2 text-[15px] font-semibold text-white outline-none focus:border-purple-300 disabled:opacity-60"
                                    />
                                    <button
                                        type="submit"
                                        disabled={savingProjectTitle || !projectTitleDraft.trim()}
                                        aria-label="保存项目名称"
                                        title="保存"
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-green-400 transition-colors hover:bg-green-500/10 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-40">
                                        {savingProjectTitle ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={cancelEditingProjectTitle}
                                        disabled={savingProjectTitle}
                                        aria-label="取消修改项目名称"
                                        title="取消"
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40">
                                        <X className="h-4 w-4" />
                                    </button>
                                </form>
                            ) : (
                                <div className="group flex min-w-0 items-center gap-1">
                                    <h1
                                        data-i18n-skip
                                        className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white"
                                        title={project.title}>
                                        {project.title}
                                    </h1>
                                    <button
                                        type="button"
                                        onClick={startEditingProjectTitle}
                                        aria-label="修改项目名称"
                                        title="修改项目名称"
                                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-600 opacity-70 transition hover:bg-gray-800 hover:text-purple-300 focus-visible:opacity-100 group-hover:opacity-100">
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1">
                                {project.genre && <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">{t(project.genre)}</span>}
                                <span className="text-[10px] text-gray-500">
                                    {episodesCount} {t('集')}
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* 导航：小说 + 子阶段 + 集数 + 角色 + 场景 */}
                <nav className="flex-1 overflow-y-auto novel-scroll p-2 text-[13px]">
                    {/* 小说分组 */}
                    <Link
                        href={projectTabHref(id, 'novel')}
                        prefetch={false}
                        onNavigate={event => {
                            event.preventDefault()
                            navigateToProjectTab('novel')
                        }}
                        title={sidebarCollapsed ? '小说' : undefined}
                        className={`w-full flex items-center rounded-md transition-colors ${sidebarNavButtonClass} ${
                            activeTab === 'novel' ? 'bg-gray-800/70 text-white' : 'text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'
                        }`}>
                        <BookOpen className="w-4 h-4 flex-shrink-0" />
                        {!sidebarCollapsed && (
                            <>
                                <span className="flex-1 text-start font-medium">小说</span>
                                <span className="text-[10px] text-gray-500">
                                    {chapterProgress.generated}/{chapterProgress.total} {t('已生成')}
                                </span>
                            </>
                        )}
                    </Link>
                    {!sidebarCollapsed && activeTab === 'novel' && (
                        <div className="ms-3 border-s border-gray-800 ps-2 mt-1 mb-2 space-y-0.5">
                            {STAGES.map((s, i) => {
                                const reachable = projectStageIdx >= i || (s.key === 'drafting' && canOpenChapterDrafting)
                                const isCurrent = novelStageView === s.key
                                const isDone = projectStageIdx > i
                                return (
                                    <button
                                        key={s.key}
                                        type="button"
                                        onClick={() => {
                                            if (reachable) navigateToNovelStage(s.key)
                                        }}
                                        disabled={!reachable}
                                        aria-current={isCurrent ? 'step' : undefined}
                                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] transition-colors ${
                                            isCurrent ? 'bg-purple-500/15 text-purple-300' : reachable ? 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200' : 'text-gray-600 cursor-not-allowed'
                                        }`}>
                                        <span
                                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                                                isCurrent
                                                    ? 'bg-purple-500 text-white'
                                                    : isDone
                                                      ? 'bg-green-900/40 text-green-400'
                                                      : reachable
                                                        ? 'bg-gray-800 text-gray-300'
                                                        : 'bg-gray-800 text-gray-600'
                                            }`}>
                                            {isDone ? <Check className="w-2.5 h-2.5" /> : i + 1}
                                        </span>
                                        <span className="truncate">{t(s.label).replace(/^\d+\.\s*/, '')}</span>
                                    </button>
                                )
                            })}
                        </div>
                    )}

                    {/* 其他 tab */}
                    {[
                        { key: 'episodes', label: '集数', icon: Film, count: episodesCount },
                        { key: 'characters', label: '角色', icon: Users, count: project.characters.length },
                        { key: 'scenes', label: '场景', icon: MapPin, count: project.scenes.length }
                    ].map(({ key, label, icon: Icon, count }) => (
                        <Link
                            key={key}
                            href={projectTabHref(id, key as ProjectTab)}
                            prefetch={false}
                            onNavigate={event => {
                                event.preventDefault()
                                navigateToProjectTab(key as ProjectTab)
                            }}
                            title={sidebarCollapsed ? label : undefined}
                            className={`w-full flex items-center rounded-md transition-colors mt-0.5 ${sidebarNavButtonClass} ${
                                activeTab === key ? 'bg-gray-800/70 text-white' : 'text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'
                            }`}>
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            {!sidebarCollapsed && (
                                <>
                                    <span className="flex-1 text-start font-medium">{label}</span>
                                    <span className="text-[10px] text-gray-500">{count}</span>
                                </>
                            )}
                        </Link>
                    ))}

                    <Link
                        href={projectTabHref(id, 'insights')}
                        prefetch={false}
                        onNavigate={event => {
                            event.preventDefault()
                            navigateToProjectTab('insights')
                        }}
                        title={sidebarCollapsed ? '生产数据与质检' : undefined}
                        className={`mt-1 w-full flex items-center rounded-md transition-colors ${sidebarNavButtonClass} ${
                            activeTab === 'insights' ? 'bg-gray-800/70 text-white' : 'text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'
                        }`}>
                        <BarChart3 className="w-4 h-4 flex-shrink-0" />
                        {!sidebarCollapsed && <span className="flex-1 text-start font-medium">生产数据与质检</span>}
                    </Link>
                    <Link
                        href={`/projects/${id}/publication`}
                        title={t('发布作品')}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800/40 hover:text-gray-200">
                        <Globe className="h-4 w-4 shrink-0" />
                        {!sidebarCollapsed && <span>{t('发布作品')}</span>}
                    </Link>
                </nav>

                {/* aiMsg 已迁移到右上角 Toast（见 src/components/Toast.tsx） */}
            </aside>

            {/* 右侧主工作区 */}
            <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="studio-mobile-nav flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-4 py-3 text-xs text-slate-400 md:hidden">
                    <HomeLogoLink compact />
                    <Link
                        href="/projects"
                        className="me-auto flex items-center gap-1.5">
                        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                        全部项目
                    </Link>
                    <Link
                        href={`/projects/${id}/publication`}
                        aria-label={t('发布作品')}>
                        <Globe className="h-4 w-4" />
                    </Link>
                    <Link
                        href={projectTabHref(id, 'episodes')}
                        prefetch={false}
                        onNavigate={event => {
                            event.preventDefault()
                            navigateToProjectTab('episodes')
                        }}>
                        集数
                    </Link>
                    <Link
                        href={projectTabHref(id, 'characters')}
                        prefetch={false}
                        onNavigate={event => {
                            event.preventDefault()
                            navigateToProjectTab('characters')
                        }}>
                        角色
                    </Link>
                    <Link
                        href={projectTabHref(id, 'scenes')}
                        prefetch={false}
                        onNavigate={event => {
                            event.preventDefault()
                            navigateToProjectTab('scenes')
                        }}>
                        场景
                    </Link>
                    <Link
                        href={projectTabHref(id, 'insights')}
                        prefetch={false}
                        onNavigate={event => {
                            event.preventDefault()
                            navigateToProjectTab('insights')
                        }}
                        aria-label="生产数据与质检"
                        title="生产数据与质检">
                        <BarChart3 className="h-4 w-4" />
                    </Link>
                </div>
                <CreationJourney
                    current={journeyStage}
                    steps={{
                        outline: {
                            ...stageLink(projectStageIdx >= 1 ? 'outlined' : 'setup'),
                            detail: '冲突 · 伏笔 · 人物弧光',
                            completed: project.episodes.length > 0 && project.episodes.every(episode => !!episode.synopsis?.trim())
                        },
                        script: {
                            ...stageLink(projectStageIdx >= 2 ? 'drafting' : 'setup'),
                            detail: `${chapterProgress.generated} / ${chapterProgress.total} ${t('章')} · ${t('已生成')}`,
                            completed: chapterProgress.allFinalized
                        },
                        extract: {
                            ...stageLink(chapterProgress.allFinalized ? 'finalized' : projectStageIdx >= 2 ? 'drafting' : projectStageIdx >= 1 ? 'outlined' : 'setup'),
                            detail: `${project.characters.length} ${t('角色')} · ${project.scenes.length} ${t('场景')}`,
                            completed: project.characters.length > 0 || project.scenes.length > 0
                        },
                        storyboard: { href: productionHref, detail: `${storyboardCount} / ${episodesCount} ${t('集')}`, completed: episodesCount > 0 && storyboardCount === episodesCount },
                        video: { href: `${productionHref}#episode-finished`, detail: `${mergedCount} / ${episodesCount} ${t('集成片')}`, completed: episodesCount > 0 && mergedCount === episodesCount }
                    }}
                />
                {activeTab === 'insights' && <ProductionInsightsPanel projectId={id} />}

                {/* 小说 Tab */}
                {activeTab === 'novel' && (
                    <NovelTab
                        project={project}
                        onRefetch={async () => {
                            if (!(await fetchProject())) throw new Error('未能刷新项目状态，请刷新页面后重试')
                        }}
                        onMessage={setAiMsg}
                        onExtractCommitted={handleExtractCommitted}
                        onOpenCharacters={() => navigateToProjectTab('characters')}
                        novelStageView={novelStageView}
                        setNovelStageView={navigateToNovelStage}
                    />
                )}

                {/* 集数列表 */}
                {activeTab === 'episodes' && (
                    <div className="studio-project-content flex-1 overflow-y-auto novel-scroll">
                        <section className="studio-project-hero">
                            <div className="studio-project-hero-copy">
                                <h2 data-i18n-skip>{project.title}</h2>
                                <p
                                    className="mt-1.5 line-clamp-1 text-sm leading-5 text-slate-400"
                                    data-i18n-skip>
                                    {project.description || t('选择一集，完成分镜、画面与视频制作。')}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                                        {project.genre && <span className="rounded-md bg-purple-400/10 px-2 py-1 text-purple-200">{t(project.genre)}</span>}
                                        <span>
                                            {episodesCount} {t('集')} · {project.characters.length} {t('角色')} · {project.scenes.length} {t('场景')}
                                        </span>
                                    </div>
                                    <Link
                                        href={project.episodes.length ? productionHref : `/projects/${id}?tab=novel&stage=setup`}
                                        className="studio-primary">
                                        <Clapperboard className="h-4 w-4" />
                                        继续创作
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Link>
                                </div>
                            </div>
                            <div
                                className="studio-project-art"
                                aria-hidden="true">
                                {projectArtwork ? (
                                    <OptimizedMediaImage
                                        src={projectArtwork}
                                        alt=""
                                        fill
                                        sizes="(max-width: 767px) 1px, 200px"
                                        quality={78}
                                        loading="eager"
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="flex h-full items-center justify-center">
                                        <Clapperboard
                                            className="h-28 w-28 -rotate-12 text-purple-300/20"
                                            strokeWidth={0.6}
                                        />
                                    </div>
                                )}
                            </div>
                        </section>
                        <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-white">
                                集数 <span className="ms-1.5 font-normal tabular-nums text-slate-500">{episodesCount}</span>
                            </h3>
                            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                                {t('成片')}{' '}
                                <span className="tabular-nums text-purple-300">
                                    {mergedCount} / {episodesCount}
                                </span>
                            </span>
                        </div>
                        {project.episodes.length === 0 && (
                            <div className="studio-panel rounded-2xl px-6 py-12 text-center">
                                <BookOpen className="mx-auto mb-4 h-8 w-8 text-purple-300" />
                                <p className="text-lg text-slate-200">从故事大纲开始</p>
                                <p className="mt-2 text-sm text-slate-500">建立人物目标与剧情走向后，各集会显示在这里。</p>
                                <button
                                    type="button"
                                    onClick={() => navigateToNovelStage('setup')}
                                    className="studio-primary mt-5">
                                    创作故事大纲
                                </button>
                            </div>
                        )}
                        {project.episodes.length > 0 && (
                            <div className="studio-episode-grid">
                                {project.episodes.map(ep => {
                                    const status = EPISODE_STATUS[ep.status] ?? { label: ep.status, color: 'text-gray-400' }
                                    return (
                                        <Link
                                            key={ep.id}
                                            href={`/projects/${id}/episodes/${ep.id}`}
                                            className="studio-episode-card group">
                                            <span className="studio-episode-number">{String(ep.episodeNumber).padStart(2, '0')}</span>
                                            <div className="min-w-0">
                                                <h4
                                                    data-i18n-skip
                                                    className="truncate text-sm font-semibold leading-5 text-white">
                                                    {ep.title ?? t('第{number}集', { number: ep.episodeNumber })}
                                                </h4>
                                                <p
                                                    data-i18n-skip
                                                    className="mt-0.5 line-clamp-1 text-xs leading-5 text-slate-400">
                                                    {ep.synopsis || t('从故事大纲开始，逐步完成角色、场景、分镜与成片。')}
                                                </p>
                                            </div>
                                            <div className="studio-episode-meta">
                                                <span className={`studio-episode-status ${status.color}`}>
                                                    <span className="h-1 w-1 rounded-full bg-current" />
                                                    {status.label}
                                                </span>
                                                <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                                                    {ep._count.storyboards} {t('个分镜')}
                                                </span>
                                                <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-purple-300" />
                                            </div>
                                        </Link>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* 角色列表 */}
                {activeTab === 'characters' && (
                    <div className="flex-1 overflow-y-auto novel-scroll px-4 py-4 sm:px-6">
                        <ReferenceLibraryHeader
                            title="角色"
                            count={project.characters.length}
                            backLabel="上一步：拆剧本 / 提取"
                            onBack={openNovelFinalizeStep}
                            settings={renderImageProviderSwitcher()}
                            progress={charBatch}
                            progressResolution={getImageResolutionLabel(imageProvider, 'ultra')}>
                            <button
                                type="button"
                                onClick={() => setShowAddChar(true)}
                                className="studio-secondary text-xs">
                                <Plus className="h-3.5 w-3.5" />
                                添加角色
                            </button>
                            {regeneratableCharacterIdentityRefCount > 0 && (
                                <button
                                    type="button"

                                    onClick={() => generateAllCharRefs('all')}
                                    aria-busy={charBatch?.mode === 'all'}
                                    disabled={characterBatchRestoring || generatingRefFor.size > 0 || savingCharacterReferenceFor.size > 0 || !!charBatch || !!sceneBatch}
                                    className="studio-secondary text-xs disabled:cursor-not-allowed disabled:opacity-50">
                                    <RefreshCw className={`h-3.5 w-3.5 ${charBatch?.mode === 'all' ? 'animate-spin' : ''}`} />
                                    {t('全部重新生成候选')} ({regeneratableCharacterIdentityRefCount})
                                </button>
                            )}
                            {(missingCharacterIdentityRefCount > 0 || charBatch) && (
                                <button
                                    type="button"

                                    onClick={() => generateAllCharRefs('missing')}
                                    aria-busy={!!charBatch}
                                    disabled={characterBatchRestoring || generatingRefFor.size > 0 || !!charBatch}
                                    className={`${charBatch ? 'studio-secondary' : 'studio-primary'} text-xs disabled:cursor-not-allowed disabled:opacity-50`}>
                                    {charBatch ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                    {charBatch ? t('生成中...') : `${t('生成角色图')} (${missingCharacterIdentityRefCount})`}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => navigateToProjectTab('scenes')}
                                className={`${missingCharacterIdentityRefCount > 0 || charBatch ? 'studio-secondary' : 'studio-primary'} text-xs`}>
                                {t('下一步：场景')}
                                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
                            </button>
                        </ReferenceLibraryHeader>
                        {!charBatch && visibleCharacterBatchFailureCount > 0 && (
                            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span>上次批量生成失败 {visibleCharacterBatchFailureCount} 个，可在对应角色卡重试</span>
                            </div>
                        )}
                        <div className="studio-reference-grid studio-character-grid">
                            {project.characters.map(char => {
                                const promptValue = getCharacterPromptValue(char)
                                const promptBusy = savingCharacterPromptFor.has(char.id)
                                return (
                                    <div
                                        key={char.id}
                                        className="studio-character-card">
                                        <div className="studio-character-card-header">
                                            <div className="studio-character-card-info">
                                                <h3
                                                    data-i18n-skip
                                                    title={char.name}
                                                    className="studio-character-card-name">
                                                    {char.name}
                                                </h3>
                                                {(char.role || char.gender || char.age) && (
                                                    <div className="studio-character-card-meta">
                                                        {char.role && (
                                                            <span
                                                                title={t(char.role)}
                                                                className="studio-character-card-role">
                                                                {t(char.role)}
                                                            </span>
                                                        )}
                                                        {char.gender && <span title={t(char.gender)}>{t(char.gender)}</span>}
                                                        {char.age && (
                                                            <span title={`${t('年龄')}: ${char.age}`}>
                                                                {t('年龄')}: {char.age}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => openCharacterPromptEditor(char)}
                                                disabled={promptBusy}
                                                aria-label={`${t('角色')} Prompt · ${char.name}`}
                                                title="编辑角色 Prompt"
                                                className={`studio-character-card-edit ${promptValue.trim() ? '' : 'is-incomplete'}`}>
                                                {promptBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                                            </button>
                                        </div>
                                        <div className="min-w-0">
                                            {!promptValue.trim() && (
                                                <button
                                                    type="button"
                                                    onClick={() => openCharacterPromptEditor(char)}
                                                    className="mb-3 flex w-full items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-950/60 px-3 py-2 text-start text-xs text-amber-200 hover:bg-amber-950">
                                                    <Sparkles className="w-3 h-3" />
                                                    缺少外貌描述，会影响角色一致性
                                                </button>
                                            )}
                                            <div className="grid w-full grid-cols-2 gap-2">
                                                {CHARACTER_IDENTITY_REFERENCE_ROLES.map(referenceRole => {
                                                    const assets = characterRoleAssets(char, referenceRole.role)
                                                        .filter(asset => !hiddenReferenceCandidateKeys.has(referenceCandidateKey('characters', char.id, asset.url, referenceRole.role)))
                                                        .sort((left, right) => (left.status === right.status ? 0 : left.status === 'selected' ? -1 : 1))
                                                    const generationKey = characterReferenceGenerationKey(char.id, referenceRole.role)
                                                    const generating = generatingRefFor.has(generationKey)
                                                    const generationProgress = characterGenerationProgress[generationKey]
                                                    const generationError = characterGenerationErrors[generationKey]
                                                    const retryBatchFailure = Boolean(generationError)
                                                    const generationActionLabel = retryBatchFailure ? t('重新生成') : t('生成 5 画面候选图')
                                                    const selectionSaving = savingCharacterReferenceFor.has(char.id)
                                                    const previewUrls = assets.map(asset => asset.url)
                                                    return (
                                                        <div
                                                            key={referenceRole.role}
                                                            className="col-span-2 min-w-0">
                                                            {assets.length > 0 ? (
                                                                <div className={`grid w-full gap-1.5 ${assets.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                                                    {assets.map(asset => {
                                                                        const selected = asset.status === 'selected'
                                                                        const layout = characterTurnaroundLayout(asset.promptVersion)
                                                                        const layoutLabel = layout === 'legacy' ? t('旧版设定板') : layout === 'compact' ? t('5 画面设定板') : referenceRole.shortLabel
                                                                        return (
                                                                            <div
                                                                                key={asset.id}
                                                                                aria-busy={selected && selectionSaving}
                                                                                data-selected={selected}
                                                                                className="studio-character-sheet">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                        setReferencePreview({
                                                                                            kind: 'character',
                                                                                            targetId: char.id,
                                                                                            role: referenceRole.role,
                                                                                            title: `${char.name} · ${referenceRole.label}`,
                                                                                            urls: previewUrls,
                                                                                            index: previewUrls.indexOf(asset.url)
                                                                                        })
                                                                                    }
                                                                                    className="studio-character-sheet-preview"
                                                                                    aria-label={`${char.name} · ${layoutLabel} · ${t('预览大图')}`}
                                                                                    title={layout === 'legacy' ? t('旧图不会自动改变；重新生成后可选用五画面版本。') : t('预览大图')}>
                                                                                    <ReferenceThumbnail
                                                                                        src={asset.url}
                                                                                        alt={`${char.name} ${referenceRole.label}`}
                                                                                        sizes={assets.length > 1 ? 'auto, 160px' : 'auto, 320px'}
                                                                                        className="h-full w-full object-contain"
                                                                                    />
                                                                                </button>
                                                                                <div className="studio-character-sheet-toolbar">
                                                                                    {selected ? (
                                                                                        <>
                                                                                            <span
                                                                                                className={`studio-character-sheet-status ${layout === 'legacy' ? 'is-legacy' : ''}`}
                                                                                                title={selectionSaving ? t('保存中...') : `${layoutLabel} · ${t('形象已确认')}`}
                                                                                                aria-label={selectionSaving ? t('保存中...') : t('形象已确认')}
                                                                                                aria-live="polite">
                                                                                                {selectionSaving ? (
                                                                                                    <RefreshCw className="h-3 w-3 shrink-0 animate-spin" />
                                                                                                ) : (
                                                                                                    <Check className="h-3 w-3 shrink-0" />
                                                                                                )}
                                                                                            </span>
                                                                                            <button
                                                                                                type="button"

                                                                                                onClick={() => generateCharRefFromCard(char, referenceRole.role, true)}
                                                                                                disabled={
                                                                                                    characterBatchRestoring ||
                                                                                                    selectionSaving ||
                                                                                                    generating ||
                                                                                                    promptBusy ||
                                                                                                    !promptValue.trim() ||
                                                                                                    (!!charBatch && !retryBatchFailure)
                                                                                                }
                                                                                                aria-label={generationActionLabel}
                                                                                                title={generationActionLabel}
                                                                                                className="studio-character-sheet-action disabled:cursor-not-allowed disabled:opacity-40">
                                                                                                <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
                                                                                            </button>
                                                                                        </>
                                                                                    ) : (
                                                                                        <>
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => selectCharRef(char.id, asset.url, referenceRole.role)}
                                                                                                disabled={selectionSaving}
                                                                                                aria-label={t('确认形象')}
                                                                                                title={t('确认形象')}
                                                                                                className="studio-character-sheet-select disabled:cursor-wait disabled:opacity-40">
                                                                                                <Check className="h-3 w-3 shrink-0" />
                                                                                                <span className="truncate">{t('确认形象')}</span>
                                                                                            </button>
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => deleteRefCandidate('characters', char.id, asset.url, referenceRole.role)}
                                                                                                disabled={selectionSaving}
                                                                                                aria-label={t('删除候选图')}
                                                                                                title={t('删除候选图')}
                                                                                                className="studio-character-sheet-action is-destructive disabled:cursor-wait disabled:opacity-40">
                                                                                                <Trash2 className="h-3.5 w-3.5" />
                                                                                            </button>
                                                                                        </>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    type="button"

                                                                    onClick={() => generateCharRefFromCard(char, referenceRole.role, retryBatchFailure)}
                                                                    disabled={characterBatchRestoring || generating || promptBusy || !promptValue.trim() || (!!charBatch && !retryBatchFailure)}
                                                                    aria-busy={generating}
                                                                    aria-label={generationActionLabel}
                                                                    title={generationActionLabel}
                                                                    className="studio-character-sheet-empty">
                                                                    <span className="studio-character-sheet-empty-icon">
                                                                        {generating || retryBatchFailure ? (
                                                                            <RefreshCw className={`h-5 w-5 ${generating ? 'animate-spin' : ''}`} />
                                                                        ) : (
                                                                            <ImageIcon className="h-5 w-5" />
                                                                        )}
                                                                    </span>
                                                                    <span>{generating ? referenceRole.shortLabel : generationActionLabel}</span>
                                                                    {generating && <span className="text-xs font-normal text-purple-200">{referenceProgressLabel(generationProgress, t)}</span>}
                                                                </button>
                                                            )}
                                                            {!generating && generationError && (
                                                                <div
                                                                    title={`生成失败：${generationError}`}
                                                                    className="mt-2 break-words text-xs leading-5 text-red-300">
                                                                    生成失败：{generationError}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                            {project.characters.length === 0 && (
                                <div className="py-12 text-center text-gray-500 sm:col-span-full">
                                    <Users className="w-10 h-10 mx-auto mb-2 text-gray-700" />
                                    还没有角色，点击上方按钮添加
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 场景列表 */}
                {activeTab === 'scenes' && (
                    <div className="flex-1 overflow-y-auto novel-scroll px-4 py-4 sm:px-6">
                        <ReferenceLibraryHeader
                            title="场景"
                            count={project.scenes.length}
                            backLabel="上一步：角色图片编辑"
                            onBack={() => navigateToProjectTab('characters')}
                            settings={renderImageProviderSwitcher()}
                            progress={sceneBatch}
                            progressResolution={sceneBatch ? getImageResolutionLabel(imageProvider, sceneBatch.quality) : undefined}>
                            <button
                                type="button"
                                onClick={() => setShowAddScene(true)}
                                className="studio-secondary text-xs">
                                <Plus className="h-3.5 w-3.5" />
                                添加场景
                            </button>
                            {regeneratableSceneRefCount > 0 && (
                                <button
                                    type="button"

                                    onClick={() => generateAllSceneRefs('all')}
                                    aria-busy={sceneBatch?.mode === 'all' || sceneBatchPreparingMode === 'all'}
                                    disabled={sceneBatchRestoring || generatingSceneRefFor.size > 0 || !!sceneBatch || !!charBatch || sceneBatchPreparing}
                                    className="studio-secondary text-xs disabled:cursor-not-allowed disabled:opacity-50">
                                    <RefreshCw className={`h-3.5 w-3.5 ${sceneBatch?.mode === 'all' || sceneBatchPreparingMode === 'all' ? 'animate-spin' : ''}`} />
                                    {sceneBatchPreparingMode === 'all' ? t('准备中...') : `${t('全部重新生成候选')} (${regeneratableSceneRefCount})`}
                                </button>
                            )}
                            {(project.scenes.some(scene => !scene.referenceImageUrl && scene.locationPrompt) || sceneBatch) && (
                                <button
                                    type="button"

                                    onClick={() => generateAllSceneRefs('missing')}
                                    aria-busy={sceneBatch?.mode === 'missing' || sceneBatchPreparingMode === 'missing'}
                                    disabled={sceneBatchRestoring || generatingSceneRefFor.size > 0 || !!sceneBatch || sceneBatchPreparing}
                                    className={`${sceneBatch?.mode === 'missing' || sceneBatchPreparingMode === 'missing' ? 'studio-secondary' : 'studio-primary'} text-xs disabled:cursor-not-allowed disabled:opacity-50`}>
                                    {sceneBatch?.mode === 'missing' || sceneBatchPreparingMode === 'missing' ? (
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Sparkles className="h-3.5 w-3.5" />
                                    )}
                                    {sceneBatchPreparingMode === 'missing' ? t('准备中...') : sceneBatch?.mode === 'missing' ? t('生成中...') : t('生成场景图')}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={openFirstEpisodeForStoryboard}
                                className={`${project.scenes.some(scene => !scene.referenceImageUrl && scene.locationPrompt) || sceneBatch ? 'studio-secondary' : 'studio-primary'} text-xs`}>
                                {t('下一步：分镜')}
                                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
                            </button>
                        </ReferenceLibraryHeader>
                        <div className="studio-reference-grid">
                            {project.scenes.map(scene => {
                                const selectedReferenceUrls = getSelectedSceneReferenceUrls(scene.referenceAssets, scene.referenceImageUrl)
                                const primarySceneReference = scene.referenceImageUrl ?? selectedReferenceUrls[0] ?? null
                                const candidates = Array.from(
                                    new Set([primarySceneReference, ...selectedReferenceUrls, ...parseReferenceCandidates(scene.referenceCandidates)].filter(Boolean) as string[])
                                ).filter(url => !hiddenReferenceCandidateKeys.has(referenceCandidateKey('scenes', scene.id, url)))
                                const referenceSelectionFull = selectedReferenceUrls.length >= MAX_SELECTED_SCENE_REFERENCES
                                const promptValue = getScenePromptValue(scene)
                                const promptDirty = promptValue !== (scene.locationPrompt ?? '')
                                const promptBusy = savingScenePromptFor.has(scene.id)
                                const descriptionExpanded = expandedSceneDescriptionIds.has(scene.id)
                                return (
                                    <div
                                        key={scene.id}
                                        className="rounded-xl border border-gray-800 bg-gray-900 p-3">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <h3
                                                data-i18n-skip
                                                className="min-w-0 flex-1 truncate font-medium text-white">
                                                {scene.name}
                                            </h3>
                                            <div className="flex shrink-0 items-center gap-1">
                                                {scene.description && (
                                                    <button
                                                        type="button"
                                                        aria-expanded={descriptionExpanded}
                                                        aria-label={descriptionExpanded ? t('收起') : t('展开')}
                                                        title={descriptionExpanded ? t('收起') : t('展开')}
                                                        onClick={() =>
                                                            setExpandedSceneDescriptionIds(prev => {
                                                                const next = new Set(prev)
                                                                if (next.has(scene.id)) next.delete(scene.id)
                                                                else next.add(scene.id)
                                                                return next
                                                            })
                                                        }
                                                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-700 bg-gray-950/40 text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200">
                                                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${descriptionExpanded ? 'rotate-90' : ''}`} />
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => openScenePromptEditor(scene)}
                                                    disabled={promptBusy}
                                                    aria-label={`${t('场景')} Prompt · ${scene.name}`}
                                                    title="编辑场景 Prompt"
                                                    className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait disabled:opacity-50 ${promptValue.trim() ? 'border-gray-700 bg-gray-950/40 text-gray-400 hover:border-purple-400/50 hover:text-purple-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'}`}>
                                                    {promptBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                                                </button>
                                            </div>
                                        </div>
                                        {scene.description && (
                                            <p
                                                data-i18n-skip
                                                className={`mt-1 text-start cursor-text select-text text-sm text-gray-400 ${descriptionExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                                                {scene.description}
                                            </p>
                                        )}
                                        {!promptValue.trim() && (
                                            <button
                                                type="button"
                                                onClick={() => openScenePromptEditor(scene)}
                                                className="mt-3 flex w-full items-center gap-1 rounded bg-yellow-500/10 px-2 py-1 text-start text-xs text-yellow-500 hover:bg-yellow-500/15">
                                                <Sparkles className="w-3 h-3" />
                                                缺少场景视觉描述，无法生成参考图
                                            </button>
                                        )}
                                        {candidates.length > 0 && (
                                            <div className="mt-3">
                                                <div className="grid w-full gap-2">
                                                    {candidates.map(url => {
                                                        const selectedIndex = selectedReferenceUrls.indexOf(url)
                                                        const selected = selectedIndex >= 0
                                                        const selectionBusy = savingSceneReferenceFor.has(referenceCandidateKey('scenes', scene.id, url))
                                                        return (
                                                            <div
                                                                key={url}
                                                                className="w-full min-w-0">
                                                                <div className="relative aspect-video w-full">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            setReferencePreview({
                                                                                kind: 'scene',
                                                                                targetId: scene.id,
                                                                                title: `${scene.name} 候选场景`,
                                                                                urls: candidates,
                                                                                index: candidates.indexOf(url)
                                                                            })
                                                                        }
                                                                        className={`relative h-full w-full overflow-hidden rounded-lg border bg-black ${selected ? 'border-purple-400' : 'border-gray-800 hover:border-gray-600'}`}
                                                                        title="预览大图">
                                                                        <ReferenceThumbnail
                                                                            src={url}
                                                                            alt={`${scene.name} 候选场景`}
                                                                            sizes="auto, 256px"
                                                                            className="h-full w-full object-cover"
                                                                        />
                                                                        {selected && (
                                                                            <span className="absolute bottom-0 left-0 right-0 bg-purple-600/90 py-0.5 text-[10px] text-white">
                                                                                已选视角 {selectedIndex + 1}
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                    {!selected && (
                                                                        <button
                                                                            type="button"
                                                                            disabled={selectionBusy}
                                                                            onClick={event => {
                                                                                event.stopPropagation()
                                                                                deleteRefCandidate('scenes', scene.id, url)
                                                                            }}
                                                                            title="删除候选图"
                                                                            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white shadow hover:bg-red-600 transition-colors disabled:cursor-wait disabled:opacity-50">
                                                                            <X className="h-4 w-4" />
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setSceneRefSelection(scene.id, url, selected)}
                                                                        disabled={(!selected && referenceSelectionFull) || selectionBusy}
                                                                        aria-busy={selectionBusy}
                                                                        aria-label={selected ? t('移出参考组') : referenceSelectionFull ? t('已选满 4 张') : t('加入参考组')}
                                                                        title={selected ? t('移出参考组') : referenceSelectionFull ? t('已选满 4 张') : t('加入参考组')}
                                                                        className={`absolute bottom-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border text-white shadow-lg backdrop-blur-sm transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                                                                            selected
                                                                                ? 'border-purple-300/50 bg-purple-600/95 hover:bg-purple-500'
                                                                                : 'border-white/20 bg-black/75 hover:border-purple-300/60 hover:bg-purple-600/90'
                                                                        }`}>
                                                                        {selectionBusy ? (
                                                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                                                        ) : selected ? (
                                                                            <CircleMinus className="h-4 w-4" />
                                                                        ) : (
                                                                            <CirclePlus className="h-4 w-4" />
                                                                        )}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {promptValue.trim() && (
                                            <button
                                                onClick={() => generateSceneRefFromCard(scene)}
                                                disabled={sceneBatchRestoring || sceneBatchPreparing || !!sceneBatch || generatingSceneRefFor.has(scene.id) || promptBusy}
                                                className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
                                                {generatingSceneRefFor.has(scene.id) ? (
                                                    <>
                                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {referenceProgressLabel(sceneGenerationProgress[scene.id], t)}
                                                    </>
                                                ) : promptDirty ? (
                                                    <>
                                                        <ImageIcon className="w-3.5 h-3.5" /> 保存并生成候选
                                                    </>
                                                ) : candidates.length > 0 ? (
                                                    <>
                                                        <RefreshCw className="w-3.5 h-3.5" /> 再生成一张候选
                                                    </>
                                                ) : (
                                                    <>
                                                        <ImageIcon className="w-3.5 h-3.5" /> 生成候选图
                                                    </>
                                                )}
                                            </button>
                                        )}
                                        {sceneGenerationErrors[scene.id] && (
                                            <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-5 text-red-200 break-words">
                                                生成失败：{sceneGenerationErrors[scene.id]}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                            {project.scenes.length === 0 && (
                                <div className="py-12 text-center text-gray-500 sm:col-span-full">
                                    <MapPin className="w-10 h-10 mx-auto mb-2 text-gray-700" />
                                    还没有场景
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>

            {promptEditorCharacter && (
                <ReferencePromptDialog
                    key={`character-${promptEditorCharacter.id}`}
                    kindLabel={t('角色')}
                    name={promptEditorCharacter.name}
                    initialValue={getCharacterPromptValue(promptEditorCharacter)}
                    savedValue={promptEditorCharacter.appearancePrompt ?? ''}
                    saving={savingCharacterPromptFor.has(promptEditorCharacter.id)}
                    referenceImageUrl={promptEditorCharacter.referenceImageUrl}
                    hasReferences={Boolean(
                        promptEditorCharacter.referenceImageUrl ||
                        parseReferenceCandidates(promptEditorCharacter.referenceCandidates).length ||
                        promptEditorCharacter.referenceAssetRows?.some(asset => asset.status === 'selected' || asset.status === 'candidate')
                    )}
                    placeholder="可中文/英文：发型、脸型、服装、颜色材质、体型轮廓、身份气质。"
                    onClose={closePromptEditor}
                    onSave={savePromptEditor}
                    onAiAction={runPromptAiAction}
                />
            )}

            {promptEditorScene && (
                <ReferencePromptDialog
                    key={`scene-${promptEditorScene.id}`}
                    kindLabel={t('场景')}
                    name={promptEditorScene.name}
                    initialValue={getScenePromptValue(promptEditorScene)}
                    savedValue={promptEditorScene.locationPrompt ?? ''}
                    saving={savingScenePromptFor.has(promptEditorScene.id)}
                    referenceImageUrl={promptEditorScene.referenceImageUrl}
                    hasReferences={Boolean(
                        promptEditorScene.referenceImageUrl ||
                        parseReferenceCandidates(promptEditorScene.referenceCandidates).length ||
                        getSelectedSceneReferenceUrls(promptEditorScene.referenceAssets, promptEditorScene.referenceImageUrl).length
                    )}
                    placeholder="可中文/英文：空间布局、时间氛围、灯光、材质、核心道具、镜头视角。"
                    onClose={closePromptEditor}
                    onSave={savePromptEditor}
                    onAiAction={runPromptAiAction}
                />
            )}

            {referencePreview && referencePreviewUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6"
                    onClick={() => setReferencePreview(null)}>
                    <div className="relative flex h-full w-full min-h-0 min-w-0 flex-col">
                        <button
                            type="button"
                            aria-label="关闭图片预览"
                            onClick={() => setReferencePreview(null)}
                            className="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gray-900/90 text-gray-300 hover:bg-gray-800 hover:text-white">
                            <X className="h-4 w-4" />
                        </button>
                        {referencePreview.urls.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    aria-label={t('上一张')}
                                    title={t('上一张')}
                                    onClick={event => {
                                        event.stopPropagation()
                                        moveReferencePreview(-1)
                                    }}
                                    className="absolute left-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-gray-950/75 text-white shadow-xl backdrop-blur-sm transition-colors hover:bg-purple-600/90 sm:left-3">
                                    <ChevronLeft className="h-6 w-6" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={t('下一张')}
                                    title={t('下一张')}
                                    onClick={event => {
                                        event.stopPropagation()
                                        moveReferencePreview(1)
                                    }}
                                    className="absolute right-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-gray-950/75 text-white shadow-xl backdrop-blur-sm transition-colors hover:bg-purple-600/90 sm:right-3">
                                    <ChevronRight className="h-6 w-6" />
                                </button>
                            </>
                        )}
                        <div
                            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
                            onClick={event => event.stopPropagation()}>
                            <OptimizedMediaImage
                                src={referencePreviewUrl}
                                alt={referencePreview.title}
                                fill
                                sizes="(max-width: 1024px) 100vw, 1024px"
                                quality={85}
                                loading="eager"
                                className="object-contain"
                            />
                        </div>
                        <div
                            className="absolute bottom-2 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-gray-950/85 p-1.5 pl-3 text-xs text-gray-200 shadow-xl backdrop-blur-md"
                            onClick={event => event.stopPropagation()}>
                            <span className="shrink-0 tabular-nums">
                                {referencePreview.index + 1} / {referencePreview.urls.length}
                            </span>
                            {referencePreview.kind === 'scene' ? (
                                <button
                                    type="button"
                                    onClick={() => setSceneRefSelection(referencePreview.targetId, referencePreviewUrl, referencePreviewSelected)}
                                    disabled={referencePreviewSelectionBusy || (!referencePreviewSelected && referencePreviewSelectionFull)}
                                    aria-busy={referencePreviewSelectionBusy}
                                    className="flex min-w-0 items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500">
                                    {referencePreviewSelectionBusy ? (
                                        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
                                    ) : referencePreviewSelected ? (
                                        <CircleMinus className="h-4 w-4 shrink-0" />
                                    ) : (
                                        <CirclePlus className="h-4 w-4 shrink-0" />
                                    )}
                                    <span className="truncate">{referencePreviewSelected ? t('移出参考组') : referencePreviewSelectionFull ? t('已选满 4 张') : t('加入参考组')}</span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => selectCharRef(referencePreview.targetId, referencePreviewUrl, referencePreview.role)}
                                    disabled={referencePreviewSelectionBusy || referencePreviewSelected}
                                    aria-busy={referencePreviewSelectionBusy}
                                    className="flex min-w-0 items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-400">
                                    {referencePreviewSelectionBusy ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Check className="h-4 w-4 shrink-0" />}
                                    <span className="truncate">{referencePreviewSelected ? t('形象已确认') : t('确认形象')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 添加角色弹窗 */}
            {showAddChar && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <h2 className="text-white text-lg font-semibold mb-5">添加角色</h2>
                        <div className="space-y-3">
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400 block mb-1">角色名 *</label>
                                    <input
                                        type="text"
                                        value={charForm.name}
                                        onChange={e => setCharForm({ ...charForm, name: e.target.value })}
                                        placeholder="如：林晓薇"
                                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                                    />
                                </div>
                                <div className="w-28">
                                    <label className="text-xs text-gray-400 block mb-1">定位</label>
                                    <CustomSelect
                                        ariaLabel="角色定位"
                                        value={charForm.role}
                                        onChange={role => setCharForm({ ...charForm, role })}
                                        options={[
                                            { value: '', label: '选择' },
                                            { value: '主角', label: '主角' },
                                            { value: '配角', label: '配角' },
                                            { value: '反派', label: '反派' }
                                        ]}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400 block mb-1">性别</label>
                                    <CustomSelect
                                        ariaLabel="角色性别"
                                        value={charForm.gender}
                                        onChange={gender => setCharForm({ ...charForm, gender })}
                                        options={[
                                            { value: '', label: '选择' },
                                            { value: '女', label: '女' },
                                            { value: '男', label: '男' }
                                        ]}
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400 block mb-1">年龄</label>
                                    <input
                                        type="text"
                                        value={charForm.age}
                                        onChange={e => setCharForm({ ...charForm, age: e.target.value })}
                                        placeholder="25"
                                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">
                                    外貌视觉描述<span className="text-yellow-500 ms-1">★ 影响所有镜头一致性</span>
                                </label>
                                <textarea
                                    value={charForm.appearancePrompt}
                                    onChange={e => setCharForm({ ...charForm, appearancePrompt: e.target.value })}
                                    placeholder="可中文/英文：发型、脸型、服装颜色材质、体型轮廓、身份气质"
                                    rows={3}
                                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 resize-none font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">性格描述</label>
                                <input
                                    type="text"
                                    value={charForm.personality}
                                    onChange={e => setCharForm({ ...charForm, personality: e.target.value })}
                                    placeholder="温柔坚强、独立自主"
                                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowAddChar(false)}
                                className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors">
                                取消
                            </button>
                            <button
                                onClick={addCharacter}
                                disabled={!charForm.name.trim()}
                                className="flex-1 py-2 text-sm studio-primary disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
                                添加
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 添加场景弹窗 */}
            {showAddScene && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
                        <h2 className="text-white text-lg font-semibold mb-5">添加场景</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">场景名 *</label>
                                <input
                                    type="text"
                                    value={sceneForm.name}
                                    onChange={e => setSceneForm({ ...sceneForm, name: e.target.value })}
                                    placeholder="如：咖啡厅"
                                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">描述</label>
                                <input
                                    type="text"
                                    value={sceneForm.description}
                                    onChange={e => setSceneForm({ ...sceneForm, description: e.target.value })}
                                    placeholder="简单描述"
                                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">场景视觉描述</label>
                                <textarea
                                    value={sceneForm.locationPrompt}
                                    onChange={e => setSceneForm({ ...sceneForm, locationPrompt: e.target.value })}
                                    placeholder="可中文/英文：空间布局、主要道具、墙地颜色、光线方向、氛围"
                                    rows={2}
                                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 resize-none font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">时段</label>
                                <CustomSelect
                                    ariaLabel="场景时段"
                                    value={sceneForm.timeOfDay}
                                    onChange={timeOfDay => setSceneForm({ ...sceneForm, timeOfDay })}
                                    options={[
                                        { value: '', label: '不限' },
                                        { value: 'day', label: '白天' },
                                        { value: 'night', label: '夜晚' },
                                        { value: 'dusk', label: '黄昏' },
                                        { value: 'dawn', label: '清晨' }
                                    ]}
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setShowAddScene(false)}
                                className="flex-1 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors">
                                取消
                            </button>
                            <button
                                onClick={addScene}
                                disabled={!sceneForm.name.trim()}
                                className="flex-1 py-2 text-sm studio-primary disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
                                添加
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {confirmDialog}
        </div>
    )
}
