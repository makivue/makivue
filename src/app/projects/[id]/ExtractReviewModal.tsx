'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, RefreshCw, Users, MapPin, CheckCircle2, Trash2, AlertCircle, Sparkles } from 'lucide-react'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getPollingDelay } from '@/lib/polling'
import { useI18n } from '@/i18n/I18nProvider'
import CustomSelect from '@/components/CustomSelect'
import { useConfirmDialog } from '@/components/ConfirmDialog'

type Phase = 'analyzing' | 'merging' | 'done' | 'error'

interface ExtractedChar {
    itemId: string
    name: string
    aliases?: string[]
    role?: string
    gender?: string
    age?: string
    appearancePrompt: string
    personality?: string
    frequency: number
    chunkFrequency: number
    mentionCount: number
    episodeCount: number
}
interface ExtractedSceneT {
    itemId: string
    name: string
    aliases?: string[]
    description?: string
    locationPrompt: string
    timeOfDay?: string
    frequency: number
    chunkFrequency: number
    mentionCount: number
    episodeCount: number
}

interface EditableChar extends ExtractedChar {
    _selected: boolean
    _mode: 'add' | 'merge' | 'overwrite' | 'ignore'
}
interface EditableScene extends ExtractedSceneT {
    _selected: boolean
    _mode: 'add' | 'merge' | 'overwrite' | 'ignore'
}

interface Props {
    projectId: string
    initialJobId?: string | null
    existingCharacters?: Array<Partial<ExtractedChar>>
    existingScenes?: Array<Partial<ExtractedSceneT>>
    onJobIdChange?: (jobId: string | null) => void
    onResetStarted?: () => void | Promise<void>
    onClose: () => void
    onCommitted: (newChars: number, newScenes: number, ids: { characterIds: string[]; sceneIds: string[]; replaceAll: boolean }) => void
    onError: (msg: string) => void
}

function extractJobStorageKey(projectId: string) {
    return `aigc:extract-job:${projectId}`
}

function extractResetStorageKey(projectId: string) {
    return `aigc:extract-reset:${projectId}`
}

const PHASE_LABEL: Record<Phase, string> = {
    analyzing: '分析剧本中',
    merging: '整理本次提取结果',
    done: '识别完成，请审核',
    error: '出错了'
}

function hasVisualPrompt(value: string | null | undefined): boolean {
    return !!value?.trim()
}

function normalizeExtractedChar(value: Partial<ExtractedChar>): ExtractedChar {
    return {
        itemId: typeof value.itemId === 'string' ? value.itemId : '',
        name: typeof value.name === 'string' ? value.name : '',
        aliases: Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
        role: typeof value.role === 'string' ? value.role : undefined,
        gender: typeof value.gender === 'string' ? value.gender : undefined,
        age: typeof value.age === 'string' ? value.age : undefined,
        appearancePrompt: typeof value.appearancePrompt === 'string' ? value.appearancePrompt : '',
        personality: typeof value.personality === 'string' ? value.personality : undefined,
        frequency: typeof value.frequency === 'number' && Number.isFinite(value.frequency) ? value.frequency : 1,
        chunkFrequency: typeof value.chunkFrequency === 'number' ? value.chunkFrequency : typeof value.frequency === 'number' ? value.frequency : 1,
        mentionCount: typeof value.mentionCount === 'number' ? value.mentionCount : typeof value.frequency === 'number' ? value.frequency : 1,
        episodeCount: typeof value.episodeCount === 'number' ? value.episodeCount : 1
    }
}

function normalizeExtractedScene(value: Partial<ExtractedSceneT>): ExtractedSceneT {
    return {
        itemId: typeof value.itemId === 'string' ? value.itemId : '',
        name: typeof value.name === 'string' ? value.name : '',
        aliases: Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
        description: typeof value.description === 'string' ? value.description : undefined,
        locationPrompt: typeof value.locationPrompt === 'string' ? value.locationPrompt : '',
        timeOfDay: typeof value.timeOfDay === 'string' ? value.timeOfDay : undefined,
        frequency: typeof value.frequency === 'number' && Number.isFinite(value.frequency) ? value.frequency : 1,
        chunkFrequency: typeof value.chunkFrequency === 'number' ? value.chunkFrequency : typeof value.frequency === 'number' ? value.frequency : 1,
        mentionCount: typeof value.mentionCount === 'number' ? value.mentionCount : typeof value.frequency === 'number' ? value.frequency : 1,
        episodeCount: typeof value.episodeCount === 'number' ? value.episodeCount : 1
    }
}

export default function ExtractReviewModal({ projectId, initialJobId = null, existingCharacters = [], existingScenes = [], onJobIdChange, onResetStarted, onClose, onCommitted, onError }: Props) {
    const { t } = useI18n()
    const { confirm, confirmDialog } = useConfirmDialog()
    const hasExistingEntities = existingCharacters.length > 0 || existingScenes.length > 0
    const restoredJobId = initialJobId ?? (typeof window !== 'undefined' ? window.localStorage.getItem(extractJobStorageKey(projectId)) : null)
    const [viewingExisting, setViewingExisting] = useState(hasExistingEntities && !restoredJobId)
    const [jobId, setJobId] = useState<string | null>(restoredJobId)
    const [phase, setPhase] = useState<Phase>(hasExistingEntities && !restoredJobId ? 'done' : 'analyzing')
    const [chunksDone, setChunksDone] = useState(0)
    const [chunksTotal, setChunksTotal] = useState(0)
    const [checkpointAvailable, setCheckpointAvailable] = useState(false)
    const [progressDelayed, setProgressDelayed] = useState(false)
    const [resumeFromJobId, setResumeFromJobId] = useState<string | null>(null)
    const [err, setErr] = useState<string | null>(null)
    const [chars, setChars] = useState<EditableChar[]>(() => existingCharacters.map(raw => ({ ...normalizeExtractedChar(raw), _selected: false, _mode: 'ignore' })))
    const [scenes, setScenes] = useState<EditableScene[]>(() => existingScenes.map(raw => ({ ...normalizeExtractedScene(raw), _selected: false, _mode: 'ignore' })))
    const [committing, setCommitting] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [replaceAllOnCommit, setReplaceAllOnCommit] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(extractResetStorageKey(projectId)) === '1')
    const [tab, setTab] = useState<'characters' | 'scenes'>('characters')

    const rememberJobId = useCallback(
        (nextJobId: string | null) => {
            setJobId(nextJobId)
            onJobIdChange?.(nextJobId)
            if (nextJobId) window.localStorage.setItem(extractJobStorageKey(projectId), nextJobId)
            else window.localStorage.removeItem(extractJobStorageKey(projectId))
        },
        [onJobIdChange, projectId]
    )

    // 启动任务
    useEffect(() => {
        if (viewingExisting || jobId) return
        let cancelled = false
        ;(async () => {
            try {
                const res = await clientFetch('/api/ai/extract/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId, resumeFromJobId })
                })
                const json = await readApiJson(res)
                if (!json.success) throw new Error(json.error)
                if (!cancelled) {
                    rememberJobId(String(json.data.jobId))
                    setResumeFromJobId(null)
                }
            } catch (e) {
                if (cancelled) return
                setPhase('error')
                setErr(e instanceof Error ? e.message : String(e))
            }
        })()
        return () => {
            cancelled = true
        }
    }, [jobId, projectId, rememberJobId, resumeFromJobId, viewingExisting])

    // 轮询状态
    useEffect(() => {
        if (!jobId) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let consecutiveFailures = 0
        const poll = async () => {
            try {
                const res = await clientFetch(`/api/ai/extract/status/${jobId}`)
                const json = await readApiJson(res)
                if (!json.success) throw new Error(json.error)
                if (cancelled) return
                const d = json.data
                setPhase(d.phase)
                setChunksDone(d.chunksDone)
                setChunksTotal(d.chunksTotal)
                setCheckpointAvailable(d.checkpointAvailable === true)
                setProgressDelayed((d.phase === 'analyzing' || d.phase === 'merging') && typeof d.updatedAt === 'number' && Date.now() - d.updatedAt > 2 * 60 * 1000)
                if (d.error) setErr(d.error)
                consecutiveFailures = 0
                if (d.phase === 'done' && d.result) {
                    const resultChars = Array.isArray(d.result.characters) ? d.result.characters : []
                    const resultScenes = Array.isArray(d.result.scenes) ? d.result.scenes : []
                    setChars(
                        resultChars.map((raw: Partial<ExtractedChar>) => {
                            const c = normalizeExtractedChar(raw)
                            const exists = existingCharacters.some(existing => existing.name?.trim().toLocaleLowerCase() === c.name.trim().toLocaleLowerCase())
                            return {
                                ...c,
                                _selected: !!c.name.trim() && (c.mentionCount >= 2 || c.episodeCount >= 2 || c.role === '主角') && hasVisualPrompt(c.appearancePrompt),
                                _mode: replaceAllOnCommit ? 'add' : exists ? 'merge' : 'add'
                            }
                        })
                    )
                    setScenes(
                        resultScenes.map((raw: Partial<ExtractedSceneT>) => {
                            const s = normalizeExtractedScene(raw)
                            const exists = existingScenes.some(existing => existing.name?.trim().toLocaleLowerCase() === s.name.trim().toLocaleLowerCase())
                            return {
                                ...s,
                                _selected: !!s.name.trim() && (s.mentionCount >= 2 || s.episodeCount >= 2) && hasVisualPrompt(s.locationPrompt),
                                _mode: replaceAllOnCommit ? 'add' : exists ? 'merge' : 'add'
                            }
                        })
                    )
                } else if (d.phase !== 'error') {
                    timer = setTimeout(poll, getPollingDelay({ baseMs: 6_000, failureCount: consecutiveFailures }))
                }
            } catch (e) {
                if (cancelled) return
                setErr(e instanceof Error ? e.message : String(e))
                // A transient status outage must not terminate a durable
                // extraction job. Back off before trying again.
                consecutiveFailures += 1
                timer = setTimeout(poll, getPollingDelay({ baseMs: 6_000, failureCount: consecutiveFailures }))
            }
        }
        poll()
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }, [existingCharacters, existingScenes, jobId, replaceAllOnCommit])

    const selectedCharCount = useMemo(() => chars.filter(c => c._selected).length, [chars])
    const selectedSceneCount = useMemo(() => scenes.filter(s => s._selected).length, [scenes])
    const replacingCharacters = useMemo(() => chars.some(c => c._selected && c._mode === 'overwrite'), [chars])
    const replacingScenes = useMemo(() => scenes.some(s => s._selected && s._mode === 'overwrite'), [scenes])
    const replacementWarning =
        replacingCharacters && replacingScenes
            ? t('覆盖将以本次勾选结果替换旧角色和旧场景，移除未保留的旧数据并清空旧候选图。')
            : replacingCharacters
              ? t('覆盖将以本次勾选结果替换旧角色，移除未保留的旧数据并清空旧候选图。')
              : replacingScenes
                ? t('覆盖将以本次勾选结果替换旧场景，移除未保留的旧数据并清空旧候选图。')
                : null

    async function requestClose() {
        if (!viewingExisting && phase === 'done' && (chars.length > 0 || scenes.length > 0) && !committing) {
            const ok = await confirm({
                title: t('放弃本次提取？'),
                message: t('本次识别结果尚未入库，关闭后将无法进入角色图片编辑。'),
                confirmText: t('放弃提取'),
                tone: 'warning'
            })
            if (!ok) return
            rememberJobId(null)
            window.localStorage.removeItem(extractResetStorageKey(projectId))
            onClose()
            return
        }
        if (phase === 'error') {
            rememberJobId(null)
            window.localStorage.removeItem(extractResetStorageKey(projectId))
        } else if (jobId) onJobIdChange?.(jobId)
        onClose()
    }

    async function restartExtraction() {
        const ok = await confirm({
            title: t('清空并重新提取角色、场景？'),
            message: t('确认后会立即删除现有角色、场景及其全部参考图，页面会马上清空，然后从剧本重新提取。此操作无法撤销。'),
            confirmText: t('清空并重新提取'),
            tone: 'danger'
        })
        if (!ok) return
        setResetting(true)
        try {
            const response = await clientFetch(`/api/projects/${projectId}/extracted-entities`, { method: 'DELETE' })
            const json = await readApiJson(response)
            if (!json.success) throw new Error(json.error)
            setReplaceAllOnCommit(true)
            window.localStorage.setItem(extractResetStorageKey(projectId), '1')
            setViewingExisting(false)
            setResumeFromJobId(null)
            rememberJobId(null)
            setPhase('analyzing')
            setChunksDone(0)
            setChunksTotal(0)
            setCheckpointAvailable(false)
            setProgressDelayed(false)
            setErr(null)
            setChars([])
            setScenes([])
            setTab('characters')
            await onResetStarted?.()
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error))
        } finally {
            setResetting(false)
        }
    }

    async function commit() {
        const toSendChars = chars.filter(c => c._selected && (c.name ?? '').trim())
        const toSendScenes = scenes.filter(s => s._selected && (s.name ?? '').trim())
        if (toSendChars.length === 0 && toSendScenes.length === 0) {
            onError('没有选中任何条目')
            return
        }
        const missingPromptChars = toSendChars.filter(c => !hasVisualPrompt(c.appearancePrompt))
        const missingPromptScenes = toSendScenes.filter(s => !hasVisualPrompt(s.locationPrompt))
        if (missingPromptChars.length > 0 || missingPromptScenes.length > 0) {
            onError(
                [
                    missingPromptChars.length ? t('有 {count} 个已选角色缺少视觉描述', { count: missingPromptChars.length }) : null,
                    missingPromptScenes.length ? t('有 {count} 个已选场景缺少视觉描述', { count: missingPromptScenes.length }) : null,
                    t('请先补一句描述，或取消勾选后再入库。')
                ]
                    .filter(Boolean)
                    .join('\n')
            )
            return
        }
        if (!replaceAllOnCommit && (replacingCharacters || replacingScenes)) {
            const message =
                replacingCharacters && replacingScenes
                    ? t('确认覆盖旧角色和旧场景？未被本次勾选结果保留的旧数据和旧候选图将被移除。')
                    : replacingCharacters
                      ? t('确认覆盖旧角色？未被本次勾选结果保留的旧数据和旧候选图将被移除。')
                      : t('确认覆盖旧场景？未被本次勾选结果保留的旧数据和旧候选图将被移除。')
            const ok = await confirm({ title: t('确认覆盖已有数据？'), message, confirmText: t('确认覆盖'), tone: 'warning' })
            if (!ok) return
        }
        setCommitting(true)
        try {
            const res = await clientFetch('/api/ai/extract/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    jobId,
                    replaceAll: replaceAllOnCommit,
                    characters: toSendChars.map(c => ({
                        itemId: c.itemId,
                        mode: replaceAllOnCommit ? 'add' : c._mode,
                        name: c.name,
                        aliases: c.aliases,
                        role: c.role,
                        gender: c.gender,
                        age: c.age,
                        appearancePrompt: c.appearancePrompt,
                        personality: c.personality
                    })),
                    scenes: toSendScenes.map(s => ({
                        itemId: s.itemId,
                        mode: replaceAllOnCommit ? 'add' : s._mode,
                        name: s.name,
                        aliases: s.aliases,
                        description: s.description,
                        locationPrompt: s.locationPrompt,
                        timeOfDay: s.timeOfDay
                    }))
                })
            })
            const json = await readApiJson(res)
            if (!json.success) throw new Error(json.error)
            rememberJobId(null)
            window.localStorage.removeItem(extractResetStorageKey(projectId))
            onCommitted(json.data.newCharacters, json.data.newScenes, {
                characterIds: Array.isArray(json.data.newCharacterIds) ? json.data.newCharacterIds : [],
                sceneIds: Array.isArray(json.data.newSceneIds) ? json.data.newSceneIds : [],
                replaceAll: replaceAllOnCommit
            })
        } catch (e) {
            onError(e instanceof Error ? e.message : String(e))
        } finally {
            setCommitting(false)
        }
    }

    const progressPct = chunksTotal > 0 ? Math.round((chunksDone / chunksTotal) * 100) : 0
    const isDone = phase === 'done'
    const isError = phase === 'error'

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
                {/* 头 */}
                <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-white font-semibold text-base">提取角色与场景</h2>
                        <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                            {phase !== 'done' && phase !== 'error' && <RefreshCw className="w-3 h-3 animate-spin" />}
                            {viewingExisting ? (
                                <span>已入库角色与场景</span>
                            ) : isError ? (
                                <span className="text-red-400 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {PHASE_LABEL[phase]}
                                </span>
                            ) : (
                                <span>{PHASE_LABEL[phase]}</span>
                            )}
                            {(phase === 'analyzing' || phase === 'merging') && chunksTotal > 0 && (
                                <span className="text-gray-500">
                                    · 分析进度 {chunksDone}/{chunksTotal}
                                </span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={requestClose}
                        className="text-gray-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 进度条 */}
                {!isDone && !isError && (
                    <div className="h-1 bg-gray-800">
                        <div
                            className="progress-flow h-full bg-gradient-to-r from-purple-500 to-pink-500"
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                )}

                {/* 内容 */}
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {isError && (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                            <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
                            <p className="text-red-400 font-medium mb-2">提取失败</p>
                            <p className="text-xs text-gray-400 max-w-md">{err}</p>
                            <div className="mt-4 flex items-center gap-2">
                                <button
                                    onClick={restartExtraction}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg">
                                    {checkpointAvailable ? t('从 {completed}/{total} 继续提取', { completed: chunksDone, total: chunksTotal }) : t('重新提取')}
                                </button>
                                <button
                                    onClick={requestClose}
                                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg">
                                    关闭
                                </button>
                            </div>
                        </div>
                    )}

                    {!isDone && !isError && (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                            <RefreshCw className="w-12 h-12 text-purple-500 mb-4 animate-spin" />
                            <p className="text-white font-medium mb-2">{PHASE_LABEL[phase]}</p>
                            {phase === 'analyzing' && chunksTotal > 0 && (
                                <p className="text-xs text-gray-400">
                                    已分析 {chunksDone}/{chunksTotal} 批，约 {progressPct}%...
                                </p>
                            )}
                            {phase === 'merging' && <p className="text-xs text-gray-400">正在将本次剧本各批次的识别结果去重整理...</p>}
                            {replaceAllOnCommit && <p className="mt-2 text-xs text-emerald-400">旧角色、场景及参考图已清空，本次结果将全新入库。</p>}
                            {chunksTotal === 0 && <p className="text-xs text-gray-400">正在启动任务...</p>}
                            {progressDelayed && (
                                <p className="mt-3 rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                                    当前批次长时间没有更新，系统正在检测后台任务；确认中断后会保留检查点并显示继续按钮，最长约 6 分钟。
                                </p>
                            )}
                            <p className="mt-3 text-[11px] text-gray-500">关闭弹窗不会停止后台任务；再次打开会继续显示当前进度。</p>
                        </div>
                    )}

                    {isDone && (
                        <>
                            {/* Tab */}
                            <div className="border-b border-gray-800 px-6 flex gap-6 flex-shrink-0">
                                <button
                                    onClick={() => setTab('characters')}
                                    className={`flex items-center gap-2 py-3 text-sm border-b-2 transition-colors ${
                                        tab === 'characters' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                                    }`}>
                                    <Users className="w-4 h-4" />
                                    角色 ({chars.length})<span className="text-[10px] text-gray-500">· 已选 {selectedCharCount}</span>
                                </button>
                                <button
                                    onClick={() => setTab('scenes')}
                                    className={`flex items-center gap-2 py-3 text-sm border-b-2 transition-colors ${
                                        tab === 'scenes' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                                    }`}>
                                    <MapPin className="w-4 h-4" />
                                    场景 ({scenes.length})<span className="text-[10px] text-gray-500">· 已选 {selectedSceneCount}</span>
                                </button>
                                {!viewingExisting && (
                                    <div className="ms-auto flex items-center gap-2 text-xs">
                                        {tab === 'characters' ? (
                                            <>
                                                <button
                                                    onClick={() => setChars(cs => cs.map(c => ({ ...c, _selected: true })))}
                                                    className="text-gray-400 hover:text-white">
                                                    全选
                                                </button>
                                                <span className="text-gray-700">|</span>
                                                <button
                                                    onClick={() => setChars(cs => cs.map(c => ({ ...c, _selected: false })))}
                                                    className="text-gray-400 hover:text-white">
                                                    全不选
                                                </button>
                                                <span className="text-gray-700">|</span>
                                                <button
                                                    onClick={() => setChars(cs => cs.map(c => ({ ...c, _selected: c.mentionCount >= 2 && hasVisualPrompt(c.appearancePrompt) })))}
                                                    className="text-gray-400 hover:text-white">
                                                    仅选提及≥2次且完整
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => setScenes(ss => ss.map(s => ({ ...s, _selected: true })))}
                                                    className="text-gray-400 hover:text-white">
                                                    全选
                                                </button>
                                                <span className="text-gray-700">|</span>
                                                <button
                                                    onClick={() => setScenes(ss => ss.map(s => ({ ...s, _selected: false })))}
                                                    className="text-gray-400 hover:text-white">
                                                    全不选
                                                </button>
                                                <span className="text-gray-700">|</span>
                                                <button
                                                    onClick={() => setScenes(ss => ss.map(s => ({ ...s, _selected: s.mentionCount >= 2 && hasVisualPrompt(s.locationPrompt) })))}
                                                    className="text-gray-400 hover:text-white">
                                                    仅选提及≥2次且完整
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 列表 */}
                            <div className="flex-1 min-h-0 overflow-y-auto novel-scroll p-4">
                                <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs leading-relaxed text-blue-100/80">
                                    <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-300" />
                                    <span>
                                        {viewingExisting
                                            ? '这里展示的是已经入库的数据，不会再次分析剧本。需要重新识别时，请点击底部“重新提取”。'
                                            : '外貌/场景 Prompt 已由 AI 按项目视觉风格起草。你可以直接保留，也可以用中文或英文微调；英文对多数图像模型的一致性更稳，中文适合补充服饰、身份、道具等专有细节。'}
                                    </span>
                                </div>
                                {viewingExisting ? (
                                    <div className="space-y-2">
                                        {(tab === 'characters' ? chars : scenes).length === 0 && <p className="text-gray-500 text-sm text-center py-12">暂无数据</p>}
                                        {(tab === 'characters' ? chars : scenes).map((item, index) => {
                                            const prompt = 'appearancePrompt' in item ? item.appearancePrompt : item.locationPrompt
                                            return (
                                                <div
                                                    key={`${item.name}-${index}`}
                                                    className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                                                    <div className="text-sm font-medium text-white">{item.name || '未命名'}</div>
                                                    {prompt && <div className="mt-1 text-xs leading-relaxed text-gray-400">{prompt}</div>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : tab === 'characters' ? (
                                    <div className="space-y-2">
                                        {chars.length === 0 && <p className="text-gray-500 text-sm text-center py-12">没有识别到角色</p>}
                                        {chars.map((c, i) => (
                                            <CharCard
                                                key={i}
                                                value={c}
                                                replaceAll={replaceAllOnCommit}
                                                onChange={patch => setChars(cs => cs.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                                                onDelete={() => setChars(cs => cs.filter((_, j) => j !== i))}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {scenes.length === 0 && <p className="text-gray-500 text-sm text-center py-12">没有识别到场景</p>}
                                        {scenes.map((s, i) => (
                                            <SceneCard
                                                key={i}
                                                value={s}
                                                replaceAll={replaceAllOnCommit}
                                                onChange={patch => setScenes(ss => ss.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                                                onDelete={() => setScenes(ss => ss.filter((_, j) => j !== i))}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* 底部 */}
                {isDone && (
                    <div className="px-6 py-3 border-t border-gray-800 flex items-center gap-3 flex-shrink-0">
                        {viewingExisting ? (
                            <>
                                <div className="flex-1 text-xs text-gray-400">
                                    当前已有 {chars.length} 个角色、{scenes.length} 个场景。
                                </div>
                                <button
                                    onClick={restartExtraction}
                                    disabled={resetting}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-sm rounded-lg">
                                    <RefreshCw className={`w-4 h-4 ${resetting ? 'animate-spin' : ''}`} />
                                    {resetting ? '正在清空...' : '重新提取'}
                                </button>
                                <button
                                    onClick={requestClose}
                                    className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg">
                                    关闭
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="flex-1 text-xs text-gray-400">
                                    {replaceAllOnCommit ? (
                                        <span className="text-amber-300">将彻底删除全部旧角色、旧场景及其参考图，再将本次结果全新入库并自动生成参考图。</span>
                                    ) : replacingCharacters || replacingScenes ? (
                                        <span className="text-amber-300">{replacementWarning}</span>
                                    ) : (
                                        <>
                                            将入库 <b className="text-purple-300">{selectedCharCount}</b> 个角色、<b className="text-purple-300">{selectedSceneCount}</b> 个场景；每条按“新增 / 合并 /
                                            忽略”执行。
                                        </>
                                    )}
                                </div>
                                <button
                                    onClick={requestClose}
                                    className="px-3 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-600">
                                    放弃本次提取
                                </button>
                                <button
                                    onClick={commit}
                                    disabled={committing || (selectedCharCount === 0 && selectedSceneCount === 0)}
                                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg">
                                    {committing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    {committing ? '入库中...' : `确认入库并进入角色图片编辑`}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
            {confirmDialog}
        </div>
    )
}

function CharCard({ value, replaceAll, onChange, onDelete }: { value: EditableChar; replaceAll: boolean; onChange: (patch: Partial<EditableChar>) => void; onDelete: () => void }) {
    return (
        <div className={`border rounded-lg p-3 ${value._selected ? 'border-purple-500/40 bg-purple-500/5' : 'border-gray-800 bg-gray-950/50'}`}>
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={value._selected}
                    onChange={e => onChange({ _selected: e.target.checked })}
                    className="mt-1 w-4 h-4 accent-purple-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            value={value.name}
                            onChange={e => onChange({ name: e.target.value })}
                            className="bg-transparent border-b border-gray-800 text-white font-medium focus:outline-none focus:border-purple-500 min-w-[120px]"
                        />
                        <span className="text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">
                            提及 {value.mentionCount} 次 · {value.episodeCount} 集 · {value.chunkFrequency} 块
                        </span>
                        {replaceAll ? (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">全新入库</span>
                        ) : (
                            <CustomSelect
                                ariaLabel="入库方式"
                                value={value._mode}
                                onChange={mode => onChange({ _mode: mode as EditableChar['_mode'], _selected: mode !== 'ignore' })}
                                className="w-24"
                                buttonClassName="bg-gray-950 py-1 text-xs"
                                options={[
                                    { value: 'add', label: '新增' },
                                    { value: 'merge', label: '合并' },
                                    { value: 'overwrite', label: '覆盖' },
                                    { value: 'ignore', label: '忽略' }
                                ]}
                            />
                        )}
                        {!hasVisualPrompt(value.appearancePrompt) && <span className="text-[10px] text-yellow-300 bg-yellow-500/10 px-1.5 py-0.5 rounded">缺视觉描述</span>}
                        <CustomSelect
                            ariaLabel="角色定位"
                            value={value.role ?? ''}
                            onChange={role => onChange({ role })}
                            className="w-24"
                            buttonClassName="bg-gray-950 py-1 text-xs"
                            options={[
                                { value: '', label: '定位' },
                                { value: '主角', label: '主角' },
                                { value: '配角', label: '配角' },
                                { value: '反派', label: '反派' }
                            ]}
                        />
                        <CustomSelect
                            ariaLabel="角色性别"
                            value={value.gender ?? ''}
                            onChange={gender => onChange({ gender })}
                            className="w-20"
                            buttonClassName="bg-gray-950 py-1 text-xs"
                            options={[
                                { value: '', label: '性别' },
                                { value: '女', label: '女' },
                                { value: '男', label: '男' }
                            ]}
                        />
                        <input
                            value={value.age ?? ''}
                            onChange={e => onChange({ age: e.target.value })}
                            placeholder="年龄"
                            className="bg-gray-950 border border-gray-800 text-xs text-gray-300 rounded px-2 py-0.5 w-16"
                        />
                    </div>
                    <textarea
                        value={value.appearancePrompt}
                        onChange={e => onChange({ appearancePrompt: e.target.value })}
                        rows={2}
                        placeholder="AI 生成的角色视觉描述，可中文/英文微调；建议保留发型、服装颜色、体型轮廓等一致性锚点"
                        className="w-full bg-gray-950 border border-gray-800 text-xs text-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:border-purple-500 resize-none novel-scroll"
                    />
                    {value.personality && (
                        <input
                            value={value.personality}
                            onChange={e => onChange({ personality: e.target.value })}
                            placeholder="性格描述"
                            className="w-full bg-gray-950 border border-gray-800 text-xs text-gray-400 rounded px-2 py-1 focus:outline-none focus:border-purple-500"
                        />
                    )}
                </div>
                <button
                    onClick={onDelete}
                    className="text-gray-600 hover:text-red-400 flex-shrink-0"
                    title="删除">
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}

function SceneCard({ value, replaceAll, onChange, onDelete }: { value: EditableScene; replaceAll: boolean; onChange: (patch: Partial<EditableScene>) => void; onDelete: () => void }) {
    return (
        <div className={`border rounded-lg p-3 ${value._selected ? 'border-purple-500/40 bg-purple-500/5' : 'border-gray-800 bg-gray-950/50'}`}>
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={value._selected}
                    onChange={e => onChange({ _selected: e.target.checked })}
                    className="mt-1 w-4 h-4 accent-purple-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            value={value.name}
                            onChange={e => onChange({ name: e.target.value })}
                            className="bg-transparent border-b border-gray-800 text-white font-medium focus:outline-none focus:border-purple-500 min-w-[120px]"
                        />
                        <span className="text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">
                            提及 {value.mentionCount} 次 · {value.episodeCount} 集 · {value.chunkFrequency} 块
                        </span>
                        {replaceAll ? (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">全新入库</span>
                        ) : (
                            <CustomSelect
                                ariaLabel="入库方式"
                                value={value._mode}
                                onChange={mode => onChange({ _mode: mode as EditableScene['_mode'], _selected: mode !== 'ignore' })}
                                className="w-24"
                                buttonClassName="bg-gray-950 py-1 text-xs"
                                options={[
                                    { value: 'add', label: '新增' },
                                    { value: 'merge', label: '合并' },
                                    { value: 'overwrite', label: '覆盖' },
                                    { value: 'ignore', label: '忽略' }
                                ]}
                            />
                        )}
                        {!hasVisualPrompt(value.locationPrompt) && <span className="text-[10px] text-yellow-300 bg-yellow-500/10 px-1.5 py-0.5 rounded">缺视觉描述</span>}
                        <CustomSelect
                            ariaLabel="场景时段"
                            value={value.timeOfDay ?? ''}
                            onChange={timeOfDay => onChange({ timeOfDay })}
                            className="w-24"
                            buttonClassName="bg-gray-950 py-1 text-xs"
                            options={[
                                { value: '', label: '时段' },
                                { value: 'day', label: '白天' },
                                { value: 'night', label: '夜晚' },
                                { value: 'dusk', label: '黄昏' },
                                { value: 'dawn', label: '清晨' }
                            ]}
                        />
                    </div>
                    <textarea
                        value={value.locationPrompt}
                        onChange={e => onChange({ locationPrompt: e.target.value })}
                        rows={2}
                        placeholder="AI 生成的场景视觉描述，可中文/英文微调；建议保留布局、主要道具、墙地颜色、光线方向"
                        className="w-full bg-gray-950 border border-gray-800 text-xs text-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:border-purple-500 resize-none novel-scroll"
                    />
                    {value.description && (
                        <input
                            value={value.description}
                            onChange={e => onChange({ description: e.target.value })}
                            placeholder="中文描述"
                            className="w-full bg-gray-950 border border-gray-800 text-xs text-gray-400 rounded px-2 py-1 focus:outline-none focus:border-purple-500"
                        />
                    )}
                </div>
                <button
                    onClick={onDelete}
                    className="text-gray-600 hover:text-red-400 flex-shrink-0"
                    title="删除">
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
