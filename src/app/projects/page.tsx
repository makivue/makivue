'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link, { useRouter } from '@/i18n/navigation'
import { ArrowRight, Film, Plus, Trash2, Clapperboard, Upload, Loader2, FileText, Users, Sparkles } from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getPollingDelay } from '@/lib/polling'
import AuthBar from '@/components/AuthBar'
import BrandLogo from '@/components/BrandLogo'
import HomeLogoLink from '@/components/HomeLogoLink'
import SiteFooter from '@/components/SiteFooter'
import SiteHeader from '@/components/SiteHeader'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import { SITE_NAME } from '@/lib/seo'
import WalletBalance from '@/components/WalletBalance'
import { isLoggedIn, onAuthChange } from '@/lib/auth'
import { useI18n } from '@/i18n/I18nProvider'
import CustomSelect from '@/components/CustomSelect'
import { DEFAULT_FORM, ORDERED_VISUAL_STYLE_PRESETS, getCreationStyleGroupLabel, normalizeStyleForCreation } from '@/lib/drama-creation'

interface Project {
    id: string
    title: string
    description: string | null
    genre: string | null
    totalEpisodes: number
    completedEpisodes?: number
    coverUrl: string | null
    visibility: string
    status: string
    createdAt: string
    _count: { episodes: number; characters: number }
}

interface ProjectImportResult {
    stage: string
    totalEpisodes: number
    totalStoryboards: number
    detectedTitle?: string
    detectedGenre?: string
    projectId: string
}

type ProjectImportAnalysis = Omit<ProjectImportResult, 'projectId'> & { recommendedVisualStyle: string }

async function pollProjectImportAnalysis(jobId: string, timeoutMs = 5 * 60 * 1000): Promise<ProjectImportAnalysis> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const response = await clientFetch(`/api/projects/import/status/${jobId}`, { timeoutMs: 15_000 })
        const json = await readApiJson(response)
        if (!json.success) throw new Error(json.error ?? '查询导入任务失败')
        if (json.data.phase === 'awaiting_confirmation') return json.data.result as ProjectImportAnalysis
        if (json.data.phase === 'error') throw new Error(json.data.error ?? '剧本导入失败')
        await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs: 4_000 })))
    }
    throw new Error('剧本导入失败')
}

async function pollProjectImportCommit(jobId: string, timeoutMs = 2 * 60 * 1000): Promise<ProjectImportResult> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const response = await clientFetch(`/api/projects/import/status/${jobId}`, { timeoutMs: 15_000 })
        const json = await readApiJson(response)
        if (!json.success) throw new Error(json.error ?? '查询导入任务失败')
        if (json.data.phase === 'done') return json.data.result as ProjectImportResult
        if (json.data.phase === 'error') throw new Error(json.data.error ?? '剧本导入失败')
        await new Promise(resolve => setTimeout(resolve, getPollingDelay({ baseMs: 3_000 })))
    }
    throw new Error('项目创建仍在后台运行，请稍后查看')
}

const STATUS_LABELS: Record<string, string> = {
    draft: '草稿',
    in_production: '制作中',
    completed: '已完成'
}

function formatDate(iso: string) {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ProjectsPage() {
    const router = useRouter()
    const { t, locale } = useI18n()
    const [projects, setProjects] = useState<Project[]>([])
    const [authReady, setAuthReady] = useState(false)
    const [loading, setLoading] = useState(true)
    const [showImport, setShowImport] = useState(false)
    const [importText, setImportText] = useState('')
    const [importing, setImporting] = useState(false)
    const [parsingDocument, setParsingDocument] = useState(false)
    const [importFilename, setImportFilename] = useState<string | null>(null)
    const [importError, setImportError] = useState<string | null>(null)
    const [importJobId, setImportJobId] = useState<string | null>(null)
    const [importDraftId, setImportDraftId] = useState<string | null>(null)
    const [importAnalysis, setImportAnalysis] = useState<ProjectImportAnalysis | null>(null)
    const [importResult, setImportResult] = useState<ProjectImportResult | null>(null)
    const [form, setForm] = useState(DEFAULT_FORM)
    const [error, setError] = useState<string | null>(null)
    const importFileRef = useRef<HTMLInputElement>(null)
    const { confirm, confirmDialog } = useConfirmDialog()

    const fetchProjects = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await clientFetch('/api/projects')
            const json = await readApiJson(res)
            if (!json.success) throw new Error(json.error ?? '项目列表加载失败')
            setProjects(json.data ?? [])
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const syncAuth = () => {
            if (!isLoggedIn()) {
                setAuthReady(false)
                setShowImport(false)
                router.replace('/')
                return
            }
            setAuthReady(true)
            void fetchProjects()
        }
        syncAuth()
        return onAuthChange(syncAuth)
    }, [fetchProjects, router])

    async function importProject() {
        if (!importText.trim() || importText.trim().length < 20) {
            setImportError('请粘贴至少 20 字的剧本内容')
            return
        }
        setImporting(true)
        setImportError(null)
        setImportResult(null)
        setImportAnalysis(null)
        setImportJobId(null)
        setImportDraftId(null)
        try {
            const res = await clientFetch('/api/projects/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeoutMs: 15_000,
                body: JSON.stringify({ text: importText, filename: importFilename })
            })
            const json = await readApiJson(res)
            if (!json.success) throw new Error(json.error ?? '剧本导入失败')
            if (!json.data.jobId && !json.data.importId) throw new Error('剧本导入失败')
            setImportJobId(json.data.jobId ?? null)
            setImportDraftId(json.data.importId ?? null)
            let analysis = json.data.result as ProjectImportAnalysis | undefined
            if (!analysis) {
                if (!json.data.jobId) throw new Error('剧本导入失败')
                analysis = await pollProjectImportAnalysis(json.data.jobId)
            }
            setImportAnalysis(analysis)
            const normalizedStyle = normalizeStyleForCreation(analysis.recommendedVisualStyle)
            setForm(current => ({ ...current, visualStyle: normalizedStyle }))
        } catch (err) {
            setImportError(err instanceof Error ? err.message : String(err))
        } finally {
            setImporting(false)
        }
    }

    async function confirmImportProject() {
        if ((!importJobId && !importDraftId) || !importAnalysis) return

        setImporting(true)
        setImportError(null)
        try {
            const response = await clientFetch('/api/projects/import/commit', {
                method: 'POST',
                timeoutMs: 60_000,
                body: JSON.stringify(
                    importDraftId
                        ? {
                              importId: importDraftId,
                              text: importText,
                              filename: importFilename,
                              visualStyle: form.visualStyle,
                              videoAspectRatio: form.videoAspectRatio,
                              contentLanguage: form.contentLanguage,
                              episodeFormat: form.episodeFormat
                          }
                        : {
                              jobId: importJobId,
                              text: importText,
                              filename: importFilename,
                              visualStyle: form.visualStyle,
                              videoAspectRatio: form.videoAspectRatio,
                              contentLanguage: form.contentLanguage,
                              episodeFormat: form.episodeFormat
                          }
                )
            })
            const json = await readApiJson(response)
            if (!json.success) throw new Error(json.error ?? '确认导入失败')
            const commitJobId = typeof json.data.jobId === 'string' ? json.data.jobId : importJobId
            if (!json.data.projectId && !commitJobId) throw new Error('确认导入未返回项目或任务 ID')
            if (commitJobId) {
                setImportJobId(commitJobId)
                setImportDraftId(null)
            }
            setImportResult(json.data.projectId ? (json.data as ProjectImportResult) : await pollProjectImportCommit(commitJobId!))

            setImportAnalysis(null)
        } catch (error) {
            setImportError(error instanceof Error ? error.message : String(error))
        } finally {
            setImporting(false)
        }
    }

    async function parseImportDocument(file: File) {
        setParsingDocument(true)
        setImportError(null)
        setImportJobId(null)
        setImportDraftId(null)
        setImportAnalysis(null)
        setImportResult(null)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await clientFetch('/api/projects/import-document', {
                method: 'POST',
                body: formData
            })
            const json = await readApiJson(res)
            if (!json.success) throw new Error(json.error ?? '文档解析失败')
            setImportText(json.data.text)
            setImportFilename(json.data.filename)
        } catch (err) {
            setImportError(err instanceof Error ? err.message : String(err))
            setImportFilename(null)
        } finally {
            setParsingDocument(false)
            if (importFileRef.current) importFileRef.current.value = ''
        }
    }

    function closeImportDialog() {
        if (importing) return
        setShowImport(false)
        setImportText('')
        setImportFilename(null)
        setImportError(null)
        setImportResult(null)
        setImportJobId(null)
        setImportDraftId(null)
    }

    async function deleteProject(id: string) {
        const ok = await confirm({
            title: '删除项目',
            message: '确认删除该项目？删除后项目内容、分集和素材都会被移除。',
            confirmText: '删除',
            tone: 'danger'
        })
        if (!ok) return
        await clientFetch(`/api/projects/${id}`, { method: 'DELETE' })
        fetchProjects()
    }

    if (!authReady) {
        return (
            <div className="app-page relative flex min-h-screen items-center justify-center text-slate-500">
                <HomeLogoLink className="absolute start-4 top-3" />
                <Loader2 className="me-2 h-4 w-4 animate-spin text-violet-400" />
                {t('正在确认登录状态…')}
            </div>
        )
    }

    return (
        <div className="studio-theme studio-library relative flex min-h-screen flex-col overflow-hidden">
            {confirmDialog}

            {/* 顶栏 */}
            <SiteHeader
                sticky
                className="z-30"
                contentClassName="flex flex-wrap items-center justify-between gap-3">
                <Link
                    href="/"
                    aria-label={SITE_NAME}
                    className="flex items-center gap-2.5 group">
                    <BrandLogo />
                    <div className="hidden sm:block">
                        <span
                            dir="ltr"
                            translate="no"
                            className="block text-sm font-semibold tracking-tight text-white sm:text-base">
                            {SITE_NAME}
                        </span>
                        <span className="hidden text-[10px] tracking-[0.18em] text-slate-600 sm:block">创作工作室</span>
                    </div>
                </Link>
                <div className="ms-auto flex items-center gap-1 sm:gap-2">
                    <Link
                        href="/works"
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-300">
                        <Film className="h-4 w-4" />
                        {t('剧集')}
                    </Link>
                    <Link
                        href="/aivideo"
                        className="hidden items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-sm text-violet-200 transition hover:bg-violet-500/20 sm:flex">
                        <Sparkles className="h-4 w-4" />
                        AI 创作台
                    </Link>
                    <WalletBalance compact />
                    <AuthBar variant="default" />
                </div>
            </SiteHeader>

            {/* 项目工作区 */}
            <main className="relative mx-auto w-full max-w-7xl flex-1 px-4 pb-10 sm:px-6">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-6">
                    <div className="min-w-0 max-w-2xl">
                        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                            {t('我的项目')}
                            {!loading && !error && projects.length > 0 && <span className="ms-3 text-base font-normal text-slate-400">{projects.length}</span>}
                        </h1>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <button
                            type="button"
                            onClick={() => {
                                setImportError(null)
                                setImportResult(null)
                                setShowImport(true)
                            }}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-400 sm:flex-none">
                            <Upload className="h-4 w-4" />
                            导入剧本
                        </button>
                        <Link
                            href="/"

                            className="studio-primary inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-400 sm:flex-none">
                            <Plus className="h-4 w-4" />
                            创建短剧
                        </Link>
                    </div>
                </div>

                {loading ? (
                    <div className="studio-library-grid">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="studio-library-project min-h-52 animate-pulse"
                            />
                        ))}
                    </div>
                ) : error ? (
                    <div
                        role="alert"
                        className="rounded-2xl border border-white/[0.07] bg-white/[0.015] px-6 py-16 text-center">
                        <p className="text-red-400 text-sm mb-4">{error}</p>
                        <button
                            onClick={fetchProjects}
                            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors">
                            重新加载
                        </button>
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center sm:min-h-80">
                        <div
                            aria-hidden="true"
                            className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/15 bg-violet-400/[0.06] text-violet-300/70">
                            <Clapperboard
                                className="h-6 w-6"
                                strokeWidth={1.5}
                            />
                        </div>
                        <p className="max-w-sm text-sm leading-6 text-slate-400">还没有项目，创建你的第一部短剧</p>
                    </div>
                ) : (
                    <div className="studio-library-grid">
                        {projects.map(p => {
                            const published = p.visibility === 'public'
                            return (
                                <article
                                    key={p.id}
                                    data-status={p.status}
                                    data-published={published ? 'true' : undefined}
                                    className="studio-library-project group">
                                    <Link
                                        href={`/projects/${p.id}`}
                                        aria-label={`${t('进入项目')} ${p.title}`}
                                        data-i18n-skip-attributes
                                        className="studio-library-project-link">
                                        {published && (
                                            <div className="studio-library-project-cover">
                                                {p.coverUrl ? (
                                                    <>
                                                        <OptimizedMediaImage
                                                            src={p.coverUrl}
                                                            alt=""
                                                            aria-hidden
                                                            fill
                                                            sizes="(min-width: 1280px) 160px, (min-width: 980px) 14vw, (min-width: 664px) 20vw, 40vw"
                                                            className="studio-library-project-cover-backdrop"
                                                        />
                                                        <OptimizedMediaImage
                                                            src={p.coverUrl}
                                                            alt={p.title}
                                                            fill
                                                            sizes="(min-width: 1280px) 160px, (min-width: 980px) 14vw, (min-width: 664px) 20vw, 40vw"
                                                            className="studio-library-project-cover-image"
                                                        />
                                                    </>
                                                ) : (
                                                    <Clapperboard
                                                        className="h-8 w-8"
                                                        strokeWidth={1.25}
                                                    />
                                                )}
                                                <span>{t('已发布')}</span>
                                            </div>
                                        )}
                                        <div className="studio-library-project-content">
                                            <div className="studio-library-project-heading">
                                                {!published && (
                                                    <span className="studio-library-project-mark">
                                                        <Clapperboard
                                                            className="h-5 w-5"
                                                            strokeWidth={1.5}
                                                        />
                                                    </span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <h2
                                                        data-i18n-skip
                                                        title={p.title}
                                                        className="truncate text-lg font-semibold leading-6 tracking-tight text-slate-100">
                                                        {p.title}
                                                    </h2>
                                                    {p.genre && (
                                                        <p
                                                            data-i18n-skip
                                                            title={p.genre}
                                                            className="mt-1 truncate text-xs leading-4 text-slate-500">
                                                            {p.genre}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            {p.description?.trim() && (
                                                <p
                                                    data-i18n-skip
                                                    className="mt-3 line-clamp-2 text-[13px] leading-5 text-slate-400">
                                                    {p.description}
                                                </p>
                                            )}
                                            <div className="studio-library-project-metrics">
                                                <span>
                                                    <Film className="h-3.5 w-3.5" />
                                                    {p.completedEpisodes !== undefined && t('成片')}
                                                    <span className="font-medium tabular-nums text-slate-300">
                                                        {p.completedEpisodes ?? p._count.episodes}/{p.totalEpisodes}
                                                    </span>
                                                    {t('集')}
                                                </span>
                                                <span>
                                                    <Users className="h-3.5 w-3.5" />
                                                    <span className="font-medium tabular-nums text-slate-300">{p._count.characters}</span>
                                                    {t('角色')}
                                                </span>
                                            </div>
                                            <div className="studio-library-project-footer">
                                                <span
                                                    className="studio-library-project-status"
                                                    title={t(STATUS_LABELS[p.status] ?? p.status)}>
                                                    <span className="h-1 w-1 shrink-0 rounded-full bg-current" />
                                                    <span className="truncate">{t(STATUS_LABELS[p.status] ?? p.status)}</span>
                                                </span>
                                                <time
                                                    dateTime={p.createdAt}
                                                    className="text-xs tabular-nums text-slate-500">
                                                    {formatDate(p.createdAt)}
                                                </time>
                                                <span
                                                    className="studio-library-project-open"
                                                    aria-hidden="true">
                                                    <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => deleteProject(p.id)}
                                        aria-label={`${t('删除项目')} ${p.title}`}
                                        title={t('删除项目')}
                                        data-i18n-skip-attributes
                                        className="studio-library-project-delete">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </article>
                            )
                        })}
                    </div>
                )}
            </main>

            <SiteFooter />

            {/* 导入剧本弹窗 */}
            {showImport && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="import-script-dialog-title"
                        className="novel-scroll w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#111116] p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2
                                id="import-script-dialog-title"
                                className="text-lg font-bold text-white flex items-center gap-2">
                                <Upload className="w-5 h-5 text-purple-400" />
                                导入剧本
                            </h2>
                            <button
                                type="button"
                                aria-label="关闭导入剧本弹窗"
                                onClick={closeImportDialog}
                                disabled={importing}
                                className="text-gray-500 hover:text-white disabled:opacity-40 transition-colors">
                                ✕
                            </button>
                        </div>

                        {!importResult ? (
                            importAnalysis ? (
                                <div className="space-y-5 py-2">
                                    <div className="rounded-xl border border-purple-500/25 bg-purple-500/10 p-4">
                                        <div className="flex items-center gap-2 text-sm font-medium text-purple-100">
                                            <Sparkles className="h-4 w-4" />
                                            识别完成，请审核
                                        </div>
                                        <div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
                                            <p>
                                                内容类型：
                                                <span className="text-white">
                                                    {importAnalysis.stage === 'outline'
                                                        ? '大纲'
                                                        : importAnalysis.stage === 'novel'
                                                          ? '小说正文'
                                                          : importAnalysis.stage === 'script'
                                                            ? '短剧剧本'
                                                            : '分镜脚本'}
                                                </span>
                                            </p>
                                            <p>
                                                识别集数：<span className="text-white">{importAnalysis.totalEpisodes} 集</span>
                                            </p>
                                            {importAnalysis.detectedTitle && (
                                                <p>
                                                    剧名：<span className="text-white">{importAnalysis.detectedTitle}</span>
                                                </p>
                                            )}
                                            {importAnalysis.detectedGenre && (
                                                <p>
                                                    题材：<span className="text-white">{importAnalysis.detectedGenre}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1.5 block text-xs text-gray-400">推荐视觉风格</label>
                                            <CustomSelect
                                                ariaLabel="视觉风格"
                                                searchable
                                                value={form.visualStyle}
                                                onChange={visualStyle => setForm(current => ({ ...current, visualStyle }))}
                                                options={ORDERED_VISUAL_STYLE_PRESETS.map(style => ({
                                                    value: style.key,
                                                    label: style.label,
                                                    group: getCreationStyleGroupLabel(style.key, locale),
                                                    searchText: `${style.label} ${style.hint} ${style.key}`,
                                                    description: style.hint
                                                }))}
                                            />
                                            <p className="mt-1.5 text-[11px] text-purple-300">已根据题材自动推荐，可搜索并调整</p>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-xs text-gray-400">画幅比例</label>
                                            <CustomSelect
                                                ariaLabel="画幅比例"
                                                value={form.videoAspectRatio}
                                                onChange={videoAspectRatio => setForm(current => ({ ...current, videoAspectRatio }))}
                                                options={[
                                                    { value: '9:16', label: '9:16 竖屏', description: '短剧与移动端默认' },
                                                    { value: '16:9', label: '16:9 横屏', description: '电影感与横版平台' },
                                                    { value: '1:1', label: '1:1 方形', description: '社交媒体方形内容' }
                                                ]}
                                            />
                                        </div>
                                    </div>

                                    {importError && <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{t(importError)}</div>}
                                    <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
                                        <button
                                            type="button"
                                            disabled={importing}
                                            onClick={() => {
                                                setImportAnalysis(null)
                                                setImportJobId(null)
                                                setImportDraftId(null)
                                            }}
                                            className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-white disabled:opacity-40">
                                            返回修改内容
                                        </button>
                                        <button
                                            type="button"
                                            onClick={confirmImportProject}
                                            disabled={importing}
                                            className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition-colors hover:bg-purple-500 disabled:opacity-40">
                                            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                                            {importing ? '正在创建项目...' : '确认并导入'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                                        <p className="text-xs text-purple-200 leading-relaxed">
                                            {t('上传文档或粘贴内容后，系统会直接按集、场次和画面快速解析；大纲、正文、剧本和分镜会分别导入到对应阶段。')}
                                        </p>
                                    </div>

                                    <div className="mb-4">
                                        <input
                                            ref={importFileRef}
                                            type="file"
                                            accept=".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                                            disabled={importing || parsingDocument}
                                            onChange={e => {
                                                const file = e.target.files?.[0]
                                                if (file) void parseImportDocument(file)
                                            }}
                                            className="hidden"
                                        />
                                        <button
                                            type="button"

                                            onClick={() => importFileRef.current?.click()}
                                            disabled={importing || parsingDocument}
                                            className="w-full flex items-center justify-center gap-3 rounded-xl border border-dashed border-purple-500/35 bg-purple-500/[0.06] px-4 py-4 text-sm text-purple-200 hover:border-purple-400/60 hover:bg-purple-500/10 disabled:opacity-40 transition-colors">
                                            {parsingDocument ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
                                            <span className="text-start">
                                                <span className="block font-medium">
                                                    {parsingDocument ? t('正在解析文档…') : importFilename ? `${t('已解析：')}${importFilename}` : t('上传剧本文档')}
                                                </span>
                                                <span className="block mt-0.5 text-xs text-gray-500">支持 TXT、Markdown、DOCX、PDF，最大 8MB</span>
                                            </span>
                                        </button>
                                    </div>

                                    <div className="mb-4">
                                        <label className="text-sm text-gray-400 mb-2 block">解析结果 / 剧本内容</label>
                                        <textarea
                                            value={importText}
                                            onChange={e => {
                                                setImportText(e.target.value)
                                                setImportFilename(null)
                                            }}
                                            disabled={importing || parsingDocument}
                                            placeholder={t(
                                                '粘贴你的剧本内容...\n\n例如：\n第1集 命运的相遇\n女主林晓在雨夜的地铁站遇到了神秘的男子...\n\n或者：\n林晓（低头哭泣）：为什么是我...\n男主（走过来）：别怕，我在这里'
                                            )}
                                            rows={12}
                                            className="novel-scroll w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm leading-relaxed text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-500/50 disabled:opacity-40"
                                        />
                                        <div className="mt-1 text-xs text-gray-600 flex justify-between">
                                            <span>
                                                {t('字符数：')}
                                                {importText.length}
                                            </span>
                                            <span>{t('最少 20 个字符，最多 20 万个字符')}</span>
                                        </div>
                                    </div>

                                    {importError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{t(importError)}</div>}

                                    <div className="flex justify-end gap-2 pt-2">
                                        <button
                                            onClick={closeImportDialog}
                                            disabled={importing || parsingDocument}
                                            className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-40 rounded-lg transition-colors">
                                            取消
                                        </button>
                                        <button
                                            onClick={importProject}
                                            disabled={importing || parsingDocument || !importText.trim() || importText.trim().length < 20}
                                            className="flex items-center gap-2 px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors shadow-lg shadow-purple-900/30">
                                            {importing ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    {t('正在解析文档…')}
                                                </>
                                            ) : (
                                                <>
                                                    <Upload className="w-4 h-4" />
                                                    {t('导入已有内容')}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </>
                            )
                        ) : (
                            <div className="text-center py-6">
                                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-500/20 border border-green-500/30 mb-4">
                                    <Film className="w-7 h-7 text-green-400" />
                                </div>
                                <h3 className="text-white font-semibold mb-2">导入成功！</h3>
                                <div className="text-sm text-gray-400 space-y-1 mb-6">
                                    <p>
                                        {t('识别为：')}
                                        <span className="text-purple-300 font-medium">
                                            {importResult.stage === 'outline' && t('大纲')}
                                            {importResult.stage === 'novel' && t('小说正文')}
                                            {importResult.stage === 'script' && t('短剧剧本')}
                                            {importResult.stage === 'storyboard' && t('分镜脚本')}
                                        </span>
                                    </p>
                                    {importResult.detectedTitle && (
                                        <p>
                                            {t('剧名：')}
                                            {importResult.detectedTitle}
                                        </p>
                                    )}
                                    {importResult.detectedGenre && (
                                        <p>
                                            {t('题材：')}
                                            {importResult.detectedGenre}
                                        </p>
                                    )}
                                    <p>
                                        {t('共')} {importResult.totalEpisodes} {t('集')}
                                        {importResult.totalStoryboards > 0 && ` · ${importResult.totalStoryboards} ${t('个分镜')}`}
                                    </p>
                                </div>
                                <div className="flex justify-center gap-2">
                                    <button
                                        onClick={closeImportDialog}
                                        className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg transition-colors">
                                        关闭
                                    </button>
                                    <button
                                        onClick={() => {
                                            const id = importResult.projectId
                                            closeImportDialog()
                                            router.push(`/projects/${id}`)
                                        }}
                                        className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-purple-900/30">
                                        进入项目
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
