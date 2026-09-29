'use client'

import { useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Check, ChevronDown, Loader2, Palette, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { localeDisplayName, locales, type Locale } from '@/i18n/config'
import CustomSelect from '@/components/CustomSelect'
import { useCreationAuth } from '../useCreationAuth'

import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { DEFAULT_FORM, STYLE_GROUPS, localizeStyleCluster } from '@/lib/drama-creation'
import { VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { PROJECT_GENRES } from '@/lib/project-genres'
import { getRegionalStoryPreset, selectRegionalStoryStyle } from '@/lib/regional-story-presets'
import LazyStylePreview from './LazyStylePreview'
import DramaSettingsDialog from './DramaSettingsDialog'
import styles from './DramaCreator.module.css'

export default function DramaCreator() {
    const router = useRouter()
    const { t, locale } = useI18n()
    const { signingIn, requireAuth } = useCreationAuth()
    const [form, setForm] = useState(() => ({ ...DEFAULT_FORM, contentLanguage: locale }))
    const [styleGroup, setStyleGroup] = useState(() => STYLE_GROUPS.find(group => group.styles.includes(DEFAULT_FORM.visualStyle))?.key ?? STYLE_GROUPS[0].key)
    const [showSettings, setShowSettings] = useState(false)
    const [showStyles, setShowStyles] = useState(false)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const submittingRef = useRef(false)
    const styleGridRef = useRef<HTMLDivElement>(null)
    const selectedStyleGroup = STYLE_GROUPS.find(group => group.key === styleGroup) ?? STYLE_GROUPS[0]
    const selectedStyle = VISUAL_STYLE_PRESETS.find(style => style.key === form.visualStyle)!
    const title = form.title.trim() || form.description.trim().slice(0, 60)
    const valid = Boolean(title) && Number.isInteger(form.totalEpisodes) && form.totalEpisodes >= 1 && form.totalEpisodes <= 100

    async function createProject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!valid || submittingRef.current) return
        submittingRef.current = true
        setCreating(true)
        setError(null)
        try {
            if (!(await requireAuth())) return

            const response = await clientFetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, title })
            })
            const json = await readApiJson(response)
            if (!json.success || !json.data?.id) throw new Error(json.error ?? '项目创建失败')

            router.push(`/projects/${json.data.id}`)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            submittingRef.current = false
            setCreating(false)
        }
    }

    return (
        <form
            onSubmit={createProject}
            className={styles.form}>
            <fieldset
                disabled={creating}
                className={styles.fields}>
                <legend className="sr-only">{t('创建短剧')}</legend>
                <div className={styles.composer}>
                    <div className={styles.composerHeading}>
                        <label htmlFor="drama-description">
                            <Sparkles size={16} />
                            {t('创作内容')}
                        </label>
                        <span>
                            {t('剧本')}
                            <i />
                            {t('角色')}
                            <i />
                            {t('分镜')}
                            <i />
                            {t('视频')}
                        </span>
                    </div>
                    <textarea
                        id="drama-description"
                        maxLength={20000}
                        rows={4}
                        value={form.description}
                        onChange={event => setForm(current => ({ ...current, description: event.target.value }))}
                        placeholder={t('写下一句创意，或粘贴小说、剧本片段，开始创作你的短剧…')}
                    />
                    <div className={styles.toolbar}>
                        <div className={styles.options}>
                            <button
                                type="button"
                                className={styles.optionButton}
                                aria-expanded={showStyles}
                                aria-controls="drama-styles"
                                onClick={() => setShowStyles(!showStyles)}>
                                <Palette size={15} />
                                <span>{t(selectedStyle.label)}</span>
                                <ChevronDown size={13} />
                            </button>
                            <CustomSelect
                                value={form.videoAspectRatio}
                                ariaLabel={t('视频比例')}
                                onChange={videoAspectRatio => setForm(current => ({ ...current, videoAspectRatio }))}
                                options={[
                                    { value: '9:16', label: t('9:16 竖屏') },
                                    { value: '16:9', label: t('16:9 横屏') },
                                    { value: '1:1', label: t('1:1 方形') }
                                ]}
                                className={styles.compactSelect}
                            />
                            <CustomSelect
                                value={String(form.totalEpisodes)}
                                ariaLabel={t('集数')}
                                onChange={value => setForm(current => ({ ...current, totalEpisodes: Number(value) }))}
                                options={[...new Set([1, 12, 24, 50, 80, 100, ...(Number.isFinite(form.totalEpisodes) ? [form.totalEpisodes] : [])])]
                                    .sort((a, b) => a - b)
                                    .map(count => ({ value: String(count), label: t('{count} 集', { count }) }))}
                                className={styles.compactSelect}
                            />
                            <button
                                type="button"
                                className={styles.optionButton}
                                aria-haspopup="dialog"
                                aria-expanded={showSettings}
                                aria-controls="drama-settings"
                                onClick={() => setShowSettings(true)}>
                                <SlidersHorizontal size={15} />
                                <span>{t('更多设定')}</span>
                            </button>
                        </div>
                        <button
                            type="submit"
                            disabled={creating || !valid}
                            className={styles.submit}>
                            {creating ? (
                                <Loader2
                                    size={17}
                                    className="animate-spin"
                                />
                            ) : (
                                <ArrowUp size={18} />
                            )}
                            {t(signingIn ? '登录中...' : creating ? '创建中...' : '开始创作')}
                        </button>
                    </div>
                    {error && (
                        <p
                            role="alert"
                            className={styles.error}>
                            {t(error)}
                        </p>
                    )}
                </div>
                {showSettings && (
                    <DramaSettingsDialog onClose={() => setShowSettings(false)}>
                        <div className={styles.settings}>
                            <div>
                                <label htmlFor="drama-title">{t('项目名称')}</label>
                                <input
                                    id="drama-title"
                                    maxLength={255}
                                    value={form.title}
                                    placeholder={t('留空时使用故事开头')}
                                    onChange={event => setForm(current => ({ ...current, title: event.target.value }))}
                                />
                            </div>
                            <div>
                                <label htmlFor="drama-episodes">{t('集数')}</label>
                                <input
                                    id="drama-episodes"
                                    type="number"
                                    min={1}
                                    max={100}
                                    step={1}
                                    required
                                    value={Number.isNaN(form.totalEpisodes) ? '' : form.totalEpisodes}
                                    onChange={event => setForm(current => ({ ...current, totalEpisodes: event.target.valueAsNumber }))}
                                />
                            </div>
                            <div>
                                <p>{t('剧集类型')}</p>
                                <CustomSelect
                                    value={form.genre}
                                    ariaLabel={t('剧集类型')}
                                    onChange={value => {
                                        const genre = PROJECT_GENRES.find(genre => genre.label === value)?.label
                                        if (genre) setForm(current => ({ ...current, genre }))
                                    }}
                                    options={PROJECT_GENRES.map(genre => ({ value: genre.label, label: t(genre.label) }))}
                                />
                            </div>
                            <div>
                                <p>{t('剧集形态')}</p>
                                <CustomSelect
                                    value={form.episodeFormat}
                                    ariaLabel={t('剧集形态')}
                                    onChange={episodeFormat => setForm(current => ({ ...current, episodeFormat }))}
                                    options={[
                                        { value: 'micro', label: t('微剧（1-2 分钟/集）'), description: t('适合移动端高密度短剧') },
                                        { value: 'short', label: t('标准短剧（5-8 分钟/集）'), description: t('适合完整场景和对白展开') },
                                        { value: 'long', label: t('长篇剧（15-30 分钟/集）'), description: t('适合更完整的长篇叙事') }
                                    ]}
                                />
                            </div>
                            <div>
                                <p>{t('创作内容语言')}</p>
                                <CustomSelect
                                    value={form.contentLanguage}
                                    ariaLabel={t('创作内容语言')}
                                    onChange={value => setForm(current => ({ ...current, contentLanguage: value as Locale }))}
                                    options={locales.map(value => ({ value, label: localeDisplayName(locale, value) }))}
                                />
                            </div>
                            <p className={styles.help}>{t('用于生成大纲、小说正文、剧本、对白和分镜文字；之后切换页面语言不会翻译已有创作内容。')}</p>
                        </div>
                    </DramaSettingsDialog>
                )}
                {showStyles && (
                    <section
                        id="drama-styles"
                        className={styles.gallery}>
                        <div className={styles.galleryHeading}>
                            <h2>
                                <Palette className="h-4 w-4" />
                                {t('艺术风格与地域题材')}
                            </h2>
                            <p>{t(selectedStyleGroup.hint)}</p>
                        </div>
                        <div
                            className={styles.groups}
                            role="group"
                            aria-label={t('艺术风格与地域题材')}>
                            {STYLE_GROUPS.map(group => (
                                <button
                                    key={group.key}
                                    type="button"
                                    aria-pressed={styleGroup === group.key}
                                    onClick={() => {
                                        setStyleGroup(group.key)
                                        if (styleGridRef.current) styleGridRef.current.scrollTop = 0
                                    }}>
                                    {localizeStyleCluster(locale, group).label}
                                    <small>{group.styles.length}</small>
                                </button>
                            ))}
                        </div>
                        <div className={styles.selection}>
                            <Check className="h-4 w-4 shrink-0" />
                            <span>{t('已选风格：{style}', { style: t(selectedStyle.label) })}</span>
                        </div>
                        {getRegionalStoryPreset(form.visualStyle) && (
                            <p className={styles.regionalHint}>{t('选择地域题材后，故事节奏、人物关系与画面风格将一并应用；具体国家和时代可在故事设定中指定。')}</p>
                        )}
                        <div
                            key={styleGroup}
                            ref={styleGridRef}
                            className={styles.styleGrid}
                            role="group"
                            aria-label={t('视觉风格')}>
                            {selectedStyleGroup.styles.map(key => {
                                const style = VISUAL_STYLE_PRESETS.find(item => item.key === key)
                                if (!style) return null
                                const active = form.visualStyle === key
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={styles.styleCard}
                                        aria-label={t(style.label)}
                                        aria-pressed={active}
                                        onClick={() => setForm(current => selectRegionalStoryStyle(current, key))}>
                                        <div className={styles.poster}>
                                            <LazyStylePreview
                                                style={style}
                                                priority={active}
                                                scrollRoot={styleGridRef}
                                            />
                                            {active && (
                                                <span className={styles.check}>
                                                    <Check className="h-3.5 w-3.5" />
                                                </span>
                                            )}
                                        </div>
                                        <div className={styles.caption}>
                                            <strong>{t(style.label)}</strong>
                                            <p>{t(style.hint)}</p>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </section>
                )}
            </fieldset>
        </form>
    )
}
