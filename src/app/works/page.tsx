'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, ChevronDown, Film, Loader2, Play } from 'lucide-react'
import Link from '@/i18n/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import OptimizedMediaImage from '@/components/OptimizedMediaImage'
import { clientFetch, readApiJson } from '@/lib/client-fetch'
import { PROJECT_GENRES } from '@/lib/project-genres'
import type { PublicWork } from '@/lib/public-works'

function WorkGrid({ query, genre }: { query: string; genre: string }) {
    const { t } = useI18n()
    const [works, setWorks] = useState<PublicWork[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [moreLoading, setMoreLoading] = useState(false)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const parameters = new URLSearchParams({ limit: '24', ...(query ? { q: query } : {}), ...(genre ? { genre } : {}) }).toString()
    useEffect(() => {
        const controller = new AbortController()
        clientFetch(`/api/works?${parameters}`, { signal: controller.signal, cache: 'no-store' })
            .then(readApiJson)
            .then(json => {
                if (!json.success) throw new Error('works-unavailable')
                if (controller.signal.aborted) return
                setWorks(json.data.works)
                setCursor(json.data.nextCursor)
            })
            .catch(() => {
                if (!controller.signal.aborted) setError(true)
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => controller.abort()
    }, [parameters, attempt])

    async function loadMore() {
        if (!cursor || moreLoading) return
        setMoreLoading(true)
        setError(false)
        try {
            const json = await readApiJson(await clientFetch(`/api/works?${parameters}&cursor=${encodeURIComponent(cursor)}`, { cache: 'no-store' }))
            if (!json.success) throw new Error('works-unavailable')
            setWorks(current => [...current, ...(json.data.works as PublicWork[]).filter(work => !current.some(item => item.id === work.id))])
            setCursor(json.data.nextCursor)
        } catch {
            setError(true)
        } finally {
            setMoreLoading(false)
        }
    }

    const featured = !query && !genre ? works[0] : null
    const currentGenreLabel = genre ? (PROJECT_GENRES.find(item => item.code === genre)?.label ?? '剧集') : '全部剧集'
    return (
        <main className="works-content">
            <details className="works-genre-filter">
                <summary>
                    <span className="works-genre-filter-label">
                        <Film
                            size={15}
                            aria-hidden
                        />
                        {t('题材')}
                    </span>
                    <span className="works-genre-current">{t(currentGenreLabel)}</span>
                    <ChevronDown
                        className="works-genre-chevron"
                        size={16}
                        aria-hidden
                    />
                </summary>
                <nav
                    className="works-genre-options"
                    aria-label={t('题材')}>
                    <Link
                        href="/works"
                        className={!genre ? 'is-active' : ''}>
                        {t('全部剧集')}
                    </Link>
                    {PROJECT_GENRES.map(item => (
                        <Link
                            key={item.code}
                            href={`/works?genre=${item.code}`}
                            className={genre === item.code ? 'is-active' : ''}>
                            {t(item.label)}
                        </Link>
                    ))}
                </nav>
            </details>
            {featured && (
                <section className="works-hero">
                    {featured.coverUrl && (
                        <OptimizedMediaImage
                            src={featured.coverUrl}
                            alt=""
                            fill
                            sizes="(min-width: 1024px) 80vw, 100vw"
                            className="works-hero-image"
                            priority
                        />
                    )}
                    <div className="works-hero-shade" />
                    <div className="works-hero-copy">
                        <span className="works-eyebrow">{t('最新发布')}</span>
                        <h1 data-i18n-skip>{featured.seoTitle || featured.title}</h1>
                        <div className="works-meta">
                            <span>{t(featured.genre.label ?? '剧情')}</span>
                            <span>
                                {featured.completedEpisodes} / {featured.totalEpisodes} {t('集')}
                            </span>
                            <span>{t(featured.status === 'completed' ? '已完结' : '连载中')}</span>
                        </div>
                        <p data-i18n-skip>{featured.seoDescription || featured.description}</p>
                        <Link
                            href={`/works/${featured.id}`}
                            className="works-play">
                            <Play
                                size={17}
                                fill="currentColor"
                            />
                            {t('立即观看')}
                        </Link>
                    </div>
                </section>
            )}
            <section
                className="works-catalog"
                aria-labelledby="works-heading">
                <div className="works-section-heading">
                    <h2 id="works-heading">{query ? t('搜索结果') : genre ? t(PROJECT_GENRES.find(item => item.code === genre)?.label ?? '剧集') : t('全部剧集')}</h2>
                    <span>{t('最新发布')}</span>
                </div>
                {loading ? (
                    <div
                        className="works-grid"
                        aria-label={t('加载中…')}
                        aria-busy="true">
                        {Array.from({ length: 6 }, (_, index) => (
                            <div
                                className="works-skeleton"
                                key={index}
                            />
                        ))}
                    </div>
                ) : (
                    <>
                        <div className="works-grid">
                            {works.map(work => (
                                <Link
                                    href={`/works/${work.id}`}
                                    key={work.id}
                                    className="work-card"
                                    aria-label={`${t('立即观看')} ${work.seoTitle || work.title}`}>
                                    <div className="work-poster">
                                        {work.coverUrl ? (
                                            <>
                                                <OptimizedMediaImage
                                                    src={work.coverUrl}
                                                    alt=""
                                                    aria-hidden
                                                    fill
                                                    sizes="(min-width: 1400px) 16vw, (min-width: 1024px) 20vw, (min-width: 640px) 25vw, 50vw"
                                                    className="work-poster-backdrop"
                                                />
                                                <OptimizedMediaImage
                                                    src={work.coverUrl}
                                                    alt={work.coverAlt || work.title}
                                                    fill
                                                    sizes="(min-width: 1400px) 16vw, (min-width: 1024px) 20vw, (min-width: 640px) 25vw, 50vw"
                                                />
                                            </>
                                        ) : (
                                            <Film size={36} />
                                        )}
                                        <span className="work-poster-status">
                                            {t(work.status === 'completed' ? '已完结' : '连载中')} · {work.completedEpisodes} {t('集')}
                                        </span>
                                        <span
                                            className="work-poster-play"
                                            aria-hidden>
                                            <Play
                                                size={24}
                                                fill="currentColor"
                                            />
                                        </span>
                                    </div>
                                    <h3 data-i18n-skip>{work.seoTitle || work.title}</h3>
                                    <p>
                                        {t(work.genre.label ?? '剧情')}
                                        <span> · </span>
                                        <span data-i18n-skip>{work.author.displayName}</span>
                                    </p>
                                </Link>
                            ))}
                        </div>
                        {!works.length && !error && (
                            <div className="works-empty">
                                <Film size={36} />
                                <h3>{t(query || genre ? '没有找到相关剧集' : '还没有已发布的剧集')}</h3>
                                <p>{t('发布后的作品会展示在这里。')}</p>
                                <Link href="/">
                                    {t('开始创作')}
                                    <ArrowRight size={15} />
                                </Link>
                            </div>
                        )}
                        {error && (
                            <div
                                role="alert"
                                className="works-empty">
                                <p>{t('加载失败，请重试')}</p>
                                <button
                                    className="studio-secondary"
                                    onClick={() => {
                                        if (works.length) void loadMore()
                                        else {
                                            setError(false)
                                            setLoading(true)
                                            setAttempt(value => value + 1)
                                        }
                                    }}>
                                    {t('重新加载')}
                                </button>
                            </div>
                        )}
                        {cursor && !error && (
                            <button
                                className="works-load-more studio-secondary"
                                disabled={moreLoading}
                                onClick={loadMore}>
                                {moreLoading && (
                                    <Loader2
                                        size={15}
                                        className="animate-spin"
                                    />
                                )}
                                {t('加载更多')}
                            </button>
                        )}
                    </>
                )}
            </section>
        </main>
    )
}

export default function WorksPage() {
    const params = useSearchParams()
    const query = params.get('q')?.trim() ?? ''
    const genre = params.get('genre') ?? ''
    return (
        <WorkGrid
            key={`${query}:${genre}`}
            query={query}
            genre={genre}
        />
    )
}
