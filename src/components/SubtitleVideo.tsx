'use client'

import AppVideo, { type AppVideoProps } from '@/components/AppVideo'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { localeDisplayName } from '@/i18n/config'
import { clientFetch } from '@/lib/client-fetch'
import { buildBilingualSubtitleCues, parseSubtitleCues, selectedSubtitleLanguage, subtitleTrackLanguages, type SubtitleCue, type SubtitleSource } from '@/lib/subtitle-playback'
import { bindNativeSubtitleCues } from '@/lib/subtitle-native-track'

type Props = Omit<AppVideoProps, 'ref'> & {
    subtitles: SubtitleSource[]
    subtitleEndpoint?: string
    videoRef?: RefObject<HTMLVideoElement | null>
    mediaKey?: string | number
    frameClassName?: string
}
type LoadedTrack = { lang: string; cues: SubtitleCue[] }
// Load each native track once; its URL never changes as translations arrive.
const EMPTY_SUBTITLE_URL = 'data:text/vtt,WEBVTT%0A%0A'

export default function SubtitleVideo({ subtitles, subtitleEndpoint, videoRef, mediaKey, frameClassName = '', ...videoProps }: Props) {
    const { locale, t } = useI18n()
    const localRef = useRef<HTMLVideoElement>(null)
    const ref = videoRef ?? localRef
    const [preference, setPreference] = useState<string | null>(null)
    // API polling creates fresh arrays; keep an unchanged subtitle set stable.
    const sourceKey = JSON.stringify(subtitles)
    const sources = useMemo(() => JSON.parse(sourceKey) as SubtitleSource[], [sourceKey])
    const requestKey = `${videoProps.src}:${sourceKey}:${subtitleEndpoint ?? ''}`
    const [loaded, setLoaded] = useState<{ key: string; tracks: LoadedTrack[]; failed: string[] }>({ key: '', tracks: [], failed: [] })
    const loadedTracks = useMemo(() => (loaded.key === requestKey ? loaded.tracks : []), [loaded, requestKey])
    // Reserve every language's place before fetching so native caption menus
    // keep the same order regardless of which download finishes first.
    const tracks = subtitleTrackLanguages(sources)
    const nativeTracks = useMemo(() => {
        const english = loadedTracks.find(track => track.lang === 'en')
        const chinese = loadedTracks.find(track => track.lang === 'zh')
        return [...loadedTracks, { lang: 'en-zh', cues: buildBilingualSubtitleCues(english?.cues ?? [], chinese?.cues ?? []) }]
    }, [loadedTracks])
    const failed = loaded.key === requestKey ? loaded.failed : []
    // Keep an explicit preference even when one episode lacks that language.
    const selected = selectedSubtitleLanguage(sources, locale, preference)
    const requiredLanguages = selected === 'en-zh' ? ['en', 'zh'] : selected === 'off' ? [] : [selected]
    const loading = requiredLanguages.some(lang => !loadedTracks.some(track => track.lang === lang) && !failed.includes(lang))
    const hasError = requiredLanguages.some(lang => failed.includes(lang))

    useEffect(() => {
        const controller = new AbortController()
        const publish = (lang: string, cues: SubtitleCue[]) => {
            setLoaded(current => ({ key: requestKey, tracks: [...(current.key === requestKey ? current.tracks : []), { lang, cues }], failed: current.key === requestKey ? current.failed : [] }))
        }
        for (const source of sources) {
            const url = subtitleEndpoint ? `${subtitleEndpoint}&lang=${encodeURIComponent(source.lang)}` : source.url
            void clientFetch(url, { signal: controller.signal, timeoutMs: 35_000 })
                .then(async response => {
                    if (!response.ok) throw new Error('subtitle-load-failed')
                    const cues = parseSubtitleCues(await response.text())
                    if (!cues.length) throw new Error('subtitle-empty')
                    if (controller.signal.aborted) return
                    publish(source.lang, cues)
                })
                .catch(() => {
                    if (controller.signal.aborted) return
                    setLoaded(current => ({ key: requestKey, tracks: current.key === requestKey ? current.tracks : [], failed: [...(current.key === requestKey ? current.failed : []), source.lang] }))
                })
        }
        return () => {
            controller.abort()
        }
    }, [requestKey, sources, subtitleEndpoint])

    useEffect(() => {
        const video = ref.current
        if (!video) return
        // The response is already parsed. Wait for the native track's initial
        // load before adding cues, since that load clears pre-existing cues.
        const cleanups: Array<() => void> = []
        for (const element of video.querySelectorAll('track')) {
            const loadedTrack = nativeTracks.find(track => track.lang === element.dataset.language)
            cleanups.push(bindNativeSubtitleCues(element, loadedTrack?.cues ?? []))
        }
        return () => cleanups.forEach(cleanup => cleanup())
    }, [ref, nativeTracks, videoProps.src, mediaKey])

    useEffect(() => {
        const video = ref.current
        if (!video) return
        // Hidden tracks preload without displaying, so every language is ready
        // when selected from the browser's caption menu.
        for (const element of video.querySelectorAll('track')) element.track.mode = element.dataset.language === selected ? 'showing' : 'hidden'
        const syncNativeSelection = () => {
            const elements = [...video.querySelectorAll('track')]
            if (!elements.length) return
            const showing = elements.find(element => element.track.mode === 'showing')
            const language = showing?.dataset.language ?? 'off'
            // Remember native menu choices immediately, even before the
            // subtitle response arrives. Download completion must not reset it.
            if (language !== selected) setPreference(language)
        }
        video.textTracks.addEventListener('change', syncNativeSelection)
        return () => video.textTracks.removeEventListener('change', syncNativeSelection)
    }, [ref, selected, sourceKey, videoProps.src, mediaKey])

    return (
        <div className={`relative min-w-0 w-full ${frameClassName}`}>
            <AppVideo
                {...videoProps}
                // An explicit key lets continuous playback reuse the same media element.
                key={mediaKey ?? `${videoProps.src}`}
                ref={ref}
                playsInline>
                {tracks.map(lang => (
                    <track
                        key={lang}
                        src={EMPTY_SUBTITLE_URL}
                        kind="subtitles"
                        srcLang={lang === 'en-zh' ? 'en' : lang}
                        label={lang === 'en-zh' ? `${localeDisplayName(locale, 'en')} + ${localeDisplayName(locale, 'zh')}` : localeDisplayName(locale, lang)}
                        data-language={lang}
                        default={lang === selected}
                    />
                ))}
            </AppVideo>
            {(loading || hasError) && (
                <span
                    role="status"
                    className="pointer-events-none absolute start-3 top-3 rounded bg-black/70 px-2 py-1 text-xs text-white">
                    {t(hasError ? '部分字幕加载失败' : '字幕加载中…')}
                </span>
            )}
        </div>
    )
}
