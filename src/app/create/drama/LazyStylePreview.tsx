'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { getVisualStylePreviewSrc, type VisualStylePreset } from '@/lib/novel'
import { useI18n } from '@/i18n/I18nProvider'

export default function LazyStylePreview({ style, priority, scrollRoot }: { style: VisualStylePreset; priority: boolean; scrollRoot: RefObject<HTMLDivElement | null> }) {
    const { t } = useI18n()
    const frameRef = useRef<HTMLDivElement>(null)
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [shouldLoad, setShouldLoad] = useState(priority)
    const [loaded, setLoaded] = useState(false)
    const [retryAttempt, setRetryAttempt] = useState(0)
    const [loadFailed, setLoadFailed] = useState(false)
    const canLoad = priority || shouldLoad
    const previewSrc = (() => {
        const src = getVisualStylePreviewSrc(style)
        return `${src}${src.includes('?') ? '&' : '?'}retry=${retryAttempt}`
    })()

    useEffect(
        () => () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        },
        []
    )

    useEffect(() => {
        if (priority) return

        const frame = frameRef.current
        if (!frame || typeof IntersectionObserver === 'undefined') {
            setShouldLoad(true)
            return
        }

        const observer = new IntersectionObserver(
            entries => {
                if (!entries.some(entry => entry.isIntersecting)) return
                setShouldLoad(true)
                observer.disconnect()
            },
            { root: scrollRoot.current, rootMargin: '60px 0px' }
        )
        observer.observe(frame)
        return () => observer.disconnect()
    }, [priority, scrollRoot])

    return (
        <div
            ref={frameRef}
            className="relative h-full w-full bg-gray-900">
            {!loaded && !loadFailed && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/[0.035] animate-pulse">
                    {canLoad && <Loader2 className="h-4 w-4 animate-spin text-gray-600" />}
                    {retryAttempt > 0 && <span className="text-[10px] text-gray-600">{t('正在重新加载')}</span>}
                </div>
            )}
            {loadFailed && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-purple-950/70 via-gray-900 to-gray-950 px-3 text-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-400/25 bg-purple-500/10 text-sm font-semibold text-purple-300">
                        {t(style.label).slice(0, 1)}
                    </span>
                    <span className="text-[11px] leading-4 text-gray-400">
                        {t(style.label)}
                        {t('预览加载失败')}
                    </span>
                </div>
            )}
            {canLoad && !loadFailed && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={previewSrc}
                    src={previewSrc}
                    alt={`${t(style.label)} · ${t('风格预览')}`}
                    width={400}
                    height={700}
                    onLoad={() => setLoaded(true)}
                    onError={() => {
                        setLoaded(false)
                        if (retryAttempt >= 3) {
                            setLoadFailed(true)
                            return
                        }
                        retryTimerRef.current = setTimeout(
                            () => {
                                setRetryAttempt(current => current + 1)
                            },
                            350 * 2 ** retryAttempt
                        )
                    }}
                    loading={priority ? 'eager' : 'lazy'}
                    fetchPriority={priority ? 'high' : 'auto'}
                    decoding="async"
                    className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            )}
        </div>
    )
}
