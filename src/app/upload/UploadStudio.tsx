'use client'

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react'
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    Check,
    CheckCircle2,
    Clapperboard,
    CloudUpload,
    FileVideo,
    Film,
    ImagePlus,
    Info,
    LoaderCircle,
    Plus,
    ShieldCheck,
    Sparkles,
    Subtitles,
    Trash2,
    UserRound,
    Users,
    X
} from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import BrandLogo from '@/components/BrandLogo'
import CustomSelect from '@/components/CustomSelect'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import DiagnosticMessage from '@/components/DiagnosticMessage'
import { SITE_NAME } from '@/lib/seo'
import { DRAMA_MAX_EPISODES, validateDramaFile, validateDramaSubtitle, type DramaAsset, type DramaAssetKind } from '@/lib/drama-upload'
import { dramaUploadRequest, uploadDramaAsset } from '@/lib/drama-upload-client'
import CreationModeNav from '../create/CreationModeNav'
import { useCreationAuth } from '../create/useCreationAuth'
import homeStyles from '../HomeStudio.module.css'
import styles from './UploadStudio.module.css'

type LocalAsset = { id: string; file: File; preview: string }
type Episode = { id: string; video: LocalAsset; title: string; subtitle?: LocalAsset }
type Person = { id: string; name: string; role: string; job: string; portrait?: LocalAsset }
const languageOptions = [
    { value: 'zh', label: '简体中文' },
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
    { value: 'ar', label: 'العربية' },
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'hi', label: 'हिन्दी' },
    { value: 'fil', label: 'Filipino' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' }
]
const genres = ['剧情', '爱情', '悬疑', '喜剧', '动作', '科幻', '奇幻', '古装', '动画', '纪录片', '其他']
const sizeLabel = (size: number) => (size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`)

function SectionHeading({ number, icon, title, children }: { number: string; icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <div className={styles.sectionHeading}>
            <span className={styles.sectionIcon}>{icon}</span>
            <div>
                <h2>
                    <span className={styles.number}>{number}</span>
                    {title}
                </h2>
                <p>{children}</p>
            </div>
        </div>
    )
}

export default function UploadStudio() {
    const { t } = useI18n()
    const [revision, setRevision] = useState(0)
    return (
        <div
            className={styles.page}
            data-i18n-skip>
            <SiteHeader
                sticky
                className={homeStyles.header}
                contentClassName={homeStyles.headerContent}>
                <Link
                    href="/"
                    aria-label={SITE_NAME}
                    className={homeStyles.brand}>
                    <BrandLogo />
                    <span translate="no">{SITE_NAME}</span>
                </Link>
                <CreationModeNav
                    mode="upload"
                    showHowToUse
                />
            </SiteHeader>
            <main className={styles.main}>
                <div className={styles.breadcrumb}>
                    <Link href="/">{t('创作中心')}</Link>
                    <span>/</span>
                    <Link href="/uploads">{t('我的上传')}</Link>
                    <span>/</span>
                    <span>{t('上传影视')}</span>
                </div>
                <div className={styles.hero}>
                    <div>
                        <div className={styles.eyebrow}>
                            <span />
                            {t('影视上传工作台')}
                        </div>
                        <h1>{t('让好故事，登上银幕。')}</h1>
                        <p>{t('从第一张封面到最后一集，给你的作品一个完整的舞台。')}</p>
                    </div>
                    <div
                        className={styles.heroArt}
                        aria-hidden="true">
                        <div className={styles.orbit} />
                        <div className={styles.filmTile}>
                            <Clapperboard
                                size={44}
                                strokeWidth={1}
                            />
                            <span>STUDIO</span>
                        </div>
                        <span className={styles.artDot} />
                        <Sparkles
                            className={styles.artSpark}
                            size={20}
                        />
                    </div>
                </div>
                <UploadForm
                    key={revision}
                    onReset={() => setRevision(value => value + 1)}
                />
            </main>
            <SiteFooter />
        </div>
    )
}

function UploadForm({ onReset }: { onReset: () => void }) {
    const { t } = useI18n()
    const { userId, requireAuth, signingIn } = useCreationAuth()
    const [cover, setCover] = useState<LocalAsset>()
    const [episodes, setEpisodes] = useState<Episode[]>([])
    const [cast, setCast] = useState<Person[]>([])
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [genre, setGenre] = useState('')
    const [language, setLanguage] = useState('')
    const [subtitleLanguage, setSubtitleLanguage] = useState('')
    const [year, setYear] = useState('')
    const [dragging, setDragging] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [issues, setIssues] = useState<string[]>([])
    const [progress, setProgress] = useState<Record<string, number>>({})
    const [failedAssetId, setFailedAssetId] = useState('')
    const [active, setActive] = useState('')
    const [savedId, setSavedId] = useState('')
    const videoInput = useRef<HTMLInputElement>(null)
    const urls = useRef(new Set<string>())
    const uploaded = useRef(new Map<File, DramaAsset>())
    const controller = useRef<AbortController | null>(null)
    const locked = useRef(false)
    const priorOwner = useRef(userId)

    useEffect(
        () => () => {
            controller.current?.abort()
            urls.current.forEach(url => URL.revokeObjectURL(url))
        },
        []
    )
    useEffect(() => {
        if (priorOwner.current && priorOwner.current !== userId) {
            controller.current?.abort()
            onReset()
        }
        priorOwner.current = userId
    }, [userId, onReset])
    useEffect(() => {
        if (savedId || !(cover || episodes.length || title || description)) return
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [savedId, cover, episodes.length, title, description])

    const complete = [Boolean(cover), episodes.length > 0, Boolean(title.trim()), Boolean(description.trim())]
    const percent = complete.filter(Boolean).length * 25
    const videoBytes = episodes.reduce((sum, episode) => sum + episode.video.file.size, 0)
    const uploadedVideoBytes = episodes.reduce((sum, episode) => sum + (episode.video.file.size * (progress[episode.video.id] ?? 0)) / 100, 0)
    const videosUploaded = episodes.length > 0 && episodes.every(episode => progress[episode.video.id] === 100)
    const videoPercent = videoBytes ? Math.min(videosUploaded ? 100 : 99, Math.floor((uploadedVideoBytes / videoBytes) * 100)) : 0
    const uploadAssets = [cover, ...episodes.flatMap(episode => [episode.video, episode.subtitle]), ...cast.map(person => person.portrait)]
    const uploadFailed = uploadAssets.some(item => item?.id === failedAssetId)
    const activeAsset = uploadAssets.find(item => item?.id === active)
    const uploadLabel = busy ? (signingIn ? '等待登录' : active === 'saving' ? '正在保存…' : '正在上传…') : uploadFailed ? '上传失败，请稍后重试' : videosUploaded ? '已上传' : '等待上传'
    function asset(file: File): LocalAsset {
        const preview = URL.createObjectURL(file)
        urls.current.add(preview)
        return { id: crypto.randomUUID(), file, preview }
    }
    function release(item?: LocalAsset) {
        if (item) {
            URL.revokeObjectURL(item.preview)
            urls.current.delete(item.preview)
        }
    }
    function selectImage(event: ChangeEvent<HTMLInputElement>, kind: 'cover' | 'portrait', personId?: string) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const invalid = validateDramaFile(kind, file)
        if (invalid) {
            setError(t(invalid))
            return
        }
        const next = asset(file)
        if (kind === 'cover') {
            release(cover)
            setCover(next)
        } else
            setCast(current =>
                current.map(person => {
                    if (person.id !== personId) return person
                    release(person.portrait)
                    return { ...person, portrait: next }
                })
            )
        setError('')
    }
    function addVideos(files: File[]) {
        if (locked.current || savedId) return
        if (episodes.length + files.length > DRAMA_MAX_EPISODES) {
            setError(t('最多上传 500 集'))
            return
        }
        const accepted: Episode[] = []
        let invalid = ''
        for (const file of files) {
            const issue = validateDramaFile('video', file)
            if (issue) {
                invalid = `${file.name}: ${t(issue)}`
                continue
            }
            if ([...episodes, ...accepted].some(item => item.video.file.name === file.name && item.video.file.size === file.size && item.video.file.lastModified === file.lastModified)) {
                invalid = t('已跳过重复视频')
                continue
            }
            accepted.push({ id: crypto.randomUUID(), video: asset(file), title: file.name.replace(/\.[^.]+$/, '') })
        }
        accepted.sort((a, b) => a.video.file.name.localeCompare(b.video.file.name, undefined, { numeric: true }))
        setEpisodes(current => [...current, ...accepted])
        setError(invalid)
    }
    async function selectSubtitle(event: ChangeEvent<HTMLInputElement>, id: string) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const invalid = validateDramaFile('subtitle', file) || validateDramaSubtitle(file.name, new Uint8Array(await file.arrayBuffer()))
        if (invalid) {
            setError(t(invalid))
            return
        }
        if (locked.current) return
        const next = asset(file)
        setEpisodes(current =>
            current.map(episode => {
                if (episode.id !== id) return episode
                release(episode.subtitle)
                return { ...episode, subtitle: next }
            })
        )
        setError('')
    }
    function move(index: number, offset: number) {
        setEpisodes(current => {
            const next = [...current]
            ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
            return next
        })
    }
    function drop(event: DragEvent) {
        event.preventDefault()
        setDragging(false)
        addVideos(Array.from(event.dataTransfer.files))
    }
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (locked.current || savedId) return
        const missing = ['cover', 'episodes', 'title', 'description'].filter((_, index) => !complete[index])
        setIssues(missing)
        setError('')
        if (missing.length) {
            document.getElementById(`upload-${missing[0]}`)?.focus()
            return
        }
        locked.current = true
        setFailedAssetId('')
        setBusy(true)
        const abort = new AbortController()
        controller.current = abort
        try {
            if (!(await requireAuth()) || abort.signal.aborted) return
            async function send(item: LocalAsset, kind: DramaAssetKind) {
                const previous = uploaded.current.get(item.file)
                if (previous) return previous.receipt
                setActive(item.id)
                try {
                    const result = await uploadDramaAsset(item.file, kind, abort.signal, value => setProgress(current => ({ ...current, [item.id]: value })))
                    uploaded.current.set(item.file, result)
                    return result.receipt
                } catch (failure) {
                    if (!abort.signal.aborted) setFailedAssetId(item.id)
                    throw failure
                }
            }
            const coverReceipt = await send(cover!, 'cover')
            const savedEpisodes = []
            for (const episode of episodes)
                savedEpisodes.push({ title: episode.title, video: await send(episode.video, 'video'), subtitle: episode.subtitle ? await send(episode.subtitle, 'subtitle') : undefined })
            const savedCast = []
            for (const person of cast) savedCast.push({ name: person.name, role: person.role, job: person.job, portrait: person.portrait ? await send(person.portrait, 'portrait') : undefined })
            setActive('saving')
            const result = await dramaUploadRequest<{ id: string }>('/api/drama-uploads', {
                method: 'POST',
                body: JSON.stringify({ title, description, genre, language, subtitleLanguage, year: year ? Number(year) : undefined, cover: coverReceipt, episodes: savedEpisodes, cast: savedCast }),
                signal: abort.signal
            })
            setSavedId(result.id)
        } catch (failure) {
            if (!abort.signal.aborted) setError(t(failure instanceof Error ? failure.message : '保存失败，请稍后重试'))
        } finally {
            if (!abort.signal.aborted) {
                setBusy(false)
                setActive('')
                locked.current = false
            }
        }
    }
    function uploadStatus(item: LocalAsset) {
        const value = progress[item.id]
        const uploading = busy && active === item.id
        const failed = failedAssetId === item.id
        return (
            <span className={`${styles.fileStatus} ${failed ? styles.uploadFailed : ''}`}>
                {value === 100 ? (
                    <Check size={13} />
                ) : uploading ? (
                    <LoaderCircle
                        size={13}
                        className={styles.spin}
                    />
                ) : null}
                {value === 100 ? t('已上传') : uploading ? `${value ?? 0}%` : failed ? t('上传失败，请稍后重试') : t('等待上传')}
            </span>
        )
    }
    function select(value: string, set: (value: string) => void, label: string, options = languageOptions) {
        return (
            <CustomSelect
                value={value}
                onChange={set}
                ariaLabel={label}
                placeholder={t('请选择（可选）')}
                options={[{ value: '', label: t('暂不填写') }, ...options.map(option => ({ ...option, label: t(option.label) }))]}
                buttonClassName={styles.select}
                searchable
                disabled={busy || Boolean(savedId)}
            />
        )
    }
    const badge = <span className={styles.optional}>{t('选填')}</span>

    return (
        <form
            onSubmit={save}
            className={styles.workspace}>
            <div className={styles.formBody}>
                <fieldset
                    disabled={busy || Boolean(savedId)}
                    className={styles.fieldset}>
                    <section className={styles.section}>
                        <SectionHeading
                            number="01"
                            icon={<Film size={20} />}
                            title={t('影视资源')}>
                            {t('上传一张封面，添加你的完整剧集。')}
                            <span className={styles.required}>*</span>
                        </SectionHeading>
                        <div className={styles.mediaGrid}>
                            <div>
                                <label className={styles.label}>
                                    {t('作品封面')}
                                    <span className={styles.required}>*</span>
                                </label>
                                <label className={`${styles.coverUpload} ${issues.includes('cover') && !cover ? styles.invalid : ''}`}>
                                    <input
                                        id="upload-cover"
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={event => selectImage(event, 'cover')}
                                        aria-label={t('上传作品封面')}
                                        aria-invalid={issues.includes('cover') && !cover}
                                    />
                                    {cover ? (
                                        <>
                                            <OptimizedMediaImage
                                                src={cover.preview}
                                                alt={t('作品封面预览')}
                                                width={440}
                                                height={660}
                                                className={styles.coverImage}
                                            />
                                            <span className={styles.coverReplace}>
                                                <ImagePlus size={15} />
                                                {t('更换封面')}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className={styles.uploadIcon}>
                                                <ImagePlus
                                                    size={24}
                                                    strokeWidth={1.5}
                                                />
                                            </span>
                                            <strong>{t('上传封面')}</strong>
                                            <span>JPG / PNG / WebP</span>
                                            <small>{t('建议 2:3，最大 10MB')}</small>
                                        </>
                                    )}
                                </label>
                                {cover && (
                                    <div className={styles.mediaCaption}>
                                        <span title={cover.file.name}>{cover.file.name}</span>
                                        {uploadStatus(cover)}
                                    </div>
                                )}
                            </div>
                            <div className={styles.videoArea}>
                                <label className={styles.label}>
                                    {t('剧集视频')}
                                    <span className={styles.required}>*</span>
                                    <small>{t('支持批量或逐集添加')}</small>
                                </label>
                                <div
                                    className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${issues.includes('episodes') && !episodes.length ? styles.invalid : ''}`}
                                    onDragOver={event => {
                                        event.preventDefault()
                                        if (!busy && !savedId) setDragging(true)
                                    }}
                                    onDragLeave={() => setDragging(false)}
                                    onDrop={drop}>
                                    {episodes.length > 0 ? (
                                        <div className={styles.uploadSummary}>
                                            <div className={styles.uploadSummaryHeading}>
                                                <strong>{t('上传进度')}</strong>
                                                <span>{videoPercent}%</span>
                                            </div>
                                            <progress
                                                className={styles.uploadProgress}
                                                value={videoPercent}
                                                max={100}
                                                aria-label={`${t('剧集视频')} ${t('上传进度')}`}
                                            />
                                            <div className={styles.uploadSummaryMeta}>
                                                <span
                                                    className={uploadFailed ? styles.uploadFailed : undefined}
                                                    role="status">
                                                    {t(uploadLabel)}
                                                </span>
                                                <span>{`${sizeLabel(uploadedVideoBytes)} / ${sizeLabel(videoBytes)}`}</span>
                                            </div>
                                            {(!videosUploaded || busy) && (
                                                <p
                                                    className={styles.uploadSummaryDetail}
                                                    title={activeAsset?.file.name}>
                                                    {busy ? activeAsset?.file.name || t(active === 'saving' ? '正在保存…' : '等待登录') : t('点击「上传并保存」后开始上传')}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            <span className={styles.cloudIcon}>
                                                <CloudUpload
                                                    size={32}
                                                    strokeWidth={1.4}
                                                />
                                            </span>
                                            <strong>{t('将剧集拖到这里')}</strong>
                                            <p>{t('一次上传多集，也可以随时追加单集')}</p>
                                        </>
                                    )}
                                    <label className={styles.chooseButton}>
                                        <Plus size={16} />
                                        {t(episodes.length ? '追加剧集' : '选择视频')}
                                        <input
                                            ref={videoInput}
                                            id="upload-episodes"
                                            type="file"
                                            multiple
                                            accept=".mp4,.mov,.webm"
                                            aria-label={t('选择剧集视频')}
                                            onChange={event => {
                                                addVideos(Array.from(event.target.files ?? []))
                                                event.target.value = ''
                                            }}
                                            aria-invalid={issues.includes('episodes') && !episodes.length}
                                        />
                                    </label>
                                    <small>{episodes.length ? t('共 {count} 集', { count: episodes.length }) : t('MP4 / MOV / WebM · 单集最大 2GB')}</small>
                                </div>
                            </div>
                        </div>
                        {episodes.length > 0 && (
                            <div className={styles.episodeList}>
                                <div className={styles.listHeading}>
                                    <span>
                                        {t('剧集列表')}
                                        <b>{episodes.length}</b>
                                    </span>
                                    <small>{t('按文件名排序，可手动调整顺序')}</small>
                                    <button
                                        type="button"
                                        onClick={() => videoInput.current?.click()}>
                                        <Plus size={14} />
                                        {t('追加剧集')}
                                    </button>
                                </div>
                                {episodes.map((episode, index) => (
                                    <div
                                        key={episode.id}
                                        className={styles.episode}>
                                        <span className={styles.episodeNumber}>{String(index + 1).padStart(2, '0')}</span>
                                        <div className={styles.episodeDetails}>
                                            <input
                                                aria-label={`${t('剧集标题')} ${index + 1}`}
                                                value={episode.title}
                                                maxLength={255}
                                                onChange={event => setEpisodes(current => current.map(item => (item.id === episode.id ? { ...item, title: event.target.value } : item)))}
                                            />
                                            <div>
                                                <span title={episode.video.file.name}>{episode.video.file.name}</span>
                                                <small>{sizeLabel(episode.video.file.size)}</small>
                                                {uploadStatus(episode.video)}
                                            </div>
                                            <div className={styles.subtitleRow}>
                                                <label className={styles.subtitleButton}>
                                                    <Subtitles size={14} />
                                                    {episode.subtitle ? episode.subtitle.file.name : t('添加字幕（可选）')}
                                                    <input
                                                        type="file"
                                                        accept=".srt,.vtt"
                                                        aria-label={`${t('上传字幕')} ${index + 1}`}
                                                        onChange={event => void selectSubtitle(event, episode.id)}
                                                    />
                                                </label>
                                                {episode.subtitle && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            aria-label={t('移除字幕')}
                                                            onClick={() => {
                                                                release(episode.subtitle)
                                                                setEpisodes(current => current.map(item => (item.id === episode.id ? { ...item, subtitle: undefined } : item)))
                                                            }}>
                                                            <X size={13} />
                                                        </button>
                                                        {uploadStatus(episode.subtitle)}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className={styles.episodeActions}>
                                            <button
                                                type="button"
                                                disabled={index === 0}
                                                aria-label={t('上移剧集')}
                                                onClick={() => move(index, -1)}>
                                                <ArrowUp size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={index === episodes.length - 1}
                                                aria-label={t('下移剧集')}
                                                onClick={() => move(index, 1)}>
                                                <ArrowDown size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={t('移除剧集')}
                                                onClick={() => {
                                                    release(episode.video)
                                                    release(episode.subtitle)
                                                    setEpisodes(current => current.filter(item => item.id !== episode.id))
                                                }}>
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                        <progress
                                            className={styles.fileProgress}
                                            value={progress[episode.video.id] ?? 0}
                                            max={100}
                                            aria-label={`${t('上传进度')} ${index + 1}`}
                                        />
                                    </div>
                                ))}
                                <p className={styles.subtitleHelp}>
                                    <Info size={13} />
                                    {t('字幕支持 UTF-8 编码的 SRT / VTT，最大 1MB；需包含有效时间轴。')}
                                </p>
                            </div>
                        )}
                    </section>
                    <section className={styles.section}>
                        <SectionHeading
                            number="02"
                            icon={<FileVideo size={20} />}
                            title={t('作品资料')}>
                            {t('用标题和简介，让观众走进你的故事。')}
                        </SectionHeading>
                        <div className={styles.field}>
                            <label
                                htmlFor="upload-title"
                                className={styles.label}>
                                {t('作品标题')}
                                <span className={styles.required}>*</span>
                                <small>Title</small>
                            </label>
                            <input
                                id="upload-title"
                                value={title}
                                onChange={event => setTitle(event.target.value)}
                                placeholder={t('为你的故事起一个名字')}
                                maxLength={255}
                                aria-invalid={issues.includes('title') && !title.trim()}
                            />
                            <span className={styles.counter}>{title.length} / 255</span>
                        </div>
                        <div className={styles.field}>
                            <label
                                htmlFor="upload-description"
                                className={styles.label}>
                                {t('作品简介')}
                                <span className={styles.required}>*</span>
                                <small>Description</small>
                            </label>
                            <textarea
                                id="upload-description"
                                value={description}
                                onChange={event => setDescription(event.target.value)}
                                placeholder={t('介绍故事背景、主要人物与剧情亮点…')}
                                maxLength={20_000}
                                rows={4}
                                aria-invalid={issues.includes('description') && !description.trim()}
                            />
                            <span className={styles.counter}>{description.length} / 20000</span>
                        </div>
                        <div className={styles.detailsGrid}>
                            <div>
                                <span className={styles.label}>
                                    {t('影视类型')}
                                    {badge}
                                </span>
                                {select(
                                    genre,
                                    setGenre,
                                    t('影视类型'),
                                    genres.map(value => ({ value, label: value }))
                                )}
                            </div>
                            <div>
                                <span className={styles.label}>
                                    {t('原声语言')}
                                    {badge}
                                </span>
                                {select(language, setLanguage, t('原声语言'))}
                            </div>
                            <div>
                                <span className={styles.label}>
                                    {t('字幕语言')}
                                    {badge}
                                </span>
                                {select(subtitleLanguage, setSubtitleLanguage, t('字幕语言'))}
                            </div>
                            <div>
                                <label
                                    htmlFor="upload-year"
                                    className={styles.label}>
                                    {t('上映年份')}
                                    {badge}
                                </label>
                                <input
                                    id="upload-year"
                                    type="number"
                                    min={1888}
                                    max={new Date().getFullYear() + 5}
                                    value={year}
                                    onChange={event => setYear(event.target.value)}
                                    placeholder={t('例如 2026')}
                                />
                            </div>
                        </div>
                    </section>
                    <section className={styles.section}>
                        <SectionHeading
                            number="03"
                            icon={<Users size={20} />}
                            title={t('演职人员')}>
                            {t('记录台前幕后，为每一份创作署名。')}
                            {badge}
                        </SectionHeading>
                        {cast.length === 0 && (
                            <div className={styles.castEmpty}>
                                <Users
                                    size={24}
                                    strokeWidth={1.2}
                                />
                                <span>{t('添加演员、导演及其他主创人员')}</span>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => setCast([{ id: crypto.randomUUID(), name: '', role: '', job: '' }])}>
                                    <Plus size={15} />
                                    {t('添加演职人员')}
                                </button>
                            </div>
                        )}
                        {cast.map(person => (
                            <div
                                key={person.id}
                                className={styles.person}>
                                <label className={styles.portrait}>
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        aria-label={t('上传人员图片')}
                                        onChange={event => selectImage(event, 'portrait', person.id)}
                                    />
                                    {person.portrait ? (
                                        <OptimizedMediaImage
                                            src={person.portrait.preview}
                                            alt={t('演职人员图片')}
                                            width={124}
                                            height={144}
                                        />
                                    ) : (
                                        <>
                                            <UserRound size={22} />
                                            <small>{t('上传图片')}</small>
                                        </>
                                    )}
                                </label>
                                <div className={styles.personFields}>
                                    {(['name', 'role', 'job'] as const).map(key => (
                                        <label key={key}>
                                            <span>{t(key === 'name' ? '演职人员名' : key === 'role' ? '角色名' : '职务')}</span>
                                            <input
                                                value={person[key]}
                                                aria-label={t(key === 'name' ? '演职人员名' : key === 'role' ? '角色名' : '职务')}
                                                maxLength={100}
                                                placeholder={t(key === 'name' ? '姓名' : key === 'role' ? '饰演角色（可选）' : '演员 / 导演 / 编剧')}
                                                onChange={event => setCast(current => current.map(item => (item.id === person.id ? { ...item, [key]: event.target.value } : item)))}
                                            />
                                        </label>
                                    ))}
                                </div>
                                <div>
                                    {person.portrait && uploadStatus(person.portrait)}
                                    <button
                                        type="button"
                                        className={styles.removePerson}
                                        aria-label={t('移除人员')}
                                        onClick={() => {
                                            release(person.portrait)
                                            setCast(current => current.filter(item => item.id !== person.id))
                                        }}>
                                        <X size={17} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {cast.length > 0 && cast.length < 100 && (
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => setCast(current => [...current, { id: crypto.randomUUID(), name: '', role: '', job: '' }])}>
                                <Plus size={15} />
                                {t('添加演职人员')}
                            </button>
                        )}
                    </section>
                </fieldset>
                <div className={styles.copyright}>
                    <ShieldCheck size={22} />
                    <div>
                        <strong>{t('创作有边界，版权需尊重')}</strong>
                        <p>{t('请仅上传你拥有版权或已获授权的资源。')}</p>
                    </div>
                </div>
                <div aria-live="polite">
                    {issues.length > 0 && !complete.every(Boolean) && (
                        <p
                            className={styles.error}
                            role="alert">
                            {t('请补全必填项：封面、剧集视频、标题和简介。')}
                        </p>
                    )}
                    {error && (
                        <p
                            className={styles.error}
                            role="alert">
                            <DiagnosticMessage message={error} />
                        </p>
                    )}
                    {savedId && (
                        <div
                            className={styles.success}
                            role="status">
                            <CheckCircle2 size={24} />
                            <div>
                                <strong>{t('作品已保存')}</strong>
                                <p>{t('资源和资料已保存，可在「我的上传」中查看。')}</p>
                                <Link href={`/uploads/${savedId}`}>
                                    {t('查看作品')}
                                    <ArrowRight size={15} />
                                </Link>
                                <button
                                    type="button"
                                    onClick={onReset}>
                                    {t('继续上传新作品')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <div className={styles.saveBar}>
                    <span>
                        <ShieldCheck size={15} />
                        {t('保存后仅自己可见')}
                    </span>
                    <button
                        type="submit"
                        className={styles.saveButton}
                        disabled={busy || Boolean(savedId)}>
                        {busy ? (
                            <LoaderCircle
                                size={17}
                                className={styles.spin}
                            />
                        ) : (
                            <CloudUpload size={17} />
                        )}
                        {busy ? t(signingIn ? '等待登录' : active === 'saving' ? '正在保存…' : '正在上传…') : t(savedId ? '已保存' : '上传并保存')}
                        <ArrowRight size={16} />
                    </button>
                </div>
            </div>
            <aside className={styles.sidebar}>
                <div className={styles.previewPanel}>
                    <div className={styles.panelEyebrow}>
                        <span />
                        {t('作品预览')}
                        <span>LIVE</span>
                    </div>
                    <div className={styles.poster}>
                        {cover ? (
                            <OptimizedMediaImage
                                src={cover.preview}
                                alt={t('作品预览')}
                                width={568}
                                height={852}
                            />
                        ) : (
                            <div className={styles.posterPlaceholder}>
                                <Film
                                    size={44}
                                    strokeWidth={0.8}
                                />
                                <span>{t('你的故事，即将上演')}</span>
                            </div>
                        )}
                        <div className={styles.posterOverlay}>
                            <span className={styles.posterBadge}>
                                <Clapperboard size={12} />
                                {t('原创作品')}
                            </span>
                            <h3 dir="auto">{title.trim() || t('未命名作品')}</h3>
                            <p>
                                {genre ? t(genre) : t('影视作品')}
                                <span>·</span>
                                {t('共 {count} 集', { count: episodes.length })}
                                {year && ` · ${year}`}
                            </p>
                        </div>
                    </div>
                    <p
                        className={styles.previewDescription}
                        dir="auto">
                        {description.trim() || t('每一个精彩故事，都值得被看见。')}
                    </p>
                </div>
                <div className={styles.checklist}>
                    <div className={styles.checklistHeading}>
                        <strong>{t('必填项完成度')}</strong>
                        <span>
                            {percent}
                            <small>%</small>
                        </span>
                    </div>
                    <progress
                        value={percent}
                        max={100}
                        aria-label={t('必填项完成度')}
                    />
                    {['作品封面', '剧集视频', '作品标题', '作品简介'].map((label, index) => (
                        <div key={label}>
                            <span className={complete[index] ? styles.checked : styles.unchecked}>{complete[index] && <Check size={11} />}</span>
                            <span>{t(label)}</span>
                            <small>{t(complete[index] ? '已就绪' : '待完善')}</small>
                        </div>
                    ))}
                    <p>
                        <Info size={14} />
                        {t('其余信息均为选填，可按需完善。')}
                    </p>
                </div>
                <div className={styles.tips}>
                    <Subtitles size={20} />
                    <strong>{t('字幕小贴士')}</strong>
                    <p>{t('字幕按集上传，请将文件添加到对应剧集。添加前会自动校验格式和时间轴。')}</p>
                    <div>
                        <span>.SRT</span>
                        <span>.VTT</span>
                        <span>UTF-8</span>
                    </div>
                </div>
            </aside>
        </form>
    )
}
