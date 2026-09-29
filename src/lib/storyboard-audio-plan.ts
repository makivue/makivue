type StoryboardAudioCue = {
    id: string
    mode: 'dialogue' | 'voice_over' | 'inner_monologue'
    speaker: string | null
    text: string
    startTime: number
    endTime: number
    lipSync: boolean
}

export type StoryboardAudioPlan = {
    version: 1
    duration: number
    cues: StoryboardAudioCue[]
}

function roundTime(value: number) {
    return Number(Math.max(0, value).toFixed(2))
}

function readingWeight(value: string) {
    const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
    const words = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
    return Math.max(1, cjk + words * 1.7)
}

function turns(value: string | null | undefined) {
    return (value ?? '')
        .split(/\r?\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const match = line.match(/^([^:：\n]{1,40})[:：]\s*(.+)$/)
            return match ? { speaker: match[1].trim(), text: match[2].trim() } : { speaker: null, text: line }
        })
        .filter(turn => !!turn.text)
}

function narrationMode(speaker: string | null): StoryboardAudioCue['mode'] {
    return speaker && /[（(](?:内心|心声|独白)[）)]|inner/i.test(speaker) ? 'inner_monologue' : 'voice_over'
}

export function buildStoryboardAudioPlan(input: { duration?: number | null; dialogue?: string | null; narration?: string | null }): StoryboardAudioPlan | null {
    const duration = Math.max(1, Math.round(input.duration ?? 10))
    const rawCues = [
        ...turns(input.dialogue).map(turn => ({ ...turn, mode: 'dialogue' as const, lipSync: true })),
        ...turns(input.narration).map(turn => ({ ...turn, mode: narrationMode(turn.speaker), lipSync: false }))
    ]
    if (!rawCues.length) return null
    const padding = Math.min(0.5, duration * 0.08)
    const available = Math.max(0.5, duration - padding * 2)
    const totalWeight = rawCues.reduce((sum, cue) => sum + readingWeight(cue.text), 0)
    let cursor = padding
    const cues = rawCues.map((cue, index): StoryboardAudioCue => {
        const isLast = index === rawCues.length - 1
        const cueDuration = isLast ? duration - padding - cursor : (available * readingWeight(cue.text)) / totalWeight
        const startTime = roundTime(cursor)
        const endTime = roundTime(Math.min(duration, cursor + Math.max(0.35, cueDuration)))
        cursor = endTime
        return { id: `A${String(index + 1).padStart(2, '0')}`, mode: cue.mode, speaker: cue.speaker, text: cue.text, startTime, endTime, lipSync: cue.lipSync }
    })
    return { version: 1, duration, cues }
}

export function normalizeStoryboardAudioPlan(value: unknown, fallback: { duration?: number | null; dialogue?: string | null; narration?: string | null }): StoryboardAudioPlan | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return buildStoryboardAudioPlan(fallback)
    const input = value as Record<string, unknown>
    if (!Array.isArray(input.cues)) return buildStoryboardAudioPlan(fallback)
    const duration = Math.max(1, Math.round(Number(input.duration) || fallback.duration || 10))
    const cues = input.cues
        .map((raw, index): StoryboardAudioCue | null => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
            const cue = raw as Record<string, unknown>
            const text = typeof cue.text === 'string' ? cue.text.trim() : ''
            const mode = cue.mode === 'dialogue' || cue.mode === 'voice_over' || cue.mode === 'inner_monologue' ? cue.mode : null
            const startTime = Number(cue.startTime)
            const endTime = Number(cue.endTime)
            if (!text || !mode || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null
            return {
                id: typeof cue.id === 'string' && cue.id.trim() ? cue.id.trim() : `A${String(index + 1).padStart(2, '0')}`,
                mode,
                speaker: typeof cue.speaker === 'string' && cue.speaker.trim() ? cue.speaker.trim() : null,
                text,
                startTime: roundTime(Math.min(duration, startTime)),
                endTime: roundTime(Math.min(duration, endTime)),
                lipSync: mode === 'dialogue'
            }
        })
        .filter((cue): cue is StoryboardAudioCue => !!cue)
        .sort((a, b) => a.startTime - b.startTime)
    return cues.length ? { version: 1, duration, cues } : buildStoryboardAudioPlan(fallback)
}

export function buildAudioTimelineDirection(plan: StoryboardAudioPlan | null) {
    if (!plan) return ''
    return [
        `AUDIO TIMELINE — follow these cue windows within the ${plan.duration}s shot:`,
        ...plan.cues.map(cue => {
            const speaker = cue.speaker ? ` (${cue.speaker})` : ''
            const behavior = cue.lipSync ? 'visible speaker lip-syncs only during this window' : 'off-screen voice; no visible mouth movement'
            return `${cue.startTime}s-${cue.endTime}s ${cue.mode}${speaker}: "${cue.text}"; ${behavior}.`
        }),
        'Keep scene ambience continuous under all cues. Do not repeat, overlap, reorder, or assign a cue to another mouth.'
    ].join(' ')
}
