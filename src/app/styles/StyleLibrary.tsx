'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, Check, Globe2, ImagePlus, Loader2, Palette, Plus, Search, X } from 'lucide-react'
import Link, { useRouter } from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import SiteHeader from '@/components/SiteHeader'
import BrandLogo from '@/components/BrandLogo'
import CustomSelect from '@/components/CustomSelect'
import DiagnosticMessage from '@/components/DiagnosticMessage'
import { useCreationAuth } from '../create/useCreationAuth'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getAuthUser } from '@/lib/auth'
import { STYLE_GROUPS, localizeStyleCluster } from '@/lib/drama-creation'
import { getVisualStyle, VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { PROJECT_GENRES } from '@/lib/project-genres'
import type { StyleLibraryEntry } from '@/lib/style-library'
import { matchesStyleReferenceCategory, STYLE_REFERENCE_CATEGORIES } from '@/lib/style-reference-categories'
import LazyStylePreview from '../create/drama/LazyStylePreview'
import styles from './StyleLibrary.module.css'

export default function StyleLibrary({ children }: { children?: ReactNode }) {
    const { t, locale } = useI18n()
    const router = useRouter()
    const params = useSearchParams()
    const { userId, requireAuth } = useCreationAuth()
    const initialStyle = getVisualStyle(params.get('visualStyle') ?? undefined)
    const [selected, setSelected] = useState(params.get('styleLibraryId') ? `custom:${params.get('styleLibraryId')}` : initialStyle.key)
    const [group, setGroup] = useState('all')
    const [query, setQuery] = useState('')
    const [referenceCategory, setReferenceCategory] = useState('all')
    const [library, setLibrary] = useState<{ userId: string; items: StyleLibraryEntry[] } | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)
    const [editor, setEditor] = useState<'style' | 'theme' | null>(null)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [baseStyle, setBaseStyle] = useState(initialStyle.key)
    const [region, setRegion] = useState('')
    const [genre, setGenre] = useState('')
    const [uploads, setUploads] = useState<{ file: File; url: string }[]>([])
    const previewUrls = useRef(new Set<string>())
    const files = uploads.map(item => item.file)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const savingRef = useRef(false)
    const scrollRoot = useRef<HTMLDivElement>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const editorRef = useRef<HTMLElement>(null)
    const items = userId && library?.userId === userId ? library.items : []
    const selectedEntry = selected.startsWith('custom:') ? items.find(item => `custom:${item.id}` === selected) : undefined
    const selectedPreset = selected.startsWith('custom:') ? undefined : getVisualStyle(selected)
    const selectionLabel = selectedEntry?.name ?? (selectedPreset ? t(selectedPreset.label) : '')
    const currentGroup = STYLE_GROUPS.find(item => item.key === group)
    const search = query.trim().toLocaleLowerCase(locale)
    const matches = (...text: (string | null)[]) => !search || text.filter(Boolean).join(' ').toLocaleLowerCase(locale).includes(search)
    const presets =
        group === 'mine'
            ? []
            : VISUAL_STYLE_PRESETS.filter(
                  style =>
                      (!currentGroup || currentGroup.styles.includes(style.key)) &&
                      matchesStyleReferenceCategory(style.key, referenceCategory) &&
                      matches(style.key, style.label, style.hint, t(style.label), t(style.hint))
              )
    const custom = currentGroup ? [] : items.filter(item => matchesStyleReferenceCategory(item.baseStyle, referenceCategory) && matches(item.name, item.description, item.region))

    useEffect(() => {
        if (!userId) return
        const controller = new AbortController()
        const { signal } = controller
        void clientFetch('/api/style-library', { signal })
            .then(readApiJson)
            .then(json => {
                if (signal.aborted) return
                if (!json.success) throw new Error(json.error ?? '加载风格库失败，请重试')
                setLoadError(null)
                setLibrary(current => ({
                    userId,
                    items: [...(current?.userId === userId ? current.items : []), ...(json.data.items as StyleLibraryEntry[])].filter(
                        (entry, index, all) => all.findIndex(other => other.id === entry.id) === index
                    )
                }))
            })
            .catch(cause => {
                if (!signal.aborted) setLoadError(cause instanceof Error ? cause.message : '加载风格库失败，请重试')
            })
            .finally(() => {
                if (!signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [userId, attempt])

    useEffect(() => {
        const urls = previewUrls.current
        return () => urls.forEach(url => URL.revokeObjectURL(url))
    }, [])

    useEffect(() => {
        if (editor) {
            editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            nameRef.current?.focus({ preventScroll: true })
        }
    }, [editor])

    function openEditor(kind: 'style' | 'theme') {
        if (!editor) setBaseStyle(selectedEntry?.baseStyle ?? selectedPreset?.key ?? initialStyle.key)
        setEditor(kind)
        setError(null)
    }

    function addFiles(incoming: File[]) {
        if (files.length + incoming.length > 3) return setError('参考图片最多 3 张')
        if (incoming.some(file => file.size === 0 || file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
            return setError('请上传不超过 10MB 的 JPG、PNG 或 WebP 图片')
        }
        setError(null)
        const additions = incoming.map(file => {
            const url = URL.createObjectURL(file)
            previewUrls.current.add(url)
            return { file, url }
        })
        setUploads(current => [...current, ...additions])
    }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (savingRef.current || !editor) return
        if (!description.trim() && files.length === 0) return setError('请输入描述或上传参考图片')
        savingRef.current = true
        setSaving(true)
        setError(null)
        try {
            if (!(await requireAuth())) return
            const owner = getAuthUser()?.userId
            if (!owner) return
            const body = new FormData()
            for (const [key, value] of Object.entries({ kind: editor, name, description, baseStyle, region: editor === 'theme' ? region : '', genre: editor === 'theme' ? genre : '' }))
                body.set(key, value)
            files.forEach(file => body.append('images', file))
            const json = await readApiJson(await clientFetch('/api/style-library', { method: 'POST', body, timeoutMs: 120_000 }))
            if (!json.success) throw new Error(json.error ?? '保存风格或题材失败，请重试')
            const item = json.data as StyleLibraryEntry
            if (getAuthUser()?.userId !== owner) return
            setLibrary(current => ({
                userId: owner,
                items: [item, ...(current?.userId === owner ? current.items : [])].filter((entry, index, all) => all.findIndex(other => other.id === entry.id) === index)
            }))
            setSelected(`custom:${item.id}`)
            setGroup('mine')
            setQuery('')
            setEditor(null)
            setName('')
            setDescription('')
            setRegion('')
            setGenre('')
            previewUrls.current.forEach(url => URL.revokeObjectURL(url))
            previewUrls.current.clear()
            setUploads([])
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '保存风格或题材失败，请重试')
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }

    function applySelection() {
        if (!selectionLabel) return
        const next = new URLSearchParams({ visualStyle: selectedEntry?.baseStyle ?? selected })
        if (selectedEntry) next.set('styleLibraryId', selectedEntry.id)
        router.push(`/?${next}`)
    }

    return (
        <div data-i18n-skip className={styles.page}>
            <SiteHeader
                sticky
                contentClassName={styles.header}>
                <Link
                    href="/"
                    className={styles.back}>
                    <ArrowLeft size={17} />
                    <BrandLogo size={28} />
                    <span>{t('返回创作')}</span>
                </Link>
            </SiteHeader>
            <main className={styles.main}>
                <nav
                    className={styles.breadcrumb}
                    aria-label={t('艺术风格与地域题材')}>
                    <Link href="/">{t('首页')}</Link>
                    <span aria-hidden="true">/</span>
                    <span aria-current="page">{t('艺术风格与地域题材')}</span>
                </nav>
                <div className={styles.heading}>
                    <div>
                        <div className={styles.eyebrow}>
                            <Palette size={16} />
                            {t('风格库')}
                        </div>
                        <h1>{t('艺术风格与地域题材')}</h1>
                        <p>{t('选择预设或创建自己的风格与题材，上传参考图片并用于短剧创作。')}</p>
                    </div>
                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.secondary}
                            onClick={() => openEditor('theme')}>
                            <Globe2 size={16} />
                            {t('新增题材')}
                        </button>
                        <button
                            type="button"
                            className={styles.primary}
                            onClick={() => openEditor('style')}>
                            <Plus size={17} />
                            {t('新增风格')}
                        </button>
                    </div>
                </div>
                <div className={styles.workspace}>
                    <section
                        className={styles.catalog}
                        aria-label={t('风格库')}>
                        <div className={styles.filters}>
                            <div
                                className={styles.groups}
                                role="group"
                                aria-label={t('风格分类')}>
                                {[
                                    { key: 'all', label: t('全部'), count: VISUAL_STYLE_PRESETS.length + items.length },
                                    { key: 'mine', label: t('我的风格 / 题材'), count: items.length },
                                    ...STYLE_GROUPS.map(item => ({ key: item.key, label: localizeStyleCluster(locale, item).label, count: item.styles.length }))
                                ].map(item => (
                                    <button
                                        type="button"
                                        key={item.key}
                                        aria-pressed={group === item.key}
                                        onClick={() => setGroup(item.key)}>
                                        {item.label}
                                        <small>{item.count}</small>
                                    </button>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <CustomSelect
                                    value={referenceCategory}
                                    onChange={setReferenceCategory}
                                    ariaLabel={t('创作题材')}
                                    searchable
                                    className="w-full sm:w-56"
                                    options={[{ value: 'all', label: t('全部题材') }, ...STYLE_REFERENCE_CATEGORIES.map(item => ({ value: item.key, label: t(item.label) }))]}
                                />
                                <label className={styles.search}>
                                    <Search size={17} />
                                    <input
                                        type="search"
                                        value={query}
                                        onChange={event => setQuery(event.target.value)}
                                        placeholder={t('搜索风格、题材或描述')}
                                        aria-label={t('搜索风格、题材或描述')}
                                    />
                                </label>
                            </div>
                        </div>
                        <div className={styles.catalogHeading}>
                            <p>{currentGroup ? t(currentGroup.hint) : group === 'mine' ? t('保存在本地工作区，随时用于新的创作。') : t('从画面质感到故事地域，找到你的创作方向。')}</p>
                            <span>{presets.length + custom.length}</span>
                        </div>
                        {loadError && (
                            <div
                                className={styles.notice}
                                role="alert">
                                <DiagnosticMessage message={loadError} />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLoading(true)
                                        setLoadError(null)
                                        setAttempt(value => value + 1)
                                    }}>
                                    {t('重试')}
                                </button>
                            </div>
                        )}
                        {(loading || (userId && library?.userId !== userId && !loadError)) && (
                            <p
                                className={styles.notice}
                                role="status">
                                <Loader2
                                    className="animate-spin"
                                    size={16}
                                />
                                {t('加载中...')}
                            </p>
                        )}
                        <div
                            ref={scrollRoot}
                            className={styles.grid}
                            role="group"
                            aria-label={t('视觉风格')}>
                            {custom.map(item => (
                                <button
                                    type="button"
                                    key={item.id}
                                    className={styles.card}
                                    aria-label={item.name}
                                    aria-pressed={selected === `custom:${item.id}`}
                                    onClick={() => setSelected(`custom:${item.id}`)}>
                                    <div className={styles.poster}>
                                        {item.referenceImages[0] ? (
                                            <Image
                                                src={item.referenceImages[0]}
                                                alt={item.name}
                                                fill
                                                unoptimized
                                                sizes="(max-width: 640px) 50vw, 220px"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <LazyStylePreview
                                                style={getVisualStyle(item.baseStyle)}
                                                priority={selected === `custom:${item.id}`}
                                                scrollRoot={scrollRoot}
                                            />
                                        )}
                                        <span className={styles.badge}>{t(item.kind === 'theme' ? '自定义题材' : '自定义风格')}</span>
                                        {selected === `custom:${item.id}` && (
                                            <span className={styles.check}>
                                                <Check size={15} />
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.caption}>
                                        <strong data-i18n-skip>{item.name}</strong>
                                        <p data-i18n-skip>{[item.region, item.description].filter(Boolean).join(' · ') || t('参考图片')}</p>
                                    </div>
                                </button>
                            ))}
                            {presets.map(style => (
                                <button
                                    type="button"
                                    key={style.key}
                                    id={`style-${style.key}`}
                                    className={styles.card}
                                    aria-label={t(style.label)}
                                    aria-pressed={selected === style.key}
                                    onClick={() => setSelected(style.key)}>
                                    <div className={styles.poster}>
                                        <LazyStylePreview
                                            style={style}
                                            priority={selected === style.key}
                                            scrollRoot={scrollRoot}
                                        />
                                        {selected === style.key && (
                                            <span className={styles.check}>
                                                <Check size={15} />
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.caption}>
                                        <strong>{t(style.label)}</strong>
                                        <p>{t(style.hint)}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                        {presets.length + custom.length === 0 && !loading && (
                            <div className={styles.empty}>
                                <Palette size={30} />
                                <h2>{t(query ? '没有找到匹配的风格或题材' : '创建你的第一个风格或题材')}</h2>
                                <p>{t('输入描述或上传参考图片，保存你的创作灵感。')}</p>
                                <button
                                    type="button"
                                    className={styles.secondary}
                                    onClick={() => openEditor('style')}>
                                    <Plus size={16} />
                                    {t('新增风格')}
                                </button>
                            </div>
                        )}
                    </section>
                    {editor && (
                        <aside
                            className={styles.editor}
                            ref={editorRef}
                            aria-labelledby="style-editor-title">
                            <div className={styles.editorHeading}>
                                <h2 id="style-editor-title">{t(editor === 'style' ? '新增风格' : '新增题材')}</h2>
                                <button
                                    type="button"
                                    disabled={saving}
                                    aria-label={t('关闭')}
                                    onClick={() => setEditor(null)}>
                                    <X size={19} />
                                </button>
                            </div>
                            <form onSubmit={save}>
                                <fieldset disabled={saving}>
                                    <legend className="sr-only">{t(editor === 'style' ? '新增风格' : '新增题材')}</legend>
                                    <label htmlFor="style-name">
                                        {t('名称')}
                                        <span>*</span>
                                    </label>
                                    <input
                                        ref={nameRef}
                                        id="style-name"
                                        value={name}
                                        maxLength={80}
                                        required
                                        onChange={event => setName(event.target.value)}
                                        placeholder={t('为你的风格或题材命名')}
                                    />
                                    <label htmlFor="style-description">{t('描述与提示词')}</label>
                                    <textarea
                                        id="style-description"
                                        rows={5}
                                        maxLength={4000}
                                        value={description}
                                        onChange={event => setDescription(event.target.value)}
                                        placeholder={t('描述画面质感、色彩、光影，或故事的地域、时代与人物关系…')}
                                    />
                                    <span className={styles.counter}>{description.length} / 4000</span>
                                    <label>{t('基础视觉风格')}</label>
                                    <CustomSelect
                                        value={baseStyle}
                                        ariaLabel={t('基础视觉风格')}
                                        onChange={setBaseStyle}
                                        options={VISUAL_STYLE_PRESETS.map(item => ({ value: item.key, label: t(item.label) }))}
                                    />
                                    {editor === 'theme' && (
                                        <>
                                            <label htmlFor="style-region">{t('国家、地域与时代')}</label>
                                            <input
                                                id="style-region"
                                                maxLength={100}
                                                value={region}
                                                onChange={event => setRegion(event.target.value)}
                                                placeholder={t('例如：当代上海、19 世纪巴黎')}
                                            />
                                            <label>{t('剧集类型')}</label>
                                            <CustomSelect
                                                value={genre}
                                                ariaLabel={t('剧集类型')}
                                                onChange={setGenre}
                                                options={[{ value: '', label: t('沿用当前设定') }, ...PROJECT_GENRES.map(item => ({ value: item.label, label: t(item.label) }))]}
                                            />
                                        </>
                                    )}
                                    <label htmlFor="style-images">{t('风格参考照片')}</label>
                                    <label
                                        className={styles.upload}
                                        onDragOver={event => event.preventDefault()}
                                        onDrop={event => {
                                            event.preventDefault()
                                            if (!saving) addFiles(Array.from(event.dataTransfer.files))
                                        }}>
                                        <input
                                            id="style-images"
                                            className="sr-only"
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp"
                                            multiple
                                            onChange={event => {
                                                addFiles(Array.from(event.target.files ?? []))
                                                event.target.value = ''
                                            }}
                                        />
                                        <ImagePlus size={25} />
                                        <strong>{t('点击上传或拖入参考照片')}</strong>
                                        <small>{t('JPG、PNG、WebP，最多 3 张，每张不超过 10MB')}</small>
                                    </label>
                                    {uploads.length > 0 && (
                                        <div className={styles.previews}>
                                            {uploads.map(({ url, file }, index) => (
                                                <div key={url}>
                                                    <Image
                                                        src={url}
                                                        alt={file.name}
                                                        width={80}
                                                        height={80}
                                                        unoptimized
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            URL.revokeObjectURL(url)
                                                            previewUrls.current.delete(url)
                                                            setUploads(current => current.filter((_, i) => i !== index))
                                                        }}
                                                        aria-label={t('移除参考图片')}>
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <p className={styles.help}>{t('描述和参考照片至少填写一项；参考照片会用于后续画面生成。')}</p>
                                    {error && (
                                        <p
                                            className={styles.error}
                                            role="alert">
                                            <DiagnosticMessage message={error} />
                                        </p>
                                    )}
                                    <button
                                        className={styles.primary}
                                        type="submit"
                                        disabled={saving || !name.trim() || (!description.trim() && files.length === 0)}>
                                        {saving ? (
                                            <Loader2
                                                size={16}
                                                className="animate-spin"
                                            />
                                        ) : (
                                            <Plus size={16} />
                                        )}
                                        {t(saving ? '保存中...' : '保存并选择')}
                                    </button>
                                </fieldset>
                            </form>
                        </aside>
                    )}
                </div>
                {children}
            </main>
            <footer className={styles.footer}>
                <div>
                    <Check size={18} />
                    <span>{selectionLabel ? t('已选风格：{style}', { style: selectionLabel }) : t('请选择风格或题材')}</span>
                    {selectedEntry && <small>{t(selectedEntry.kind === 'theme' ? '自定义题材' : '自定义风格')}</small>}
                </div>
                <button
                    type="button"
                    disabled={!selectionLabel || saving}
                    className={styles.primary}
                    onClick={applySelection}>
                    {t('应用并返回创作')}
                    <Check size={16} />
                </button>
            </footer>
        </div>
    )
}
