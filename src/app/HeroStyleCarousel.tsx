'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { getStylePreviewSrc } from '@/lib/style-preview'
import styles from './HomeStudio.module.css'

const INITIAL_KEYS = ['xianxia', 'cinematic', 'anime-film']
const SCENES = [...INITIAL_KEYS.map(key => VISUAL_STYLE_PRESETS.find(style => style.key === key)!), ...VISUAL_STYLE_PRESETS.filter(style => !INITIAL_KEYS.includes(style.key))].map(style => ({
    key: style.key,
    label: style.label,
    src: getStylePreviewSrc(style.key)
}))
const VISIBLE_SLIDES = 5
const ROTATION_INTERVAL = 4500

function preloadScene(src: string, signal: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
        const image = new Image()
        let settled = false
        const finish = (ready: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            signal.removeEventListener('abort', cancel)
            if (!ready) image.src = ''
            resolve(ready)
        }
        const cancel = () => finish(false)
        const timeout = setTimeout(cancel, 8000)
        signal.addEventListener('abort', cancel, { once: true })
        image.src = src
        image.decode().then(
            () => finish(true),
            () => finish(false)
        )
    })
}

export default function HeroStyleCarousel() {
    const { t } = useI18n()
    const viewport = useRef<HTMLDivElement>(null)
    const pending = useRef<AbortController | null>(null)
    const busy = useRef(false)
    const [cursor, setCursor] = useState(0)
    const [direction, setDirection] = useState(0)
    const sceneAt = (index: number) => SCENES[(index + SCENES.length) % SCENES.length]

    const advance = useCallback(
        async (step: number) => {
            if (busy.current) return
            busy.current = true
            const controller = new AbortController()
            pending.current = controller
            const destination = (cursor + step + SCENES.length) % SCENES.length
            const next = Array.from({ length: VISIBLE_SLIDES }, (_, index) => SCENES[(destination + index) % SCENES.length])
            const ready = await Promise.all(next.map(scene => preloadScene(scene.src, controller.signal)))
            if (controller.signal.aborted) return
            if (!ready.every(Boolean)) {
                busy.current = false
                return
            }
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                setCursor(destination)
                busy.current = false
            } else {
                setDirection(step)
            }
        },
        [cursor]
    )

    useEffect(() => {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
        let visible = true
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
        })
        if (viewport.current) observer.observe(viewport.current)
        const timer = setInterval(() => {
            if (visible && !document.hidden && !reducedMotion.matches) void advance(1)
        }, ROTATION_INTERVAL)
        return () => {
            clearInterval(timer)
            observer.disconnect()
            pending.current?.abort()
            busy.current = false
        }
    }, [advance])

    return (
        <div
            ref={viewport}
            className={styles.sceneStrip}
            role="region"
            aria-label={t('视觉风格')}>
            <div
                className={styles.sceneViewport}
                dir="ltr"
                aria-hidden="true">
                <div
                    className={styles.sceneTrack}
                    data-direction={direction}
                    onTransitionEnd={event => {
                        if (event.target !== event.currentTarget || event.propertyName !== 'transform' || direction === 0) return
                        setCursor(current => (current + direction + SCENES.length) % SCENES.length)
                        setDirection(0)
                        busy.current = false
                    }}>
                    {Array.from({ length: VISIBLE_SLIDES + 2 }, (_, index) => sceneAt(cursor + index - 1)).map((scene, index) => (
                        <div
                            key={scene.key}
                            data-style-key={scene.key}
                            data-desktop-distance={Math.abs(index - (3 + direction))}
                            data-mobile-distance={Math.abs(index - (2 + direction))}
                            className={styles.scene}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={scene.src}
                                alt=""
                                width={400}
                                height={700}
                                fetchPriority={cursor === 0 && index === 2 ? 'high' : 'auto'}
                                decoding="async"
                                draggable={false}
                                onError={event => {
                                    event.currentTarget.style.opacity = '0'
                                }}
                            />
                            <span
                                dir="auto"
                                title={t(scene.label)}>
                                {t(scene.label)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
            <button
                type="button"
                className={`${styles.sceneArrow} ${styles.scenePrevious}`}
                aria-label={t('上一张')}
                onClick={() => void advance(-1)}
                disabled={direction !== 0}>
                <ChevronLeft size={18} />
            </button>
            <button
                type="button"
                className={`${styles.sceneArrow} ${styles.sceneNext}`}
                aria-label={t('下一张')}
                onClick={() => void advance(1)}
                disabled={direction !== 0}>
                <ChevronRight size={18} />
            </button>
        </div>
    )
}
