type StoryboardPerformanceState = {
    index: number
    state: string
    trigger?: string
    gazeTarget?: string
    facialPerformance?: string
    bodyPerformance?: string
    propMotion?: string
}

export type StoryboardActionPlan = {
    version: 1
    opening: string
    middles: StoryboardPerformanceState[]
    ending: string
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function stateText(value: unknown) {
    const item = record(value)
    return item ? text(item.state ?? item.description ?? item.text) : text(value)
}

export function parseLegacyStoryboardActionPlan(actionDesc: string | null | undefined): StoryboardActionPlan | null {
    const source = actionDesc?.trim()
    if (!source) return null
    const labels = [
        ...source.matchAll(/(?:^|[;；\n]\s*)(Opening state|Middle state\s*\d*|Ending state)\s*[:：]\s*([\s\S]*?)(?=(?:[;；\n]\s*)(?:Opening state|Middle state\s*\d*|Ending state)\s*[:：]|$)/gi)
    ]
    let opening = ''
    let ending = ''
    const middles: StoryboardPerformanceState[] = []
    for (const match of labels) {
        const label = match[1]
        const state = match[2].replace(/^[;；,，\s]+|[;；,，\s]+$/g, '').trim()
        if (!state) continue
        if (/^Opening/i.test(label)) opening = state
        else if (/^Ending/i.test(label)) ending = state
        else middles.push({ index: Number(label.match(/\d+/)?.[0] ?? middles.length + 1), state })
    }
    if (!opening || !ending) return null
    return { version: 1, opening, middles: middles.sort((a, b) => a.index - b.index), ending }
}

export function normalizeStoryboardActionPlan(value: unknown, fallbackActionDesc?: string | null): StoryboardActionPlan | null {
    const input = record(value)
    if (!input) return parseLegacyStoryboardActionPlan(fallbackActionDesc)
    const opening = stateText(input.opening)
    const ending = stateText(input.ending)
    const rawMiddles = Array.isArray(input.middles) ? input.middles : Array.isArray(input.middleStates) ? input.middleStates : []
    const middles = rawMiddles
        .map((raw, position): StoryboardPerformanceState | null => {
            const item = record(raw)
            const state = stateText(raw)
            if (!state) return null
            const parsedIndex = item && typeof item.index === 'number' && Number.isFinite(item.index) ? Math.round(item.index) : position + 1
            return {
                index: Math.max(1, parsedIndex),
                state,
                ...(text(item?.trigger) ? { trigger: text(item?.trigger) } : {}),
                ...(text(item?.gazeTarget) ? { gazeTarget: text(item?.gazeTarget) } : {}),
                ...(text(item?.facialPerformance) ? { facialPerformance: text(item?.facialPerformance) } : {}),
                ...(text(item?.bodyPerformance) ? { bodyPerformance: text(item?.bodyPerformance) } : {}),
                ...(text(item?.propMotion) ? { propMotion: text(item?.propMotion) } : {})
            }
        })
        .filter((item): item is StoryboardPerformanceState => !!item)
        .sort((a, b) => a.index - b.index)
        .map((item, position) => ({ ...item, index: position + 1 }))
    if (!opening || !ending) return parseLegacyStoryboardActionPlan(fallbackActionDesc)
    return { version: 1, opening, middles, ending }
}

function middleDescription(middle: StoryboardPerformanceState) {
    return [
        middle.state,
        middle.trigger ? `触发：${middle.trigger}` : null,
        middle.gazeTarget ? `视线目标：${middle.gazeTarget}` : null,
        middle.facialPerformance ? `脸部/呼吸：${middle.facialPerformance}` : null,
        middle.bodyPerformance ? `身体表演：${middle.bodyPerformance}` : null,
        middle.propMotion ? `道具运动：${middle.propMotion}` : null
    ]
        .filter(Boolean)
        .join('；')
}

export function serializeStoryboardActionPlan(plan: StoryboardActionPlan): string {
    return [`Opening state: ${plan.opening}`, ...plan.middles.map(middle => `Middle state ${middle.index}: ${middleDescription(middle)}`), `Ending state: ${plan.ending}`].join('; ')
}

export function resolveStoryboardActionDesc(actionPlan: unknown, fallbackActionDesc: string | null | undefined): string {
    const plan = normalizeStoryboardActionPlan(actionPlan, fallbackActionDesc)
    return plan ? serializeStoryboardActionPlan(plan) : fallbackActionDesc?.trim() || ''
}

export function hasStructuredPerformanceDetails(plan: StoryboardActionPlan, index: number) {
    const middle = plan.middles.find(item => item.index === index)
    if (!middle) return false
    const performanceFields = [middle.facialPerformance, middle.bodyPerformance, middle.propMotion].filter(Boolean).length
    return !!middle.trigger && !!middle.gazeTarget && performanceFields >= 2
}
