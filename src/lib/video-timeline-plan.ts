import { getHiModelsVideoApiModel, isHiModelsH3Provider, isHiModelsVeoProvider, type ProductionVideoProvider, type VideoReferenceMode } from './provider-capabilities'

export const VIDEO_TIMELINE_PLAN_VERSION = 'semantic-beats-v2'

export type VideoTimelineWindow = {
    start: number
    end: number
    label: string
}

function formatTimelineSecond(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function timelineLabel(start: number, end: number) {
    return `[${formatTimelineSecond(start)}s-${formatTimelineSecond(end)}s]`
}

function extractSemanticBeats(actionDesc?: string | null) {
    const action = actionDesc?.replace(/\s+/g, ' ').trim()
    if (!action) return []

    const stateLabel =
        /(?:Opening state|Beginning state|Start state|Middle state\s*\d*|Mid state\s*\d*|Ending state|End state|Final state|开场状态|首帧状态|开始状态|中间状态\s*\d*|中间帧\s*\d*|结束状态|最终状态)\s*[:：]/gi
    const matches = Array.from(action.matchAll(stateLabel))
    if (matches.length > 0) {
        return matches
            .map((match, index) => {
                const start = (match.index ?? 0) + match[0].length
                const end = matches[index + 1]?.index ?? action.length
                return action
                    .slice(start, end)
                    .replace(/^[;；,，\s]+|[;；,，\s]+$/g, '')
                    .trim()
            })
            .filter(Boolean)
    }

    return action
        .split(/\s*(?:→|⇒|->|然后|随后|接着|继而|最终|最后|\n|[;；])\s*/i)
        .map(part => part.trim())
        .filter(Boolean)
}

function countDialogueBeats(dialogue?: string | null) {
    if (!dialogue?.trim()) return 0
    return dialogue
        .split(/\n+|[;；]+/)
        .map(part => part.trim())
        .filter(Boolean).length
}

/**
 * Builds a deterministic fallback only. The normal LLM path chooses its own
 * boundaries from the storyboard semantics under buildVideoTimelineInstructions.
 */
export function buildSemanticVideoTimelineWindows(params: { duration: number; actionDesc?: string | null; dialogue?: string | null }): VideoTimelineWindow[] {
    const total = Math.max(1, Math.round(params.duration))
    const semanticBeats = extractSemanticBeats(params.actionDesc)
    const dialogueBeats = countDialogueBeats(params.dialogue)
    const requestedBeatCount = Math.max(semanticBeats.length, dialogueBeats > 0 ? dialogueBeats + (semanticBeats.length > 0 ? 1 : 0) : 0, 1)
    const maxUsefulBeatCount = Math.max(1, Math.min(6, Math.floor(total / 1.25)))
    const beatCount = Math.min(requestedBeatCount, maxUsefulBeatCount)

    if (beatCount === 1) return [{ start: 0, end: total, label: timelineLabel(0, total) }]

    const weights = Array.from({ length: beatCount }, (_, index) => {
        if (index === 0) return 0.85
        if (index === beatCount - 1) return 1.15
        return 1
    })
    if (params.dialogue?.trim()) {
        const speechIndex = Math.min(beatCount - 1, Math.max(1, Math.floor(beatCount / 2)))
        weights[speechIndex] += Math.min(1.5, params.dialogue.trim().length / 30)
    }

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    const windows: VideoTimelineWindow[] = []
    let start = 0
    let cumulativeWeight = 0
    for (let index = 0; index < beatCount; index += 1) {
        cumulativeWeight += weights[index]
        const remaining = beatCount - index - 1
        const rawEnd = index === beatCount - 1 ? total : (total * cumulativeWeight) / totalWeight
        const roundedEnd = Math.round(rawEnd * 2) / 2
        const end = index === beatCount - 1 ? total : Math.min(total - remaining * 0.5, Math.max(start + 0.5, roundedEnd))
        windows.push({ start, end, label: timelineLabel(start, end) })
        start = end
    }
    return windows
}

export function isCompleteVideoTimeline(value: string | null | undefined, duration: number) {
    if (!value?.trim()) return false
    const labelPattern = /\[(\d+(?:\.\d+)?)\s*s?\s*-\s*(\d+(?:\.\d+)?)\s*s\]/gi
    const labels = Array.from(value.matchAll(labelPattern))
    if (labels.length === 0) return false

    const total = Math.max(1, Math.round(duration))
    let previousEnd = 0
    for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index]
        const start = Number(label[1])
        const end = Number(label[2])
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false
        if (Math.abs(start - previousEnd) > 0.05) return false

        const contentStart = (label.index ?? 0) + label[0].length
        const contentEnd = labels[index + 1]?.index ?? value.length
        const content = value.slice(contentStart, contentEnd)
        // Labels alone are not an executable plan. Reject empty slots instead
        // of accepting a timestamp-shaped response with no motion direction.
        for (const field of ['SUBJECT ACTION', 'CAMERA', 'CONTINUITY/TRANSITION']) {
            const fieldText = content.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=SUBJECT ACTION\\s*:|CAMERA\\s*:|CONTINUITY/TRANSITION\\s*:|$)`, 'i'))?.[1]
            if (!fieldText?.replace(/[\s;；|.-]/g, '').trim()) return false
        }
        previousEnd = end
    }
    return Math.abs(previousEnd - total) <= 0.05
}

export function minimumReferenceImageCount(mode: VideoReferenceMode) {
    if (mode === 'first_last') return 2
    if (mode === 'single') return 1
    return 0
}

export function hasRequiredReferenceFrames(mode: VideoReferenceMode, frames: { firstFrameUrl?: string | null; plannedLastFrameUrl?: string | null; lastFrameUrl?: string | null }) {
    if (mode === 'text') return true
    if (!frames.firstFrameUrl) return false
    if (mode === 'first_last') {
        const endingFrame = frames.plannedLastFrameUrl ?? frames.lastFrameUrl
        return !!endingFrame && endingFrame !== frames.firstFrameUrl
    }
    return true
}

function providerRules(provider: ProductionVideoProvider) {
    if (provider === 'wanx') {
        return [
            'Happy Horse is visual-only: plan visible performance, subject motion, camera behavior and visual continuity; do not depend on speech audio or sound cues.',
            'When reference images are supplied, treat them as ordered visual anchors and describe the physical interpolation between them.'
        ]
    }
    if (provider === 'wan3' || provider === 'wan3prime') {
        return [
            `${provider === 'wan3prime' ? 'Wan 3.0 Prime' : 'Wan 3.0'} receives one prompt with optional multimodal references. Describe visible motion, camera behavior, dialogue performance and sound cues in one coherent timeline.`,
            'When both frame references exist, start from reference image 1 and naturally arrive at reference image 2 without a pose, identity, lighting or camera-axis jump.'
        ]
    }
    if (isHiModelsVeoProvider(provider)) {
        return [
            'Veo receives text only in this project, so every segment must restate the visible subject, spatial direction and composition needed to make the action unambiguous.',
            'Keep the short clip visually coherent; use a cut or scene transition only when the source storyboard explicitly requires it.'
        ]
    }
    if (isHiModelsH3Provider(provider)) {
        return [
            'MiniMax H3 receives one prompt with optional image and video references. Plan synchronized visible action, camera movement, dialogue, ambience and sound across the full timeline.',
            'When opening and ending frames are supplied, depart naturally from Image 1 and arrive exactly at Image 2; use native multi-shot transitions only when the storyboard explicitly needs them.'
        ]
    }
    if (getHiModelsVideoApiModel(provider)) {
        return [
            'Himodels Seedance receives one continuous prompt plus optional opening/ending references. Describe visible motion, camera behavior, dialogue performance and sound cues in one coherent timeline.',
            'When both frame references exist, depart naturally from Image 1 and settle exactly into Image 2 without a pose, identity, lighting or camera-axis jump.'
        ]
    }
    return [
        'Seedance receives one continuous prompt plus optional opening/ending references. Describe physical motion, camera behavior and native dialogue performance in the same timeline.',
        'When both frame references exist, the first segment must depart naturally from Image 1 and the final segment must settle exactly into Image 2.'
    ]
}

export function buildVideoTimelineInstructions(params: { duration: number; provider: ProductionVideoProvider; referenceMode: VideoReferenceMode }) {
    const total = Math.max(1, Math.round(params.duration))
    const referenceRule =
        params.referenceMode === 'first_last'
            ? 'Opening and ending images are both authoritative: begin from the opening image and finish on the ending image without an abrupt pose, identity, lighting or camera-axis jump.'
            : params.referenceMode === 'single'
              ? 'The opening image is authoritative: begin moving from that exact pose and composition without a frozen hold.'
              : 'No frame image is supplied: establish the opening composition explicitly in the first segment.'

    return [
        `Create a semantic-beat timeline that covers exactly 0s-${total}s. Choose the number of segments and every boundary from the actual storyboard action, dialogue delivery, emotional turn, camera intention and transition need.`,
        `Label every segment [startSeconds-endSeconds], keep all ranges chronological and contiguous from [0s-...] through [...-${total}s] with no gap or overlap. Half-second boundaries are allowed when useful.`,
        'Use the fewest segments that can express the shot clearly. A sustained action or performance may occupy several seconds; create a new segment only when the subject action, dramatic beat, camera behavior or transition meaningfully changes.',
        'Do not default to a 0-2 second opening followed by one-second bins, and do not force uniform segment lengths. Timing must come from the content rather than a preset template.',
        'Every segment must contain three explicit parts: SUBJECT ACTION (pose, gaze target, hands, body/prop motion and visible result); CAMERA (framing, position, direction, speed and when it settles); CONTINUITY/TRANSITION (how this segment inherits the previous visible state and hands off to the next).',
        'Camera behavior is planned inside each segment from the action and dramatic purpose. Do not apply one fixed camera movement to the whole storyboard, and do not move the camera without a visible narrative reason.',
        'Allocate enough time for readable physical motion and natural dialogue. Never stretch filler breathing, blinking, hair motion or vague emotion merely to fill a segment.',
        'Use a continuous visual handoff by default. Only describe a cut, dissolve, whip transition or scene change when the source explicitly contains that transition; otherwise write a motivated within-shot transition such as follow, reframe, reveal, settle or rack focus.',
        referenceRule,
        ...providerRules(params.provider)
    ].join('\n')
}

export function buildFallbackVideoTimeline(params: { duration: number; actionDesc?: string | null; dialogue?: string | null; shotType?: string | null; referenceMode: VideoReferenceMode }) {
    const windows = buildSemanticVideoTimelineWindows(params)
    const semanticBeats = extractSemanticBeats(params.actionDesc)
    const sourceAction = params.actionDesc?.trim() || 'advance the storyboard action with one clear, physically readable change'
    const dialogue = params.dialogue?.trim()
    const speechIndex = windows.length === 1 ? 0 : Math.min(windows.length - 1, Math.max(1, Math.floor(windows.length / 2)))

    return windows
        .map((window, index) => {
            const first = index === 0
            const last = index === windows.length - 1
            const semanticBeat = semanticBeats[index]
            const action = first
                ? `Begin from the ${params.referenceMode === 'text' ? 'described' : 'supplied'} opening composition and initiate this semantic beat: ${semanticBeat ?? sourceAction}`
                : last
                  ? `Complete this semantic beat with a clearly changed pose, gaze, hand/prop position and emotional result${semanticBeat ? `: ${semanticBeat}` : ''}${params.referenceMode === 'first_last' ? '; settle exactly into the supplied ending image' : ''}`
                  : `Execute the next observable semantic beat${semanticBeat ? `: ${semanticBeat}` : ''}; carry forward the preceding body and prop momentum`
            const speech = dialogue && index === speechIndex ? ` Keep visible mouth, breath and facial performance synchronized with: ${dialogue}` : ''
            const camera = first
                ? `Establish a ${params.shotType ?? 'medium'} composition; choose a motivated camera path from the subject action and keep the screen direction readable`
                : last
                  ? 'Complete the motivated reframe and settle cleanly on the final story result'
                  : 'Continue, hold or reframe only as required by this semantic beat to keep the active face, hands and prop readable; no arbitrary camera move'
            const continuity = first
                ? 'No frozen hold; inherit all visible identity, wardrobe, scene and lighting facts.'
                : last
                  ? 'No jump at the boundary; hold the completed result clearly.'
                  : 'Start from the exact previous pose and camera endpoint; hand off the new state without a cut.'
            return `${window.label} SUBJECT ACTION: ${action}.${speech} CAMERA: ${camera}. CONTINUITY/TRANSITION: ${continuity}`
        })
        .join('\n')
}
