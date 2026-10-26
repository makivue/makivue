'use client'

import { use, useState } from 'react'
import { ArrowLeft, Film, Play, Trash2 } from 'lucide-react'
import Link, { useRouter } from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { isLocale, localeDisplayName } from '@/i18n/config'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import DiagnosticMessage from '@/components/DiagnosticMessage'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import SubtitleVideo from '@/components/SubtitleVideo'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { mergedVideoSubtitles } from '@/lib/subtitle-playback'
import UploadsShell, { UploadsState, useUploadedResource, type UploadSummary } from '../UploadsShell'
import styles from '../Uploads.module.css'

type UploadEpisode = { id: string; episodeNumber: number; title: string | null; videoUrl: string | null; duration: number | null; merges: { videoUrl: string | null; subtitleUrls: string | null }[] }
type UploadDetail = UploadSummary & { episodes: UploadEpisode[] }

export default function UploadedWorkPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params)
    const { t, locale } = useI18n()
    const router = useRouter()
    const resource = useUploadedResource<UploadDetail>(`/api/drama-uploads/${id}`)
    const work = resource.data
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState('')
    const { confirm, confirmDialog } = useConfirmDialog()
    const episode = work?.episodes.find(item => item.id === selectedId) ?? work?.episodes[0]
    async function remove() {
        if (!(await confirm({ title: '删除作品', message: '确定删除这部上传作品吗？', confirmText: '删除作品', cancelText: '取消', tone: 'danger' }))) return
        setDeleting(true)
        setError('')
        try {
            const json = await readApiJson(await clientFetch(`/api/drama-uploads/${id}`, { method: 'DELETE' }))
            if (!json.success) throw new Error(json.error || '删除失败')
            router.replace('/uploads')
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '删除失败')
            setDeleting(false)
        }
    }
    return (
        <UploadsShell>
            <Link
                href="/uploads"
                className={styles.back}>
                <ArrowLeft size={16} />
                {t('我的上传')}
            </Link>
            <UploadsState {...resource} />
            {work && (
                <>
                    <div className={styles.detailHeading}>
                        <div>
                            <p className={styles.eyebrow}>{t('作品详情')}</p>
                            <h1>{work.title || t('未命名作品')}</h1>
                            <div className={styles.metadata}>
                                <span>{t(work.visibility === 'public' ? '已发布' : '私有')}</span>
                                <span>{t('共 {count} 集', { count: work.episodes.length })}</span>
                                {work.year && <span>{work.year}</span>}
                                {work.genre && <span>{t(work.genre)}</span>}
                                {isLocale(work.contentLanguage) && <span>{localeDisplayName(locale, work.contentLanguage)}</span>}
                            </div>
                        </div>
                        <button
                            type="button"
                            className={styles.delete}
                            onClick={() => void remove()}
                            disabled={deleting}>
                            <Trash2 size={16} />
                            {t('删除作品')}
                        </button>
                    </div>
                    {error && (
                        <p
                            className={styles.error}
                            role="alert">
                            <DiagnosticMessage message={error} />
                        </p>
                    )}
                    <div className={styles.watchLayout}>
                        <section className={styles.playerSection}>
                            <div className={styles.player}>
                                {episode?.videoUrl ? (
                                    <SubtitleVideo
                                        src={episode.videoUrl}
                                        poster={work.coverUrl ?? undefined}
                                        subtitles={mergedVideoSubtitles(episode)}
                                        mediaKey={episode.id}
                                        controls
                                        preload="metadata"
                                        loading="eager"
                                        className={styles.video}
                                    />
                                ) : (
                                    <div className={styles.state}>
                                        <Film size={40} />
                                        {t('暂无视频')}
                                    </div>
                                )}
                            </div>
                            {episode && (
                                <h2 className={styles.episodeTitle}>
                                    {t('第 {number} 集', { number: episode.episodeNumber })}
                                    {episode.title && <span> · {episode.title}</span>}
                                </h2>
                            )}
                        </section>
                        <section className={styles.episodes}>
                            <div className={styles.episodeHeader}>
                                <h2>{t('剧集')}</h2>
                                <span>{t('共 {count} 集', { count: work.episodes.length })}</span>
                            </div>
                            <div className={styles.episodeList}>
                                {work.episodes.map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        aria-pressed={item.id === episode?.id}
                                        className={item.id === episode?.id ? styles.activeEpisode : styles.episode}
                                        onClick={() => setSelectedId(item.id)}>
                                        <span className={styles.episodeNumber}>
                                            {item.id === episode?.id ? (
                                                <Play
                                                    size={15}
                                                    fill="currentColor"
                                                />
                                            ) : (
                                                String(item.episodeNumber).padStart(2, '0')
                                            )}
                                        </span>
                                        <span>
                                            <strong>{t('第 {number} 集', { number: item.episodeNumber })}</strong>
                                            <small>{item.title}</small>
                                        </span>
                                        {item.duration != null && (
                                            <small>
                                                {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}
                                            </small>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>
                    <section className={styles.info}>
                        <h2>{t('作品简介')}</h2>
                        <p className={styles.description}>{work.description}</p>
                    </section>
                    {work.cast.length > 0 && (
                        <section className={styles.info}>
                            <h2>{t('演职人员')}</h2>
                            <div className={styles.cast}>
                                {work.cast.map((person, index) => (
                                    <div
                                        key={index}
                                        className={styles.person}>
                                        {person.imageUrl && (
                                            <div className={styles.portrait}>
                                                <OptimizedMediaImage
                                                    src={person.imageUrl}
                                                    alt={person.name}
                                                    fill
                                                    sizes="56px"
                                                />
                                            </div>
                                        )}
                                        <div>
                                            <strong>{person.name}</strong>
                                            <p>{[person.job, person.role].filter(Boolean).join(' · ')}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}
            {confirmDialog}
        </UploadsShell>
    )
}
