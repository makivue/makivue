'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Film, Loader2, Play } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import type { PublicWorkDetail } from '@/lib/public-works'

function WorkPlayer({ work }: { work: PublicWorkDetail }) {
    const { t } = useI18n()
    const title = work.seoTitle || work.title
    const [selectedId, setSelectedId] = useState(work.episodes[0]?.id ?? 'trailer')
    const [autoplay, setAutoplay] = useState(false)
    const [playError, setPlayError] = useState(false)
    const [retry, setRetry] = useState(0)
    const video = useRef<HTMLVideoElement>(null)
    const player = useRef<HTMLElement>(null)
    const episode = work.episodes.find(item => item.id === selectedId)
    const source = selectedId === 'trailer' ? work.trailerUrl : episode?.videoUrl
    const nextEpisode = episode ? work.episodes[work.episodes.indexOf(episode) + 1] : null

    function select(id: string) {
        setPlayError(false)
        setAutoplay(true)
        setSelectedId(id)
        player.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (id === selectedId) void video.current?.play().catch(() => {})
    }

    return (
        <>
            <section
                className="works-watch"
                ref={player}
                aria-label={t('播放')}>
                <div className="works-player-column">
                    <div className="works-player">
                        {source ? (
                            <video
                                key={`${source}:${retry}`}
                                ref={video}
                                src={source}
                                poster={work.coverUrl ?? undefined}
                                controls
                                playsInline
                                preload="metadata"
                                autoPlay={autoplay}
                                onError={() => setPlayError(true)}
                                aria-label={selectedId === 'trailer' ? t('预告片') : `${title} · ${episode?.episodeNumber} ${t('集')}`}
                            />
                        ) : (
                            <p>{t('暂无可播放剧集')}</p>
                        )}
                    </div>
                    {playError && (
                        <div
                            className="works-player-error"
                            role="alert">
                            <span>{t('视频暂时无法播放，请重试。')}</span>
                            <button
                                onClick={() => {
                                    setPlayError(false)
                                    setRetry(value => value + 1)
                                }}>
                                {t('重试')}
                            </button>
                        </div>
                    )}
                    <div className="works-player-caption">
                        <span data-i18n-skip>{selectedId === 'trailer' ? t('预告片') : `${episode?.episodeNumber ?? ''} ${t('集')} · ${episode?.title ?? work.title}`}</span>
                        {nextEpisode && (
                            <button onClick={() => select(nextEpisode.id)}>
                                {t('下一集')}
                                <ChevronRight size={16} />
                            </button>
                        )}
                    </div>
                </div>
                <aside className="works-episodes">
                    <div className="works-section-heading">
                        <h2>{t('选集')}</h2>
                        <span>
                            {work.completedEpisodes} / {work.totalEpisodes}
                        </span>
                    </div>
                    <p className="works-episodes-hint">{t('选择剧集开始播放')}</p>
                    <div className="works-episode-grid">
                        {work.episodes.map(item => (
                            <button
                                key={item.id}
                                className={selectedId === item.id ? 'is-active' : ''}
                                aria-pressed={selectedId === item.id}
                                title={item.title ?? undefined}
                                aria-label={`${item.episodeNumber} ${t('集')} · ${item.title ?? ''}`}
                                onClick={() => select(item.id)}>
                                {String(item.episodeNumber).padStart(2, '0')}
                            </button>
                        ))}
                    </div>
                    {!work.episodes.length && <p>{t('暂无可播放剧集')}</p>}
                    {work.trailerUrl && (
                        <button
                            className={`works-episode-trailer ${selectedId === 'trailer' ? 'is-active' : ''}`}
                            aria-pressed={selectedId === 'trailer'}
                            onClick={() => select('trailer')}>
                            <Play size={14} />
                            {t('预告片')}
                        </button>
                    )}
                </aside>
            </section>
            <section className="works-detail-hero">
                {work.coverUrl && (
                    <OptimizedMediaImage
                        src={work.coverUrl}
                        alt=""
                        fill
                        sizes="100vw"
                        className="works-detail-backdrop"
                        priority
                    />
                )}
                <div className="works-detail-shade" />
                <div className="works-detail-heading">
                    <div className="works-detail-poster">
                        {work.coverUrl && (
                            <OptimizedMediaImage
                                src={work.coverUrl}
                                alt={work.coverAlt || work.title}
                                fill
                                sizes="180px"
                                priority
                            />
                        )}
                    </div>
                    <div className="min-w-0">
                        <span className="works-eyebrow">{t(work.status === 'completed' ? '已完结' : '连载中')}</span>
                        <h1 data-i18n-skip>{title}</h1>
                        <div className="works-meta">
                            <span>{t(work.genre.label ?? '剧情')}</span>
                            <span>
                                {work.completedEpisodes} / {work.totalEpisodes} {t('集')}
                            </span>
                            <span data-i18n-skip>{work.author.displayName}</span>
                        </div>
                        <p
                            className="works-description"
                            data-i18n-skip>
                            {work.seoDescription || work.description}
                        </p>
                        <div className="works-detail-actions">
                            {work.episodes.length > 0 && (
                                <button
                                    className="works-play"
                                    onClick={() => select(work.episodes[0].id)}>
                                    <Play
                                        size={17}
                                        fill="currentColor"
                                    />
                                    {t('立即观看')}
                                </button>
                            )}
                            {work.trailerUrl && (
                                <button
                                    className="works-trailer"
                                    onClick={() => select('trailer')}>
                                    <Film size={17} />
                                    {t('预告片')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </>
    )
}

export default function WorkDetail({ id }: { id: string }) {
    const { t } = useI18n()
    const [work, setWork] = useState<PublicWorkDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        clientFetch(`/api/works/${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' })
            .then(async response => {
                const json = await readApiJson(response)
                if (controller.signal.aborted) return
                setNotFound(response.status === 404)
                if (json.success) setWork(json.data)
            })
            .catch(() => {})
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [id, attempt])
    return (
        <main className="works-content works-detail">
            <Link
                href="/works"
                className="works-back">
                <ArrowLeft size={15} />
                {t('全部剧集')}
            </Link>
            {loading ? (
                <div
                    className="works-empty"
                    role="status">
                    <Loader2 className="animate-spin" />
                    {t('加载中…')}
                </div>
            ) : work ? (
                <WorkPlayer work={work} />
            ) : (
                <div className="works-empty">
                    <Film size={36} />
                    <h1>{t(notFound ? '作品未公开或已下架' : '加载失败，请重试')}</h1>
                    {!notFound && (
                        <button
                            className="studio-secondary"
                            onClick={() => {
                                setLoading(true)
                                setAttempt(value => value + 1)
                            }}>
                            {t('重新加载')}
                        </button>
                    )}
                </div>
            )}
        </main>
    )
}
