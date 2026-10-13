'use client'

import { useEffect, useImperativeHandle, useRef, type Ref, type VideoHTMLAttributes } from 'react'
import { videoPreloadScheduler } from '@/lib/video-preload'

export type AppVideoProps = VideoHTMLAttributes<HTMLVideoElement> & {
    ref?: Ref<HTMLVideoElement>
    loading?: 'viewport' | 'eager'
}

/** Native playback with consistent controls and bounded, nearby preloading. */
export default function AppVideo({ ref, loading = 'viewport', preload = 'auto', controlsList, playsInline = true, ...props }: AppVideoProps) {
    const localRef = useRef<HTMLVideoElement>(null)
    useImperativeHandle(ref, () => localRef.current!)

    useEffect(() => {
        const video = localRef.current
        if (!video || !props.src) return
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
        const conserveData = connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
        const mode = conserveData || preload === 'metadata' ? 'metadata' : 'auto'
        let nearby = loading === 'eager' || !!props.autoPlay
        if (!nearby && video.paused) video.preload = 'none'
        let cancel = () => {}
        const warm = (priority = false) => {
            if (document.hidden || preload === 'none') return
            cancel = videoPreloadScheduler.request(video, priority && !conserveData ? 'auto' : mode, priority)
        }
        const onIntent = () => warm(true)
        const onVisibility = () => {
            if (document.hidden) cancel()
            else if (nearby) warm()
        }
        const observer =
            typeof IntersectionObserver === 'undefined'
                ? null
                : new IntersectionObserver(
                      ([entry]) => {
                          nearby = entry.isIntersecting
                          if (nearby) warm()
                          else {
                              cancel()
                              if (video.paused && !video.autoplay) video.preload = 'none'
                          }
                      },
                      { rootMargin: '240px 0px' }
                  )

        if (nearby || !observer) warm()
        if (loading !== 'eager' && !props.autoPlay) observer?.observe(video)
        video.addEventListener('pointerenter', onIntent)
        video.addEventListener('focus', onIntent)
        video.addEventListener('touchstart', onIntent, { passive: true })
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            cancel()
            observer?.disconnect()
            video.removeEventListener('pointerenter', onIntent)
            video.removeEventListener('focus', onIntent)
            video.removeEventListener('touchstart', onIntent)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [props.src, props.autoPlay, loading, preload])

    return (
        <video
            {...props}
            ref={localRef}
            controlsList={[...new Set(`${controlsList ?? ''} nodownload`.trim().split(/\s+/))].join(' ')}
            playsInline={playsInline}
            preload={preload === 'none' ? 'none' : loading === 'eager' || props.autoPlay ? preload : 'none'}
        />
    )
}
