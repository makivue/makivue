import { isLocale, locales, type Locale } from '@/i18n/config'

export type SubtitleSource = { lang: Locale; url: string }
export type SubtitleCue = { start: number; end: number; text: string }
export type SubtitleTrackLanguage = Locale | 'en-zh'

export function subtitleTrackLanguages(sources: SubtitleSource[]): SubtitleTrackLanguage[] {
    const available = new Set(sources.map(source => source.lang))
    const order: Locale[] = ['zh', 'en', ...locales.filter(lang => lang !== 'zh' && lang !== 'en')]
    const singleLanguages = order.filter(lang => available.has(lang))
    return available.has('en') && available.has('zh') ? ['en-zh', ...singleLanguages] : singleLanguages
}

export function selectedSubtitleLanguage(sources: SubtitleSource[], locale: Locale, preference: string | null): SubtitleTrackLanguage | 'off' {
    const languages = subtitleTrackLanguages(sources)
    // Preserve a viewer's explicit choice, including Off, between episodes.
    if (preference !== null) return languages.find(lang => lang === preference) ?? 'off'
    if (languages.includes('en-zh')) return 'en-zh'
    if (languages.includes(locale)) return locale
    return languages.includes('en') ? 'en' : (languages[0] ?? 'off')
}

/** One native cue displays both languages, including in fullscreen playback.
 * Split at every language's boundary so old files with different timing never
 * pair a sentence with the translation of a different moment.
 */
export function buildBilingualSubtitleCues(english: SubtitleCue[], chinese: SubtitleCue[]): SubtitleCue[] {
    const events = [english, chinese]
        .flatMap((cues, language) =>
            cues.flatMap(cue => [
                { time: cue.start, language, cue, entering: true },
                { time: cue.end, language, cue, entering: false }
            ])
        )
        .sort((a, b) => a.time - b.time)
    const active = [new Set<SubtitleCue>(), new Set<SubtitleCue>()]
    const result: SubtitleCue[] = []
    let index = 0
    while (index < events.length) {
        const start = events[index].time
        while (index < events.length && events[index].time === start) {
            const event = events[index++]
            if (event.entering) active[event.language].add(event.cue)
            else active[event.language].delete(event.cue)
        }
        const end = events[index]?.time
        if (end === undefined || end <= start) continue
        const text = active
            .map(cues => [...cues].map(cue => cue.text.replace(/\s+/g, ' ').trim()).join(' '))
            .filter(Boolean)
            .join('\n')
        if (!text) continue
        const previous = result.at(-1)
        if (previous?.end === start && previous.text === text) previous.end = end
        else result.push({ start, end, text })
    }
    return result
}

export function parseSubtitleUrls(raw: unknown): SubtitleSource[] {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        return Object.entries(value).flatMap(([lang, url]) =>
            isLocale(lang) && typeof url === 'string' && /^\/api\/local-media\/[a-zA-Z0-9%_./-]+$/.test(url.trim()) ? [{ lang, url: url.trim() }] : []
        )
    } catch {
        return []
    }
}

export function mergedVideoSubtitles(episode: { videoUrl: string | null; merges: Array<{ videoUrl: string | null; subtitleUrls: string | null }> }): SubtitleSource[] {
    if (!episode.videoUrl) return []
    const merge = episode.merges.find(item => item.videoUrl?.trim() === episode.videoUrl?.trim())
    return parseSubtitleUrls(merge?.subtitleUrls)
}

function timestampSeconds(value: string): number {
    return value
        .replace(',', '.')
        .split(':')
        .reduce((total, part) => total * 60 + Number(part), 0)
}

/** Accept both the generated SRT files and the proxy's WebVTT response. */
export function parseSubtitleCues(source: string): SubtitleCue[] {
    return source
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n/)
        .flatMap(block => {
            const lines = block.trim().split('\n')
            if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) return []
            const timingIndex = lines.findIndex(line => line.includes('-->'))
            if (timingIndex < 0) return []
            const timing = lines[timingIndex].match(/^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s|$)/)
            if (!timing) return []
            const start = timestampSeconds(timing[1])
            const end = timestampSeconds(timing[2])
            const text = lines
                .slice(timingIndex + 1)
                .join('\n')
                .trim()
            return end > start && text ? [{ start, end, text }] : []
        })
        .sort((a, b) => a.start - b.start)
}
