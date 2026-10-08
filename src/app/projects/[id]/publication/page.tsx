'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, Globe, ImagePlus, Images, Loader2, Lock, Sparkles, Upload, UserRound } from 'lucide-react'
import Link, { useParams } from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { localeDisplayName, locales } from '@/i18n/config'
import SiteHeader from '@/components/SiteHeader'
import HomeLogoLink from '@/components/HomeLogoLink'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { getAuthUser } from '@/lib/auth'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { normalizeProfileAvatarUrl, normalizeProfileDisplayName } from '@/lib/profile'
import { normalizeStringList, normalizeSubtitleLanguages, projectPublicationIssues, readStringList, type ProjectVisibility } from '@/lib/project-publication'
import { PROJECT_GENRES } from '@/lib/project-genres'
import type { PublicationCoverCandidate, PublicationTrailerCandidate } from '@/lib/publication-media'
import CustomSelect from '@/components/CustomSelect'
import './publication.css'

type Publication = Parameters<typeof projectPublicationIssues>[0] & {
    id: string
    title: string
    status: string
    completedEpisodes: number
    expectedEpisodes?: number
    coverAlt: string | null
    genreLabel: string | null
    visibility: ProjectVisibility
    author: { displayName: string | null; avatarUrl: string | null }
    createdAt: string | null
    updatedAt: string | null
    publishedAt: string | null
    coverCandidates: PublicationCoverCandidate[]
    trailerCandidates: PublicationTrailerCandidate[]
}
type PublicationForm = { genre: string; seoTitle: string; seoDescription: string; seoKeywords: string; coverAlt: string; subtitleLanguages: string[] }
type PublicationAiAction = 'metadata' | 'covers'
type PublicationMutation = 'select-cover' | 'select-trailer' | 'save' | 'cover' | 'trailer'

function normalizePublication(value: Publication): Publication {
    return {
        ...value,
        coverCandidates: Array.isArray(value.coverCandidates) ? value.coverCandidates : [],
        trailerCandidates: Array.isArray(value.trailerCandidates) ? value.trailerCandidates : []
    }
}

function publicationForm(project: Publication): PublicationForm {
    return {
        genre: project.genreLabel ?? '',
        seoTitle: project.seoTitle ?? project.title,
        seoDescription: project.seoDescription ?? '',
        seoKeywords: readStringList(project.seoKeywords).join(', '),
        coverAlt: project.coverAlt ?? project.title,
        subtitleLanguages: normalizeSubtitleLanguages(project.subtitleLanguages)
    }
}

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function syncMissingPublicationAuthor(project: Publication, signal: AbortSignal): Promise<Publication> {
    const user = getAuthUser()
    const displayName = normalizeProfileDisplayName(project.author.displayName) ?? normalizeProfileDisplayName(user?.displayName)
    const avatarUrl = normalizeProfileAvatarUrl(project.author.avatarUrl) ?? normalizeProfileAvatarUrl(user?.photoURL)
    if ((project.author.displayName && project.author.avatarUrl) || !displayName || !avatarUrl) return project

    const form = new FormData()
    form.set('displayName', displayName)
    form.set('avatarUrl', avatarUrl)
    const response = await clientFetch('/api/profile', { method: 'PUT', body: form, signal })
    const json = await readApiJson(response)
    const savedDisplayName = normalizeProfileDisplayName(json.data?.displayName)
    const savedAvatarUrl = normalizeProfileAvatarUrl(json.data?.avatarUrl)
    if (!response.ok || !json.success || !savedDisplayName || !savedAvatarUrl) return project
    return { ...project, author: { displayName: savedDisplayName, avatarUrl: savedAvatarUrl } }
}

function PublicationEditor({ initial }: { initial: Publication }) {
    const { t, locale } = useI18n()
    const [project, setProject] = useState(initial)
    const [form, setForm] = useState<PublicationForm>(() => publicationForm(initial))
    const [busy, setBusy] = useState<PublicationMutation | null>(null)
    const [aiBusy, setAiBusy] = useState<Record<PublicationAiAction, boolean>>({ metadata: false, covers: false })
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const { confirm, confirmDialog } = useConfirmDialog()
    const isBusy = busy !== null || aiBusy.metadata || aiBusy.covers
    const candidate = { ...project, ...form, genreLabel: form.genre, seoKeywords: normalizeStringList(form.seoKeywords) }
    const issues = projectPublicationIssues(candidate, project.author)
    const allEpisodesMerged = project.status === 'completed'
    const expectedEpisodes = project.expectedEpisodes ?? project.totalEpisodes ?? 0
    const remainingEpisodes = Math.max(0, expectedEpisodes - project.completedEpisodes)
    const mergeHint = remainingEpisodes > 0 ? t('还有 {count} 集未生成合成视频，全部完成后即可发布。', { count: remainingEpisodes }) : t('请先生成所有集的合成视频')
    if (!allEpisodesMerged) issues.push('请先生成所有集的合成视频')

    function formatDate(value: string | null) {
        if (!value) return t('未发布')
        const date = new Date(value)
        return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : value
    }

    async function fetchPublication() {
        const response = await clientFetch(`/api/projects/${project.id}/publication`, { cache: 'no-store' })
        const json = await readApiJson(response)
        if (!response.ok || !json.success) throw new Error(json.error ?? '作品信息加载失败')
        return normalizePublication(json.data as Publication)
    }

    async function runAi(action: PublicationAiAction) {
        if (busy || aiBusy[action]) return
        setAiBusy(current => ({ ...current, [action]: true }))
        setError('')
        setMessage('')
        try {
            const response = await clientFetch(`/api/projects/${project.id}/publication-ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            })
            const submitted = await readApiJson(response)
            if (!response.ok || !submitted.success || !submitted.data?.jobId) throw new Error(submitted.error ?? 'AI 生成任务创建失败')
            const deadline = Date.now() + 10 * 60_000
            while (Date.now() < deadline) {
                const statusResponse = await clientFetch(`/api/projects/${project.id}/publication-ai/status/${submitted.data.jobId}`, { cache: 'no-store' })
                const status = await readApiJson(statusResponse)
                if (!statusResponse.ok || !status.success) throw new Error(status.error ?? 'AI 生成状态查询失败')
                if (status.data.phase === 'error' || status.data.phase === 'cancelled') throw new Error(status.data.error ?? 'AI 生成失败')
                if (status.data.phase === 'done') break
                await wait(1_500)
            }
            if (Date.now() >= deadline) throw new Error('AI 生成仍在后台进行，请稍后刷新查看')
            const fresh = await fetchPublication()
            if (action === 'metadata') {
                setProject(current => ({
                    ...current,
                    seoTitle: fresh.seoTitle,
                    seoDescription: fresh.seoDescription,
                    seoKeywords: fresh.seoKeywords,
                    coverAlt: fresh.coverAlt,
                    updatedAt: fresh.updatedAt
                }))
                setForm(current => ({
                    ...current,
                    seoTitle: fresh.seoTitle ?? fresh.title,
                    seoDescription: fresh.seoDescription ?? '',
                    seoKeywords: readStringList(fresh.seoKeywords).join(', '),
                    coverAlt: fresh.coverAlt ?? fresh.title
                }))
            } else {
                setProject(current => ({ ...current, coverUrl: fresh.coverUrl, coverCandidates: fresh.coverCandidates, updatedAt: fresh.updatedAt }))
            }
            setMessage(t(action === 'metadata' ? 'AI 已补全作品资料，仍可继续编辑' : '已生成 3 张封面候选，请选择喜欢的一张'))
        } catch (error) {
            setError(error instanceof Error ? error.message : t('AI 生成失败，请重试'))
        } finally {
            setAiBusy(current => ({ ...current, [action]: false }))
        }
    }

    async function selectMedia(kind: 'cover' | 'trailer', url: string) {
        if (isBusy || (kind === 'cover' ? project.coverUrl === url : project.trailerUrl === url)) return
        setBusy(`select-${kind}`)
        setError('')
        setMessage('')
        try {
            const response = await clientFetch(`/api/projects/${project.id}/publication-media`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, url })
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error ?? '媒体选择失败')
            setProject(current => ({ ...current, ...(kind === 'cover' ? { coverUrl: url } : { trailerUrl: url }) }))
            setMessage(t(kind === 'cover' ? '作品封面已更新' : '预告片已更新'))
        } catch (error) {
            setError(error instanceof Error ? error.message : t('媒体选择失败'))
        } finally {
            setBusy(null)
        }
    }

    async function save(visibility: ProjectVisibility) {
        if (isBusy || (visibility === 'public' && issues.length > 0)) return
        if (
            visibility === 'public' &&
            project.visibility !== 'public' &&
            !(await confirm({ title: t('发布作品'), message: t('发布后，所有人都可以在剧集页查看并播放全部分集。'), confirmText: t('确认发布') }))
        )
            return
        if (visibility === 'private' && project.visibility === 'public' && !(await confirm({ title: t('取消发布'), message: t('取消发布后，作品将从公开剧集页移除。'), confirmText: t('取消发布') })))
            return
        setBusy('save')
        setError('')
        setMessage('')
        try {
            const json = await readApiJson(
                await clientFetch(`/api/projects/${project.id}/publication`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...form, seoKeywords: normalizeStringList(form.seoKeywords), visibility })
                })
            )
            if (!json.success) throw new Error(json.error)
            setProject(normalizePublication(json.data as Publication))
            setMessage(t(visibility === 'public' ? '作品已发布' : '已保存'))
        } catch (error) {
            setError(error instanceof Error ? error.message : t('保存失败，请重试'))
        } finally {
            setBusy(null)
        }
    }

    async function upload(kind: 'cover' | 'trailer', file?: File) {
        if (!file || isBusy) return
        if (file.size > (kind === 'cover' ? 10 : 300) * 1024 * 1024) {
            setError(t(kind === 'cover' ? '封面图片不能超过 10MB' : '预告片不能超过 300MB'))
            return
        }
        setBusy(kind)
        setError('')
        setMessage('')
        try {
            const body = new FormData()
            body.set('kind', kind)
            body.set('file', file)
            const json = await readApiJson(await clientFetch(`/api/projects/${project.id}/publication-media`, { method: 'POST', body, timeoutMs: 300_000 }))
            if (!json.success) throw new Error(json.error)
            setProject(current =>
                kind === 'cover'
                    ? {
                          ...current,
                          coverUrl: json.data.url,
                          coverCandidates: [{ url: json.data.url, label: t('自定义上传'), source: 'current' as const }, ...current.coverCandidates.filter(candidate => candidate.url !== json.data.url)]
                      }
                    : {
                          ...current,
                          trailerUrl: json.data.url,
                          trailerCandidates: [
                              { url: json.data.url, label: t('自定义上传'), source: 'current' as const },
                              ...current.trailerCandidates.filter(candidate => candidate.url !== json.data.url)
                          ]
                      }
            )
            setMessage(t(kind === 'cover' ? '作品封面已更新' : '预告片已更新'))
        } catch (error) {
            setError(error instanceof Error ? error.message : t('上传失败，请重试'))
        } finally {
            setBusy(null)
        }
    }

    return (
        <>
            {confirmDialog}
            <div className="publication-heading">
                <div>
                    <p className="publication-kicker">
                        {t(project.status === 'completed' ? '已完成' : project.status === 'draft' ? '草稿' : '制作中')} · {t('成片')} {project.completedEpisodes} / {expectedEpisodes}
                    </p>
                    <h1 data-i18n-skip>{project.title}</h1>
                    <p>{t('完善作品信息，发布到公开剧集页。')}</p>
                </div>
                <span className="publication-visibility">
                    {project.visibility === 'public' ? <Globe size={15} /> : <Lock size={15} />}
                    {t(project.visibility === 'public' ? '已发布' : '未公开')}
                </span>
            </div>
            <div className="publication-grid">
                <div className="publication-fields">
                    <section>
                        <div className="publication-section-heading">
                            <div>
                                <h2>{t('作品信息')}</h2>
                                <p>{t('AI 会结合剧情、角色和分集梗概生成完整文案，生成后可继续编辑。')}</p>
                            </div>
                            <button
                                type="button"
                                className="publication-ai-button"
                                disabled={busy !== null || aiBusy.metadata}
                                aria-busy={aiBusy.metadata}
                                onClick={() => void runAi('metadata')}>
                                {aiBusy.metadata ? (
                                    <Loader2
                                        className="animate-spin"
                                        size={14}
                                    />
                                ) : (
                                    <Sparkles size={14} />
                                )}
                                {t(aiBusy.metadata ? 'AI 生成中…' : 'AI 补全资料')}
                            </button>
                        </div>
                        <label>
                            {t('作品类型')}
                            <CustomSelect
                                value={form.genre}
                                options={PROJECT_GENRES.map(genre => ({ value: genre.label, label: t(genre.label) }))}
                                onChange={genre => setForm({ ...form, genre })}
                                ariaLabel="作品类型"
                                placeholder="请选择作品类型"
                                buttonClassName="publication-select-button"
                            />
                        </label>
                        <label>
                            {t('作品标题')}
                            <input
                                value={form.seoTitle}
                                maxLength={120}
                                onChange={event => setForm({ ...form, seoTitle: event.target.value })}
                            />
                        </label>
                        <label>
                            {t('作品简介')}
                            <textarea
                                value={form.seoDescription}
                                maxLength={500}
                                rows={4}
                                onChange={event => setForm({ ...form, seoDescription: event.target.value })}
                            />
                        </label>
                        <label>
                            {t('关键词')}
                            <input
                                value={form.seoKeywords}
                                onChange={event => setForm({ ...form, seoKeywords: event.target.value })}
                                placeholder={t('多个关键词用逗号分隔')}
                            />
                        </label>
                        <label>
                            {t('封面描述')}
                            <input
                                value={form.coverAlt}
                                maxLength={255}
                                onChange={event => setForm({ ...form, coverAlt: event.target.value })}
                            />
                        </label>
                    </section>
                    <section className="publication-metadata">
                        <h2>{t('作品档案')}</h2>
                        <div className="publication-author-card">
                            <div className="publication-avatar">
                                {project.author.avatarUrl ? (
                                    <OptimizedMediaImage
                                        src={project.author.avatarUrl}
                                        alt={project.author.displayName ?? t('作者头像')}
                                        fill
                                        sizes="44px"
                                    />
                                ) : (
                                    <UserRound size={20} />
                                )}
                            </div>
                            <div>
                                <span>{t('作者')}</span>
                                <strong data-i18n-skip>{project.author.displayName || t('未完善作者昵称')}</strong>
                            </div>
                            <Link href="/profile">
                                {t('编辑作者资料')}
                                <ExternalLink size={12} />
                            </Link>
                        </div>
                        <dl className="publication-facts">
                            <div>
                                <dt>{t('类型')}</dt>
                                <dd>{form.genre || t('未设置')}</dd>
                            </div>
                            <div>
                                <dt>{t('剧集')}</dt>
                                <dd>
                                    {project.completedEpisodes} / {expectedEpisodes} {t('集')}
                                </dd>
                            </div>
                            <div>
                                <dt>{t('创建时间')}</dt>
                                <dd>{formatDate(project.createdAt)}</dd>
                            </div>
                            <div>
                                <dt>{t('更新时间')}</dt>
                                <dd>{formatDate(project.updatedAt)}</dd>
                            </div>
                            <div>
                                <dt>{t('发布时间')}</dt>
                                <dd>{formatDate(project.publishedAt)}</dd>
                            </div>
                        </dl>
                    </section>
                    <fieldset>
                        <legend>{t('字幕语言')}</legend>
                        <div className="publication-languages">
                            {locales.map(language => (
                                <label key={language}>
                                    <input
                                        type="checkbox"
                                        checked={form.subtitleLanguages.includes(language)}
                                        onChange={event =>
                                            setForm({
                                                ...form,
                                                subtitleLanguages: event.target.checked ? [...form.subtitleLanguages, language] : form.subtitleLanguages.filter(item => item !== language)
                                            })
                                        }
                                    />
                                    {localeDisplayName(locale, language)}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <section className="publication-checklist">
                        <h2>{t('发布检查')}</h2>
                        {issues.length ? (
                            <>
                                <ul>
                                    {issues.map(issue => (
                                        <li key={issue}>{t(issue)}</li>
                                    ))}
                                </ul>
                                <div className="publication-help">
                                    <Link href="/profile">
                                        {t('作者资料')}
                                        <ExternalLink size={12} />
                                    </Link>
                                    <Link href={`/projects/${project.id}`}>
                                        {t('项目设置')}
                                        <ExternalLink size={12} />
                                    </Link>
                                </div>
                            </>
                        ) : (
                            <p className="publication-ready">
                                <Check size={16} />
                                {t('已准备好发布')}
                            </p>
                        )}
                    </section>
                </div>
                <aside className="publication-media">
                    <div className="publication-section-heading publication-media-heading">
                        <div>
                            <h2>{t('作品封面')}</h2>
                            <p>{t('可从现有画面选择，也可生成或上传新封面。')}</p>
                        </div>
                        <button
                            type="button"
                            className="publication-ai-button"
                            disabled={busy !== null || aiBusy.covers}
                            aria-busy={aiBusy.covers}
                            onClick={() => void runAi('covers')}>
                            {aiBusy.covers ? (
                                <Loader2
                                    className="animate-spin"
                                    size={14}
                                />
                            ) : (
                                <Sparkles size={14} />
                            )}
                            {t(aiBusy.covers ? '生成 3 张封面中…' : 'AI 生成 3 张')}
                        </button>
                    </div>
                    <div className="publication-cover">
                        {project.coverUrl ? (
                            <>
                                <OptimizedMediaImage
                                    src={project.coverUrl}
                                    alt=""
                                    aria-hidden
                                    fill
                                    sizes="300px"
                                    className="publication-cover-backdrop"
                                />
                                <OptimizedMediaImage
                                    src={project.coverUrl}
                                    alt={form.coverAlt || project.title}
                                    fill
                                    sizes="300px"
                                />
                            </>
                        ) : (
                            <ImagePlus size={32} />
                        )}
                    </div>
                    <div className="publication-media-actions">
                        <label className="publication-upload">
                            <Upload size={15} />
                            {t(busy === 'cover' ? '上传中…' : '上传自定义封面')}
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                disabled={isBusy}
                                onChange={event => {
                                    void upload('cover', event.target.files?.[0])
                                    event.target.value = ''
                                }}
                            />
                        </label>
                    </div>
                    <p className="publication-file-hint">JPG / PNG / WebP · ≤ 10 MB</p>
                    {project.coverCandidates.length > 0 && (
                        <div className="publication-candidate-block">
                            <h3>
                                <Images size={14} />
                                {t('从现有素材选择')}
                            </h3>
                            <div className="publication-cover-options">
                                {project.coverCandidates.map(candidate => (
                                    <button
                                        key={candidate.url}
                                        type="button"
                                        aria-label={t(candidate.label)}
                                        aria-pressed={project.coverUrl === candidate.url}
                                        title={t(candidate.label)}
                                        disabled={isBusy}
                                        onClick={() => void selectMedia('cover', candidate.url)}>
                                        <>
                                            <OptimizedMediaImage
                                                src={candidate.url}
                                                alt=""
                                                aria-hidden
                                                fill
                                                sizes="96px"
                                                className="publication-cover-backdrop"
                                            />
                                            <OptimizedMediaImage
                                                src={candidate.url}
                                                alt={t(candidate.label)}
                                                fill
                                                sizes="96px"
                                            />
                                        </>
                                        {project.coverUrl === candidate.url && (
                                            <span>
                                                <Check size={12} />
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <h2 className="publication-trailer-label">{t('预告片')}</h2>
                    {project.trailerUrl && (
                        <video
                            src={project.trailerUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="publication-trailer"
                        />
                    )}
                    <label className="publication-upload">
                        <Upload size={15} />
                        {t(busy === 'trailer' ? '上传中…' : '上传自定义预告片')}
                        <input
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm"
                            disabled={isBusy}
                            onChange={event => {
                                void upload('trailer', event.target.files?.[0])
                                event.target.value = ''
                            }}
                        />
                    </label>
                    <p className="publication-file-hint">MP4 / MOV / WebM · ≤ 300 MB</p>
                    {project.trailerCandidates.length > 0 && (
                        <div className="publication-candidate-block">
                            <h3>{t('选择本剧现有成片')}</h3>
                            <div className="publication-trailer-options">
                                {project.trailerCandidates.map(candidate => (
                                    <button
                                        key={candidate.url}
                                        type="button"
                                        aria-pressed={project.trailerUrl === candidate.url}
                                        disabled={isBusy}
                                        onClick={() => void selectMedia('trailer', candidate.url)}>
                                        <span>{t(candidate.label)}</span>
                                        {project.trailerUrl === candidate.url && <Check size={13} />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </aside>
            </div>
            <div className="publication-actions">
                <div
                    className="publication-feedback"
                    aria-live="polite">
                    {error ? <p role="alert">{t(error)}</p> : message ? <p>{message}</p> : <span>{t('制作完成不会自动公开作品。')}</span>}
                    {!allEpisodesMerged && <p id="publication-merge-status">{mergeHint}</p>}
                </div>
                {project.visibility === 'public' && (
                    <>
                        <Link
                            href={`/works/${project.id}`}
                            className="studio-secondary">
                            {t('查看作品')}
                            <ExternalLink size={14} />
                        </Link>
                        <button
                            disabled={isBusy}
                            className="studio-secondary"
                            onClick={() => save('private')}>
                            {t('取消发布')}
                        </button>
                    </>
                )}
                <button
                    disabled={isBusy || (project.visibility === 'public' && issues.length > 0)}
                    className="studio-secondary"
                    onClick={() => save(project.visibility)}>
                    {t('保存')}
                </button>
                {project.visibility !== 'public' && (
                    <button
                        disabled={isBusy || issues.length > 0}
                        aria-describedby={allEpisodesMerged ? undefined : 'publication-merge-status'}
                        aria-busy={isBusy}
                        className={isBusy ? 'studio-secondary' : 'studio-primary'}
                        onClick={() => save('public')}>
                        {isBusy ? (
                            <Loader2
                                size={15}
                                className="animate-spin"
                            />
                        ) : (
                            <Globe size={15} />
                        )}
                        {t('发布作品')}
                    </button>
                )}
            </div>
        </>
    )
}

export default function PublicationPage() {
    const { id } = useParams<{ id: string }>()
    const { t } = useI18n()
    const [project, setProject] = useState<Publication | null>(null)
    const [loading, setLoading] = useState(true)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        clientFetch(`/api/projects/${encodeURIComponent(id)}/publication`, { signal: controller.signal, cache: 'no-store' })
            .then(readApiJson)
            .then(async json => {
                if (!json.success || controller.signal.aborted) return
                const publication = await syncMissingPublicationAuthor(normalizePublication(json.data as Publication), controller.signal).catch(() => normalizePublication(json.data as Publication))
                if (!controller.signal.aborted) setProject(publication)
            })
            .catch(() => {})
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [id, attempt])
    return (
        <div
            className="studio-theme publication-page"
            data-i18n-skip>
            <SiteHeader contentClassName="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <HomeLogoLink />
                    <Link
                        href={`/projects/${id}`}
                        className="publication-back">
                        <ArrowLeft size={16} />
                        {t('返回项目')}
                    </Link>
                </div>
                <Link
                    href="/works"
                    className="publication-back">
                    {t('剧集')}
                    <ExternalLink size={14} />
                </Link>
            </SiteHeader>
            <main className="publication-main">
                {loading ? (
                    <div className="publication-loading">
                        <Loader2 className="animate-spin" />
                        {t('加载中…')}
                    </div>
                ) : project ? (
                    <PublicationEditor
                        key={project.id}
                        initial={project}
                    />
                ) : (
                    <div className="publication-loading">
                        <p>{t('加载失败，请重试')}</p>
                        <button
                            className="studio-secondary"
                            onClick={() => {
                                setLoading(true)
                                setAttempt(value => value + 1)
                            }}>
                            {t('重新加载')}
                        </button>
                    </div>
                )}
            </main>
        </div>
    )
}
