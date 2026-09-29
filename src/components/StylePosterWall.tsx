'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import LocalizedContent from '@/components/LocalizedContent'
import { useI18n } from '@/i18n/I18nProvider'
import s from './StylePosterWall.module.css'

type StylePoster = { key: string; label: string; src: string; thumbnailSrc: string; thumbnailSrcSet: string }

function PosterImage({ item, full = false }: { item: StylePoster; full?: boolean }) {
    const { t } = useI18n()
    const [loaded, setLoaded] = useState(false)
    const [original, setOriginal] = useState(full)
    const [failed, setFailed] = useState(false)
    const imageRef = useCallback((image: HTMLImageElement | null) => {
        // A cached image can finish before its load handler is attached.
        if (image?.complete && image.naturalWidth > 0) setLoaded(true)
    }, [])

    return (
        <span className={`${s.imageFrame} ${full ? s.fullImage : ''}`}>
            {failed ? (
                <span className={s.imageFallback}>{t('暂无预览')}</span>
            ) : (
                // Pre-sized WebP variants are served directly from the bundled assets.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    ref={imageRef}
                    src={original ? item.src : item.thumbnailSrc}
                    srcSet={original ? undefined : item.thumbnailSrcSet}
                    alt={`${t(item.label)} ${t('风格预览')}`}
                    width={400}
                    height={700}
                    sizes={original ? undefined : '(max-width: 639px) 138px, 188px'}
                    // PosterRow mounts only nearby images. Native lazy loading
                    // would delay them again inside the transformed, clipped track.
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    onLoad={() => setLoaded(true)}
                    onError={() => {
                        if (!original) setOriginal(true)
                        else setFailed(true)
                    }}
                    className={loaded ? s.imageLoaded : undefined}
                />
            )}
        </span>
    )
}

function PosterDialog({ item, onClose }: { item: StylePoster; onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null)
    const titleId = useId()

    useEffect(() => {
        const element = dialog.current
        element?.showModal()
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            element?.close()
            document.body.style.overflow = previousOverflow
        }
    }, [])

    return (
        <LocalizedContent>
            <dialog
                ref={dialog}
                className={s.dialog}
                aria-labelledby={titleId}
                onClose={event => {
                    // Strict Mode can queue a cleanup close event before reopening the dialog.
                    if (!event.currentTarget.open) onClose()
                }}
                onClick={event => {
                    if (event.target === event.currentTarget) onClose()
                }}>
                <div className={s.dialogInner}>
                    <button
                        className={s.closeButton}
                        onClick={onClose}
                        aria-label="关闭">
                        <X size={20} />
                    </button>
                    <PosterImage
                        item={item}
                        full
                    />
                    <div className={s.dialogCaption}>
                        <p>风格预览</p>
                        <h3 id={titleId}>{item.label}</h3>
                    </div>
                </div>
            </dialog>
        </LocalizedContent>
    )
}

function PosterRow({ items, row, offset, active, onSelect }: { items: readonly StylePoster[]; row: number; offset: number; active: boolean; onSelect: (item: StylePoster) => void }) {
    const { t } = useI18n()
    const viewport = useRef<HTMLDivElement>(null)
    const [readyKeys, setReadyKeys] = useState<Set<string>>(() => new Set())

    useEffect(() => {
        const element = viewport.current
        if (!active || !element) return
        if (!('IntersectionObserver' in window)) {
            const frame = requestAnimationFrame(() => setReadyKeys(new Set(items.map(item => item.key))))
            return () => cancelAnimationFrame(frame)
        }

        // Use the scrolling row as the root so the horizontal preload margin
        // extends beyond its clipping edge, including the reverse-moving row.
        const observer = new IntersectionObserver(
            entries => {
                const keys = entries
                    .filter(entry => entry.isIntersecting)
                    .map(entry => {
                        observer.unobserve(entry.target)
                        return (entry.target as HTMLElement).dataset.styleKey!
                    })
                if (keys.length) setReadyKeys(current => new Set([...current, ...keys]))
            },
            { root: element, rootMargin: '0px 600px' }
        )
        element.querySelectorAll('[data-style-key]').forEach(poster => observer.observe(poster))
        return () => observer.disconnect()
    }, [active, items])

    return (
        <div
            ref={viewport}
            className={s.viewport}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.scrollLeft = 0
            }}>
            <div
                className={`${s.track} ${row % 2 === 1 ? s.reverse : ''}`}
                style={{ animationDuration: `${Math.max(items.length * (row % 2 === 1 ? 10 : 9), 85)}s` }}>
                {[0, 1].map(cycle => (
                    <div
                        key={cycle}
                        className={s.cycle}
                        aria-hidden={cycle === 1}>
                        {items.map((item, index) => (
                            <button
                                key={item.key}
                                data-style-key={item.key}
                                className={s.poster}
                                aria-label={t(item.label)}
                                tabIndex={cycle === 1 ? -1 : 0}
                                onClick={() => onSelect(item)}>
                                {readyKeys.has(item.key) ? <PosterImage item={item} /> : <span className={s.imageFrame} />}
                                <span className={s.shade} />
                                <span
                                    className={s.caption}
                                    dir="auto">
                                    <small aria-hidden="true">{String(offset + index + 1).padStart(2, '0')} / 259</small>
                                    <strong>{t(item.label)}</strong>
                                </span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function StylePosterWall({ rows }: { rows: readonly (readonly StylePoster[])[] }) {
    const [selected, setSelected] = useState<StylePoster | null>(null)
    const [active, setActive] = useState(false)
    const wall = useRef<HTMLElement>(null)
    const headingId = useId()

    useEffect(() => {
        const element = wall.current
        if (!element) return
        if (!('IntersectionObserver' in window)) {
            const frame = requestAnimationFrame(() => setActive(true))
            return () => cancelAnimationFrame(frame)
        }
        const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: '400px 0px' })
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    return (
        <LocalizedContent>
            <section
                ref={wall}
                id="art-styles"
                className={s.wall}
                aria-labelledby={headingId}>
                <div className={s.heading}>
                    <p className={s.eyebrow}>
                        <span aria-hidden="true" />
                        259 种艺术风格
                    </p>
                    <h2 id={headingId}>每一种想象，都有它的风格。</h2>
                </div>
                <div
                    className={s.tracks}
                    data-paused={selected !== null || !active}
                    dir="ltr">
                    {rows.map((items, row) => (
                        <PosterRow
                            key={row}
                            items={items}
                            row={row}
                            offset={rows.slice(0, row).reduce((total, previous) => total + previous.length, 0)}
                            active={active}
                            onSelect={setSelected}
                        />
                    ))}
                </div>
                {selected && (
                    <PosterDialog
                        item={selected}
                        onClose={() => setSelected(null)}
                    />
                )}
            </section>
        </LocalizedContent>
    )
}
