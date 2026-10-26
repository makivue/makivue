'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Clapperboard, ImagePlus, Loader2, Palette, Sparkles } from 'lucide-react'
import Link, { useRouter } from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { localeDisplayName, locales, type Locale } from '@/i18n/config'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import HomeLogoLink from '@/components/HomeLogoLink'
import CustomSelect from '@/components/CustomSelect'
import DiagnosticMessage from '@/components/DiagnosticMessage'
import CreationModeNav from '../create/CreationModeNav'
import { useCreationAuth } from '../create/useCreationAuth'
import { useCreatorState } from '../create/CreatorSessionProvider'
import type { CreatorAsset } from '../create/creator-session'
import { ANIME_STYLES, EMPTY_ANIME_DRAFT, buildAnimeImagePrompt, buildAnimeProject, parseAnimeDraft, type AnimeDraft, type AnimeImagePurpose } from '@/lib/anime-studio'
import { getVisualStyle } from '@/lib/novel'
import { getStylePreviewSrc } from '@/lib/style-preview'
import { isProjectEpisodeCount, MAX_PROJECT_EPISODES } from '@/lib/project-metadata'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { getAuthUser } from '@/lib/auth'
import styles from './AnimeStudio.module.css'

const DRAFT_KEY = 'anime-studio-draft-v1'
const PURPOSES = [
    { value: 'character', label: '角色设定图' },
    { value: 'frame', label: '分镜关键帧' },
    { value: 'poster', label: '二次元海报' }
] as const

export default function AnimeStudio() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const { userId, requireAuth } = useCreationAuth()
    const [draft, setDraft] = useState<AnimeDraft>({ ...EMPTY_ANIME_DRAFT })
    const [ready, setReady] = useState(false)
    const [mode, setMode] = useState<'project' | 'image'>('project')
    const [language, setLanguage] = useState<Locale>(locale)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [assetsError, setAssetsError] = useState<string | null>(null)
    const [assetsLoading, setAssetsLoading] = useState(false)
    const [assets, setAssets] = useState<CreatorAsset[]>([])
    const [assetOwnerId, setAssetOwnerId] = useState<string | null>(null)
    const [selected, setSelected] = useState<string[]>([])
    const busy = useRef(false)
    const [, setPrompt] = useCreatorState('image', 'prompt')
    const [, setRatios] = useCreatorState('image', 'ratios')
    const [, setReference] = useCreatorState('image', 'referenceAsset')
    const [, setFiles] = useCreatorState('image', 'files')
    const [, setReferenceVideos] = useCreatorState('image', 'referenceVideos')
    const imagePrompt = buildAnimeImagePrompt(draft)
    const valid = Boolean(draft.story.trim()) && (mode === 'project' || imagePrompt.length <= 4000)
    const style = getVisualStyle(draft.style)

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                setDraft(parseAnimeDraft(sessionStorage.getItem(DRAFT_KEY)))
            } catch {
                /* Storage may be disabled. */
            }
            setReady(true)
        }, 0)
        return () => window.clearTimeout(timer)
    }, [])
    useEffect(() => {
        if (ready)
            try {
                sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
            } catch {
                /* Draft editing still works. */
            }
    }, [draft, ready])
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setSelected([])
            setAssets([])
            setAssetsError(null)
        }, 0)
        return () => window.clearTimeout(timer)
    }, [userId])

    function update<K extends keyof AnimeDraft>(key: K, value: AnimeDraft[K]) {
        setDraft(current => ({ ...current, [key]: value }))
        setError(null)
    }

    async function loadReferences() {
        setAssetsLoading(true)
        setAssetsError(null)
        try {
            if (!(await requireAuth())) return
            const ownerId = getAuthUser()?.userId ?? null
            const response = await clientFetch('/api/create/assets?type=image&limit=60')
            const json = await readApiJson(response)
            if (!response.ok || !json.success) throw new Error(json.error || '作品加载失败')
            if (getAuthUser()?.userId !== ownerId) return
            setAssetOwnerId(ownerId)
            setAssets(json.data.items)
        } catch (err) {
            setAssetsError(err instanceof Error ? err.message : String(err))
        } finally {
            setAssetsLoading(false)
        }
    }

    async function submit(event: FormEvent) {
        event.preventDefault()
        if (!valid || busy.current) return
        if (mode === 'project' && !isProjectEpisodeCount(draft.episodes)) {
            setError('章节数必须是 1-500 的整数')
            return
        }
        busy.current = true
        setCreating(true)
        setError(null)
        try {
            if (mode === 'image') {
                setPrompt(imagePrompt)
                setRatios([draft.purpose === 'character' ? '16:9' : draft.ratio])
                setFiles([])
                setReferenceVideos([])
                setReference(assetOwnerId === userId ? (assets.find(asset => selected.includes(asset.id)) ?? null) : null)
                router.push('/aiimage?studio=anime')
                return
            }
            if (!(await requireAuth())) return
            const response = await clientFetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildAnimeProject(draft, language, assetOwnerId === userId ? selected : []))
            })
            const json = await readApiJson(response)
            if (!response.ok || !json.success || !json.data?.id) throw new Error(json.error || '项目创建失败')
            router.push(`/projects/${json.data.id}`)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            busy.current = false
            setCreating(false)
        }
    }

    return (
        <div
            className={styles.page}
            data-i18n-skip>
            <SiteHeader
                sticky
                contentClassName={styles.header}>
                <HomeLogoLink />
                <CreationModeNav mode="anime" />
            </SiteHeader>
            <main className={styles.main}>
                <div className={styles.intro}>
                    <span className={styles.eyebrow}>
                        <Sparkles size={14} /> ANIME STUDIO
                    </span>
                    <h1>{t('漫剧与二次元创作')}</h1>
                    <p>{t('从角色设定到分镜与成片，创作你的原创动画。')}</p>
                </div>
                <div className={styles.workspace}>
                    <form
                        onSubmit={submit}
                        className={styles.composer}>
                        <fieldset
                            disabled={creating || !ready}
                            className={styles.fields}>
                            <legend className="sr-only">{t('创作内容')}</legend>
                            <div
                                className={styles.modeGroup}
                                role="group"
                                aria-label={t('创作类型')}>
                                <button
                                    type="button"
                                    aria-pressed={mode === 'project'}
                                    onClick={() => {
                                        setMode('project')
                                        setError(null)
                                    }}>
                                    <Clapperboard size={17} />
                                    {t('漫剧项目')}
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={mode === 'image'}
                                    onClick={() => {
                                        setMode('image')
                                        setSelected(current => current.slice(0, 1))
                                        setError(null)
                                    }}>
                                    <ImagePlus size={17} />
                                    {t('二次元图片')}
                                </button>
                            </div>
                            {mode === 'project' && (
                                <div className={styles.field}>
                                    <label htmlFor="anime-title">{t('项目名称')}</label>
                                    <input
                                        id="anime-title"
                                        maxLength={255}
                                        value={draft.title}
                                        onChange={e => update('title', e.target.value)}
                                        placeholder={t('留空时使用故事开头')}
                                    />
                                </div>
                            )}
                            {mode === 'image' && (
                                <CustomSelect
                                    ariaLabel={t('图片用途')}
                                    value={draft.purpose}
                                    onChange={value => update('purpose', value as AnimeImagePurpose)}
                                    options={PURPOSES.map(item => ({ ...item, label: t(item.label) }))}
                                />
                            )}
                            <div className={styles.field}>
                                <label htmlFor="anime-story">
                                    {t(mode === 'project' ? '故事创意' : '画面描述')}
                                    <span>{draft.story.length.toLocaleString()} / 18,000</span>
                                </label>
                                <textarea
                                    id="anime-story"
                                    rows={5}
                                    maxLength={18000}
                                    required
                                    value={draft.story}
                                    onChange={e => update('story', e.target.value)}
                                    placeholder={t('写下故事、剧本片段或想创作的画面…')}
                                />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="anime-character">
                                    {t('角色与场景设定')}
                                    <span>{t('可选')}</span>
                                </label>
                                <textarea
                                    id="anime-character"
                                    rows={2}
                                    maxLength={1000}
                                    value={draft.character}
                                    onChange={e => update('character', e.target.value)}
                                    placeholder={t('固定发型、服装、道具与场景，保持镜头之间一致。')}
                                />
                            </div>
                            <div className={styles.options}>
                                <CustomSelect
                                    ariaLabel={t('视频比例')}
                                    value={draft.ratio}
                                    onChange={value => update('ratio', value as AnimeDraft['ratio'])}
                                    options={[
                                        { value: '9:16', label: t('9:16 竖屏') },
                                        { value: '16:9', label: t('16:9 横屏') },
                                        { value: '1:1', label: t('1:1 方形') }
                                    ]}
                                />
                                {mode === 'project' && (
                                    <>
                                        <label className={styles.episodeCount}>
                                            <span className="sr-only">{t('集数')}</span>
                                            <input
                                                type="number"
                                                min={1}
                                                max={MAX_PROJECT_EPISODES}
                                                step={1}
                                                required
                                                value={Number.isNaN(draft.episodes) ? '' : draft.episodes}
                                                onChange={event => update('episodes', event.target.valueAsNumber)}
                                                onInvalid={() => setError('章节数必须是 1-500 的整数')}
                                            />
                                            <span aria-hidden="true">{t('集')}</span>
                                        </label>
                                        <CustomSelect
                                            ariaLabel={t('创作内容语言')}
                                            value={language}
                                            onChange={value => setLanguage(value as Locale)}
                                            options={locales.map(value => ({ value, label: localeDisplayName(locale, value) }))}
                                        />
                                    </>
                                )}
                            </div>
                            <details className={styles.references}>
                                <summary>
                                    {t('参考作品')}
                                    <span>
                                        {selected.length} / {mode === 'image' ? 1 : 3}
                                    </span>
                                </summary>
                                <p>{t('选择已生成的图片，用作角色或画风参考。')}</p>
                                <button
                                    type="button"
                                    className={styles.secondary}
                                    onClick={() => void loadReferences()}
                                    disabled={assetsLoading}>
                                    {assetsLoading ? (
                                        <Loader2
                                            size={14}
                                            className="animate-spin"
                                        />
                                    ) : (
                                        <ImagePlus size={14} />
                                    )}
                                    {t('加载我的图片')}
                                </button>
                                {assetsError && (
                                    <p role="alert">
                                        <DiagnosticMessage message={assetsError} />
                                    </p>
                                )}
                                <div className={styles.assets}>
                                    {(assetOwnerId === userId ? assets : []).map(asset => (
                                        <button
                                            key={asset.id}
                                            type="button"
                                            aria-label={t('参考作品') + ' ' + asset.id}
                                            aria-pressed={selected.includes(asset.id)}
                                            onClick={() =>
                                                setSelected(current =>
                                                    current.includes(asset.id)
                                                        ? current.filter(id => id !== asset.id)
                                                        : mode === 'image'
                                                          ? [asset.id]
                                                          : current.length < 3
                                                            ? [...current, asset.id]
                                                            : current
                                                )
                                            }
                                            style={{ backgroundImage: `url(${JSON.stringify(asset.url)})` }}>
                                            {selected.includes(asset.id) && <Check size={18} />}
                                        </button>
                                    ))}
                                </div>
                                {!assetsLoading && assets.length === 0 && <p>{t('先创作角色设定图，再返回这里继续制作。')}</p>}
                            </details>
                            {mode === 'image' && imagePrompt.length > 4000 && (
                                <p
                                    role="alert"
                                    className={styles.error}>
                                    {t('图片描述过长，请缩短故事或角色设定。')}
                                </p>
                            )}
                            {error && (
                                <p
                                    role="alert"
                                    className={styles.error}>
                                    <DiagnosticMessage message={error} />
                                </p>
                            )}
                            <button
                                type="submit"
                                className={styles.primary}
                                disabled={!valid || creating}>
                                {creating ? (
                                    <Loader2
                                        size={18}
                                        className="animate-spin"
                                    />
                                ) : (
                                    <ArrowRight size={18} />
                                )}
                                {t(creating ? '创建中...' : mode === 'project' ? '创建漫剧项目' : '前往生成图片')}
                            </button>
                            <p className={styles.note}>{t(mode === 'project' ? '创建后，在项目中逐步完成剧本、角色、分镜与成片。' : '描述与参考图会带入图片创作台，确认模型后生成。')}</p>
                        </fieldset>
                    </form>
                    <aside className={styles.looks}>
                        <div className={styles.sectionTitle}>
                            <Palette size={17} />
                            <h2>{t('选择画风')}</h2>
                            <span>{t(style.label)}</span>
                        </div>
                        <div className={styles.styleGrid}>
                            {ANIME_STYLES.map(key => {
                                const preset = getVisualStyle(key)
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        disabled={creating}
                                        aria-pressed={draft.style === key}
                                        onClick={() => update('style', key)}
                                        className={styles.styleCard}>
                                        <span
                                            className={styles.poster}
                                            style={{ backgroundImage: `url(${JSON.stringify(getStylePreviewSrc(key, 384))})` }}
                                        />
                                        {draft.style === key && (
                                            <Check
                                                className={styles.styleCheck}
                                                size={17}
                                            />
                                        )}
                                        <span>{t(preset.label)}</span>
                                    </button>
                                )
                            })}
                        </div>
                        <p className={styles.note}>{t('风格示例；实际生成结果由描述、参考图和模型共同决定。')}</p>
                        <div className={styles.flow}>
                            <h2>{t('制作流程')}</h2>
                            <ol>
                                {['故事与剧本', '角色与场景', '分镜与关键帧', '视频与配音', '合成与导出'].map((step, index) => (
                                    <li key={step}>
                                        <span>{String(index + 1).padStart(2, '0')}</span>
                                        {t(step)}
                                    </li>
                                ))}
                            </ol>
                            <Link href="/how-to-use">
                                {t('查看创作指南')}
                                <ArrowRight size={14} />
                            </Link>
                        </div>
                    </aside>
                </div>
            </main>
            <SiteFooter />
        </div>
    )
}
