'use client'

import { Film, ListVideo, Sparkles, WandSparkles } from 'lucide-react'
import CustomSelect from '@/components/CustomSelect'
import { useI18n } from '@/i18n/I18nProvider'
import { locales, localeDisplayName, type Locale } from '@/i18n/config'
import type { VideoCreationMode, VideoThemeDraft, VideoThemePlanDraft, VideoThemePurpose, VideoThemeAudio } from '@/lib/creator-video-plan'
import styles from './VideoThemeComposer.module.css'

export function VideoCreationModes({ value, onChange, disabled }: { value: VideoCreationMode; onChange: (value: VideoCreationMode) => void; disabled: boolean }) {
    const { t } = useI18n()
    return (
        <div
            className={styles.modes}
            role="group"
            aria-label={t('视频创作方式')}>
            <button
                type="button"
                aria-pressed={value === 'direct'}
                disabled={disabled}
                onClick={() => onChange('direct')}>
                <Film
                    size={18}
                    aria-hidden="true"
                />
                <span>
                    <strong>{t('直接生成')}</strong>
                    <small>{t('描述画面，生成视频片段')}</small>
                </span>
            </button>
            <button
                type="button"
                aria-pressed={value === 'merge'}
                disabled={disabled}
                onClick={() => onChange('merge')}>
                <ListVideo
                    size={18}
                    aria-hidden="true"
                />
                <span>
                    <strong>{t('长视频拼接')}</strong>
                    <small>{t('选择片段，排序并合成长视频')}</small>
                </span>
            </button>
            <button
                type="button"
                aria-pressed={value === 'theme'}
                disabled={disabled}
                onClick={() => onChange('theme')}>
                <WandSparkles
                    size={18}
                    aria-hidden="true"
                />
                <span>
                    <strong>{t('主题成片')}</strong>
                    <small>{t('输入主题，自动编写内容并生成')}</small>
                </span>
            </button>
        </div>
    )
}

export default function VideoThemeComposer({
    draft,
    onChange,
    plan,
    planCurrent,
    onPlanChange,
    disabled
}: {
    draft: VideoThemeDraft
    onChange: (draft: VideoThemeDraft) => void
    plan: VideoThemePlanDraft | null
    planCurrent: boolean
    onPlanChange: (prompt: string) => void
    disabled: boolean
}) {
    const { locale, t } = useI18n()
    return (
        <div className={styles.theme}>
            <div className={styles.heading}>
                <label htmlFor="video-theme-topic">
                    <Sparkles
                        size={16}
                        aria-hidden="true"
                    />
                    {t('视频主题')}
                </label>
                <span>{draft.topic.length}/1000</span>
            </div>
            <textarea
                id="video-theme-topic"
                value={draft.topic}
                onChange={event => onChange({ ...draft, topic: event.target.value })}
                disabled={disabled}
                maxLength={1000}
                rows={4}
                placeholder={t('例如：向第一次来杭州的游客介绍西湖，轻松自然，结尾邀请观众来体验。')}
                className={styles.topic}
            />
            <div className={styles.settings}>
                <div>
                    <span>{t('视频用途')}</span>
                    <CustomSelect
                        value={draft.purpose}
                        onChange={value => onChange({ ...draft, purpose: value as VideoThemePurpose })}
                        disabled={disabled}
                        ariaLabel="视频用途"
                        options={[
                            { value: 'travel', label: '旅行推荐' },
                            { value: 'product', label: '产品介绍' },
                            { value: 'knowledge', label: '知识讲解' },
                            { value: 'story', label: '微故事' }
                        ]}
                    />
                </div>
                <div>
                    <span>{t('声音方式')}</span>
                    <CustomSelect
                        value={draft.audio}
                        onChange={value => onChange({ ...draft, audio: value as VideoThemeAudio })}
                        disabled={disabled}
                        ariaLabel="声音方式"
                        options={[
                            { value: 'narration', label: '解说与环境声' },
                            { value: 'ambient', label: '仅环境声' }
                        ]}
                    />
                </div>
                <div>
                    <span>{t('视频语言')}</span>
                    <CustomSelect
                        value={draft.language || locale}
                        onChange={value => onChange({ ...draft, language: value as Locale })}
                        disabled={disabled}
                        ariaLabel="视频语言"
                        options={locales.map(value => ({ value, label: localeDisplayName(locale, value) }))}
                    />
                </div>
            </div>
            {plan && (
                <div className={styles.plan}>
                    <div className={styles.heading}>
                        <label htmlFor="video-theme-plan">{t('画面与声音脚本')}</label>
                        <span>{plan.prompt.length}/4000</span>
                    </div>
                    <p
                        className={styles.planTitle}
                        data-i18n-skip>
                        {plan.title}
                    </p>
                    {!planCurrent && (
                        <p
                            className={styles.stale}
                            role="status">
                            {t('主题或设置已改变，生成时将重新编写脚本。')}
                        </p>
                    )}
                    <textarea
                        id="video-theme-plan"
                        value={plan.prompt}
                        onChange={event => onPlanChange(event.target.value)}
                        disabled={disabled || !planCurrent}
                        maxLength={4000}
                        rows={7}
                    />
                </div>
            )}
        </div>
    )
}
