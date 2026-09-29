const VIDEO_LANGUAGES = ['zh', 'en'] as const
export type VideoLanguage = (typeof VIDEO_LANGUAGES)[number]

export function isVideoLanguage(value: unknown): value is VideoLanguage {
    return typeof value === 'string' && VIDEO_LANGUAGES.includes(value as VideoLanguage)
}

export function normalizeVideoLanguage(value: unknown): VideoLanguage {
    return isVideoLanguage(value) ? value : 'zh'
}

export function videoLanguageName(language: VideoLanguage): string {
    return language === 'en' ? 'English' : '中文'
}

export function buildVideoLanguageLock(language: VideoLanguage, dialogue?: string | null, narration?: string | null): string {
    const exactLine = dialogue?.trim()
    const exactNarration = narration?.trim()
    const narrationRule = exactNarration
        ? ` The off-screen voice-over says exactly: "${exactNarration}". Keep it off-screen and do not assign its words or lip movement to a visible character.`
        : ' Do not add off-screen narration.'
    if (language === 'en') {
        return exactLine
            ? `AUDIO LANGUAGE LOCK: all spoken dialogue and vocal performance must be in natural English only. The visible speaker says exactly: "${exactLine}".${narrationRule} Do not speak Chinese, translate again, paraphrase, or add another voice.`
            : `AUDIO LANGUAGE LOCK: if any speech or vocal performance is generated, it must be in natural English only.${narrationRule}`
    }
    return exactLine
        ? `AUDIO LANGUAGE LOCK: all spoken dialogue and vocal performance must be in natural Mandarin Chinese only. The visible speaker says exactly: "${exactLine}".${narrationRule} Do not speak English, translate again, paraphrase, or add another voice.`
        : `AUDIO LANGUAGE LOCK: if any speech or vocal performance is generated, it must be in natural Mandarin Chinese only.${narrationRule}`
}
