'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Film, Play } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import type { PublicWork } from '@/lib/public-works'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import styles from './HomeWorksShowcase.module.css'

const HOME_WORK_LIMIT = 20

type WorksResponse = {
    success: boolean
    data?: {
        works?: PublicWork[]
    }
}

function HomeWorkCard({ work }: { work: PublicWork }) {
    const { t } = useI18n()
    const [previewing, setPreviewing] = useState(false)
    const [previewFailed, setPreviewFailed] = useState(false)
    const title = work.seoTitle || work.title
    const canPreview = Boolean(work.trailerUrl) && !previewFailed

    function startPreview() {
        if (canPreview) setPreviewing(true)
    }

    function stopPreview() {
        setPreviewing(false)
    }

    return (
        <Link
            href={`/works/${work.id}`}
            className={styles.card}
            aria-label={`${t('立即观看')} ${title}`}
            onMouseEnter={startPreview}
            onMouseLeave={stopPreview}
            onFocus={startPreview}
            onBlur={stopPreview}>
            <div className={styles.poster}>
                {work.coverUrl ? (
                    <>
                        <OptimizedMediaImage
                            src={work.coverUrl}
                            alt=""
                            aria-hidden
                            fill
                            sizes="(min-width: 1408px) 214px, (min-width: 1024px) calc((100vw - 128px) / 6), (min-width: 768px) calc((100vw - 96px) / 4), (min-width: 480px) calc((100vw - 72px) / 3), calc((100vw - 44px) / 2)"
                            className={styles.backdrop}
                        />
                        <OptimizedMediaImage
                            src={work.coverUrl}
                            alt={work.coverAlt || title}
                            fill
                            sizes="(min-width: 1408px) 214px, (min-width: 1024px) calc((100vw - 128px) / 6), (min-width: 768px) calc((100vw - 96px) / 4), (min-width: 480px) calc((100vw - 72px) / 3), calc((100vw - 44px) / 2)"
                        />
                    </>
                ) : (
                    <Film
                        size={42}
                        aria-hidden
                    />
                )}
                {previewing && work.trailerUrl ? (
                    <video
                        className={styles.preview}
                        src={work.trailerUrl}
                        poster={work.coverUrl ?? undefined}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        aria-hidden
                        data-i18n-skip
                        onError={() => {
                            setPreviewFailed(true)
                            setPreviewing(false)
                        }}
                    />
                ) : null}
                <span className={styles.status}>
                    {t(work.status === 'completed' ? '已完结' : '连载中')} · {work.completedEpisodes} {t('集')}
                </span>
                {!previewing ? (
                    <span
                        className={styles.play}
                        aria-hidden>
                        <Play
                            size={24}
                            fill="currentColor"
                        />
                    </span>
                ) : null}
            </div>
            <h3 data-i18n-skip>{title}</h3>
            <p>
                {t(work.genre.label ?? '剧情')}
                {work.author.displayName ? (
                    <>
                        <span> · </span>
                        <span data-i18n-skip>{work.author.displayName}</span>
                    </>
                ) : null}
            </p>
        </Link>
    )
}

export default function HomeWorksShowcase() {
    const { t } = useI18n()
    const [works, setWorks] = useState<PublicWork[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        const controller = new AbortController()

        clientFetch(`/api/works?limit=${HOME_WORK_LIMIT}`, { signal: controller.signal, cache: 'no-store' })
            .then(readApiJson)
            .then((json: WorksResponse) => {
                if (!json.success || !Array.isArray(json.data?.works)) throw new Error('works-unavailable')
                if (!controller.signal.aborted) setWorks(json.data.works.slice(0, HOME_WORK_LIMIT))
            })
            .catch(() => {
                if (!controller.signal.aborted) setError(true)
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })

        return () => controller.abort()
    }, [attempt])

    return (
        <section
            className={styles.section}
            aria-labelledby="home-works-heading">
            <div className={styles.container}>
                <div className={styles.heading}>
                    <h2 id="home-works-heading">{t('全部剧集')}</h2>
                    <Link
                        href="/works"
                        className={styles.viewAll}>
                        {t('查看全部')}
                        <ArrowRight
                            size={16}
                            aria-hidden
                        />
                    </Link>
                </div>

                {loading ? (
                    <div
                        className={styles.grid}
                        aria-label={t('加载中…')}
                        aria-busy="true">
                        {Array.from({ length: 5 }, (_, index) => (
                            <div
                                className={styles.skeleton}
                                key={index}
                            />
                        ))}
                    </div>
                ) : error ? (
                    <div
                        className={styles.message}
                        role="alert">
                        <p>{t('加载失败，请重试')}</p>
                        <button
                            type="button"
                            onClick={() => {
                                setLoading(true)
                                setError(false)
                                setAttempt(value => value + 1)
                            }}>
                            {t('重新加载')}
                        </button>
                    </div>
                ) : works.length ? (
                    <div className={styles.grid}>
                        {works.map(work => (
                            <HomeWorkCard
                                key={work.id}
                                work={work}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={styles.message}>
                        <Film
                            size={34}
                            aria-hidden
                        />
                        <p>{t('还没有已发布的剧集')}</p>
                        <span>{t('发布后的作品会展示在这里。')}</span>
                    </div>
                )}
            </div>
        </section>
    )
}
