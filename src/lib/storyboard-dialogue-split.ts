import { estimateDialogueDurationSeconds } from '@/lib/video-production-plan'

export type DialogueSplitPart = {
    dialogue: string
    speech: string
    estimatedSeconds: number
    duration: number
}

const WAN_MAXIMUM_AUDIO_SECONDS = 15
const WAN_MAXIMUM_NATURAL_SPEED = 1.12
const WAN_DURATION_EPSILON_SECONDS = 0.05

function speechWeight(value: string) {
    const cjk = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
    const words = (value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
    return Math.max(1, cjk + words * 1.7)
}

function splitSpeaker(dialogue: string) {
    const match = dialogue.trim().match(/^([^：:\n]{1,24}[：:])\s*([\s\S]*)$/)
    return match ? { prefix: match[1], speech: match[2].trim() } : { prefix: '', speech: dialogue.trim() }
}

function splitLargestClause(clauses: string[]) {
    if (clauses.length === 0) return clauses
    let largestIndex = 0
    for (let index = 1; index < clauses.length; index += 1) {
        if (speechWeight(clauses[index]) > speechWeight(clauses[largestIndex])) largestIndex = index
    }
    const value = clauses[largestIndex]
    const characters = Array.from(value)
    if (characters.length < 2) return clauses
    const midpoint = Math.floor(characters.length / 2)
    const splitCandidates = characters
        .map((character, index) => ({ character, index }))
        .filter(item => /[\s，,；;：:]/.test(item.character) && item.index > 0 && item.index < characters.length - 1)
        .sort((left, right) => Math.abs(left.index - midpoint) - Math.abs(right.index - midpoint))
    const splitAt = splitCandidates[0]?.index ?? midpoint
    const left = characters
        .slice(0, splitAt + 1)
        .join('')
        .trim()
    const right = characters
        .slice(splitAt + 1)
        .join('')
        .trim()
    if (!left || !right) return clauses
    return [...clauses.slice(0, largestIndex), left, right, ...clauses.slice(largestIndex + 1)]
}

function distributeClauses(clauses: string[], count: number) {
    const groups: string[][] = []
    let cursor = 0
    let remainingWeight = clauses.reduce((sum, clause) => sum + speechWeight(clause), 0)
    for (let groupIndex = 0; groupIndex < count; groupIndex += 1) {
        const groupsLeft = count - groupIndex
        const targetWeight = remainingWeight / groupsLeft
        const group: string[] = []
        let groupWeight = 0
        while (cursor < clauses.length) {
            const clause = clauses[cursor]
            const weight = speechWeight(clause)
            const mustLeave = clauses.length - (cursor + 1) >= groupsLeft - 1
            if (group.length > 0 && mustLeave && groupWeight + weight > targetWeight) break
            group.push(clause)
            groupWeight += weight
            cursor += 1
            if (!mustLeave) break
        }
        groups.push(group)
        remainingWeight -= groupWeight
    }
    return groups.map(group => group.join('').trim()).filter(Boolean)
}

function resolveWanDialogueDuration(dialogue: string, actualDurationSeconds?: number | null) {
    return Math.max(estimateDialogueDurationSeconds(dialogue), actualDurationSeconds ?? 0)
}

export function splitDialogueForWan(
    dialogue: string,
    options: { actualDurationSeconds?: number | null; safeTargetSeconds?: number; maximumSeconds?: number; maximumNaturalSpeed?: number; minimumSegments?: number } = {}
): DialogueSplitPart[] {
    const { prefix, speech } = splitSpeaker(dialogue)
    if (!speech) return []
    const maximumSeconds = options.maximumSeconds ?? WAN_MAXIMUM_AUDIO_SECONDS
    const maximumNaturalSpeed = options.maximumNaturalSpeed ?? WAN_MAXIMUM_NATURAL_SPEED
    const safeTargetSeconds = Math.min(maximumSeconds, options.safeTargetSeconds ?? 13.5)
    const totalSeconds = resolveWanDialogueDuration(dialogue, options.actualDurationSeconds)
    const minimumSegments = Math.max(1, Math.round(options.minimumSegments ?? 1))
    const splitRequired = totalSeconds > maximumSeconds * maximumNaturalSpeed + WAN_DURATION_EPSILON_SECONDS || minimumSegments > 1
    if (!splitRequired) {
        return [
            {
                dialogue: `${prefix}${prefix ? ' ' : ''}${speech}`,
                speech,
                estimatedSeconds: totalSeconds,
                duration: Math.min(maximumSeconds, Math.max(4, Math.ceil(totalSeconds / maximumNaturalSpeed + 1)))
            }
        ]
    }
    const desiredCount = Math.max(minimumSegments, Math.ceil(totalSeconds / safeTargetSeconds))

    let clauses = speech
        .match(/[^，,。！？!?；;：:\n]+[，,。！？!?；;：:\n]*/g)
        ?.map(value => value.trim())
        .filter(Boolean) ?? [speech]
    while (clauses.length < desiredCount) {
        const next = splitLargestClause(clauses)
        if (next.length === clauses.length) break
        clauses = next
    }
    let segmentTexts = distributeClauses(clauses, Math.min(desiredCount, clauses.length))
    // 标点分句可能极不均匀（一个超长句 + 一个短叹词）。继续拆最大子句，
    // 直到每个分段都落入安全目标，避免“拆了两镜但第一镜仍然超限”。
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const totalWeight = segmentTexts.reduce((sum, value) => sum + speechWeight(value), 0)
        const longestSeconds = Math.max(...segmentTexts.map(value => (totalSeconds * speechWeight(value)) / totalWeight))
        if (longestSeconds <= safeTargetSeconds + WAN_DURATION_EPSILON_SECONDS) break
        const next = splitLargestClause(clauses)
        if (next.length === clauses.length) break
        clauses = next
        const nextCount = Math.min(Math.max(desiredCount, Math.ceil(totalSeconds / safeTargetSeconds)), clauses.length)
        segmentTexts = distributeClauses(clauses, nextCount)
    }
    const totalWeight = segmentTexts.reduce((sum, value) => sum + speechWeight(value), 0)
    return segmentTexts.map(value => {
        const estimatedSeconds = Number(((totalSeconds * speechWeight(value)) / totalWeight).toFixed(1))
        return {
            dialogue: `${prefix}${prefix ? ' ' : ''}${value}`,
            speech: value,
            estimatedSeconds,
            duration: Math.min(maximumSeconds, Math.max(4, Math.ceil(estimatedSeconds + 1)))
        }
    })
}

function extractState(actionDesc: string | null | undefined, label: 'Opening' | 'Ending') {
    if (!actionDesc) return null
    const pattern = label === 'Opening' ? /Opening state\s*[:：]\s*([\s\S]*?)(?=[;；]\s*(?:Middle state\s*\d*|Ending state)\s*[:：]|$)/i : /Ending state\s*[:：]\s*([\s\S]*)$/i
    return actionDesc.match(pattern)?.[1]?.trim() || null
}

export function buildSplitDialogueActionDesc(params: { original?: string | null; speaker: string; index: number; count: number; speech: string }) {
    const opening = extractState(params.original, 'Opening') ?? `${params.speaker || '说话角色'}位于原分镜场景中，服装、道具、站位和光线保持原设定`
    const ending = extractState(params.original, 'Ending') ?? `${params.speaker || '说话角色'}说完台词后保持在原位置，服装、道具、背景和光线不变`
    const restingBoundary = `${opening}；${params.speaker || '说话角色'}嘴唇短暂闭合，视线仍落在原对象上，服装、道具、身体朝向与光线保持不变`
    const openingState = params.index === 0 ? opening : restingBoundary
    const endingState = params.index === params.count - 1 ? ending : restingBoundary
    const middleState = `${params.speaker || '说话角色'}听到对方或现场变化后继续本段台词，视线始终落在原对象上；嘴唇按语句自然开合，呼吸与停顿清晰，手指、肩背和身体重心随语气产生克制变化`
    return `Opening state: ${openingState}; Middle state 1: ${middleState}; Ending state: ${endingState}`
}

type DialogueStoryboardDraft = {
    order: number
    dialogue?: string | null
    duration?: number | null
    actionDesc?: string | null
    imagePrompt?: string | null
    continuityMode?: string | null
    continuityReason?: string | null
}

export function expandDialogueStoryboardDrafts<T extends DialogueStoryboardDraft>(
    drafts: T[],
    options: { maximumSeconds?: number; maximumNaturalSpeed?: number; safeTargetSeconds?: number } = {}
): T[] {
    const expanded: T[] = []
    for (const draft of drafts) {
        const dialogue = draft.dialogue?.trim()
        const maximumSeconds = options.maximumSeconds ?? WAN_MAXIMUM_AUDIO_SECONDS
        const parts = dialogue
            ? splitDialogueForWan(dialogue, {
                  maximumSeconds,
                  maximumNaturalSpeed: options.maximumNaturalSpeed,
                  safeTargetSeconds: options.safeTargetSeconds ?? maximumSeconds * 0.9
              })
            : []
        if (parts.length < 2) {
            expanded.push(draft)
            continue
        }
        const speaker = dialogue?.match(/^([^：:\n]{1,24})[：:]/)?.[1]?.trim() ?? ''
        parts.forEach((part, index) => {
            expanded.push({
                ...draft,
                order: expanded.length + 1,
                dialogue: part.dialogue,
                duration: part.duration,
                actionDesc: buildSplitDialogueActionDesc({
                    original: draft.actionDesc,
                    speaker,
                    index,
                    count: parts.length,
                    speech: part.speech
                }),
                imagePrompt:
                    index === 0
                        ? draft.imagePrompt
                        : [
                              draft.imagePrompt,
                              `这是同一场景连续对白拆分后的第 ${index + 1}/${parts.length} 镜；人物身份、服装颜色材质、道具、天气、背景布局和光线必须承接上一镜，只改变口型、表情和轻微手势。`
                          ]
                              .filter(Boolean)
                              .join(' '),
                continuityMode: index === 0 ? draft.continuityMode : 'stateful',
                continuityReason: index === 0 ? draft.continuityReason : `对白分段，第 ${index + 1}/${parts.length} 段，继承上一段人物状态，允许自然停顿和反打`
            } as T)
        })
    }
    return expanded.map((draft, index) => ({ ...draft, order: index + 1 }))
}
