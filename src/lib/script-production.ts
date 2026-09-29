import type { ContractIssue } from './content-contracts'
import { hasStructuredPerformanceDetails, normalizeStoryboardActionPlan, serializeStoryboardActionPlan } from './storyboard-action-plan'
import { extractStoryboardBoundaryStates } from './storyboard-state'

export interface ScriptBeat {
    id: string
    text: string
}

export interface ScriptProductionBatch {
    script: string
    beats: ScriptBeat[]
}

export interface StoryboardProductionIssue extends ContractIssue {
    shotIndexes?: number[]
    details?: {
        turn: number
        expected: string | null
        actual: string | null
        sourceBeatIds: string[]
    }
}

/** Keep repair diagnostics intact while bounding the user-facing failure summary. */
export class StoryboardProductionError extends Error {
    constructor(
        prefix: string,
        public readonly issues: StoryboardProductionIssue[]
    ) {
        const groups = new Map<string, { message: string; count: number; shots: Set<number> }>()
        for (const issue of issues) {
            const key = `${issue.code}:${issue.message}`
            const group = groups.get(key) ?? { message: issue.message, count: 0, shots: new Set<number>() }
            group.count++
            const index = issue.path.match(/^storyboards\[(\d+)]/)
            for (const shot of issue.shotIndexes ?? (index ? [Number(index[1])] : [])) group.shots.add(shot + 1)
            groups.set(key, group)
        }
        const summaries = [...groups.values()].slice(0, 3).map(group => {
            const shots = [...group.shots].sort((a, b) => a - b)
            const location = shots.length
                ? ` [${shots
                      .slice(0, 6)
                      .map(shot => `#${shot}`)
                      .join(', ')}${shots.length > 6 ? ', …' : ''}]`
                : ''
            return `${group.message.slice(0, 180)}${location}${group.count > 1 ? ` ×${group.count}` : ''}`
        })
        super(`${prefix}${summaries.join('；')}${groups.size > 3 ? ` … (+${groups.size - 3})` : ''}`)
        this.name = 'StoryboardProductionError'
    }
}

/** Keep source text intact; IDs belong to this script revision, not to a model response. */
export function buildScriptProductionBatches(script: string, maxChars = 4500, maxBeats = 32): ScriptProductionBatch[] {
    const batches: ScriptProductionBatch[] = []
    let context: string[] = []
    let pending: string[] = []
    let semanticLines: string[] = []
    let lines: string[] = []
    let beats: ScriptBeat[] = []
    let sequence = 0
    const flushBatch = () => {
        if (!beats.length) return
        batches.push({ script: lines.join('\n'), beats })
        lines = []
        beats = []
    }
    const flushSemanticBeat = () => {
        if (!semanticLines.length) return
        const text = semanticLines.join('\n')
        if (beats.length && (lines.join('\n').length + pending.join('\n').length + text.length > maxChars || beats.length >= maxBeats)) flushBatch()
        if (!lines.length && !pending.some(value => /^【场景[：:]/.test(value))) lines.push(...context)
        lines.push(...pending)
        pending = []
        const beat = { id: `B${String(++sequence).padStart(4, '0')}`, text }
        beats.push(beat)
        lines.push(`[${beat.id}] ${text}`)
        semanticLines = []
    }
    for (const rawLine of script.replace(/(【场景[：:][^】]+】)[\t ]*(?=\S)/g, '$1\n').split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line) continue
        const isScene = /^【场景[：:]/.test(line)
        const isContext = /^[（(]\s*(?:场景描述|人物状态|Opening state|Ending state)\s*[:：]/i.test(line)
        const isAction = /^[（(]\s*动作\s*[:：]/.test(line)
        const isPerformance = /^[（(]\s*(?:动作|表情|台词提示)\s*[:：]/.test(line)
        const isDialogue = /^(?![（(【])[^：:\n]{1,40}[：:]/.test(line)
        if (isScene) {
            flushSemanticBeat()
            context = [line]
        } else if (isContext && /^[（(]\s*场景描述\s*[:：]/.test(line)) {
            context.push(line)
        }
        if (isContext && /^[（(]\s*Ending state\s*[:：]/i.test(line)) {
            flushSemanticBeat()
            lines.push(...pending, line)
            pending = []
            continue
        }
        if (isScene || isContext) {
            pending.push(line)
            continue
        }
        // 表情、动作、台词提示与紧随其后的台词属于同一个可拍语义单元。
        // 新动作开始时才结束上一单元，避免机械地把每一行拆成一个镜头。
        if (isAction && semanticLines.some(value => /^[（(]\s*动作\s*[:：]/.test(value))) flushSemanticBeat()
        if (!isPerformance && !isDialogue) flushSemanticBeat()
        semanticLines.push(line)
        if (isDialogue || !isPerformance) flushSemanticBeat()
    }
    flushSemanticBeat()
    lines.push(...pending)
    flushBatch()
    return batches
}

export interface ProductionStoryboard {
    order: number
    sourceBeatIds?: string[]
    actionDesc?: string | null
    actionPlan?: unknown
    imagePrompt?: string | null
    dialogue?: string | null
    narration?: string | null
    shotType?: string | null
    duration?: number | null
    characterNames?: string[]
    sceneName?: string | null
}

const VOICE_OVER_SPEAKER_RE =
    /^(?:旁白|画外音|内心独白|narration|narrator|voice[ -]?over|v\.?o\.?|[^：:\n]{1,30}\((?:内心|心声|独白|画外|画外音|内心独白|v\.?o\.?|o\.?s\.?|voice[ -]?over|off[ -]?screen|inner monologue)\))$/i

function normalizeSpeaker(value: string) {
    return value
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*\(\s*/g, '(')
        .replace(/\s*\)/g, ')')
        .toLowerCase()
}

type SpeechEntry = { text: string; beatId?: string; shotIndex?: number }
type SpeechTurn = { speaker: string; speech: string; original: string; beatIds: string[]; shotIndexes: number[] }

function speechTurns(entries: SpeechEntry[], kind: 'dialogue' | 'narration', source: boolean): SpeechTurn[] {
    const dialogue: SpeechTurn[] = []
    for (const entry of entries) {
        for (const line of entry.text
            .split(/\r?\n/)
            .map(value => value.trim())
            .filter(Boolean)) {
            const match = line.match(/^(?![（(【])([^：:]{1,40})[：:](.*)$/)
            // Source performance directions are not speech. A malformed generated
            // speech field must be reported, rather than disappearing from the check.
            if (source && (!match || VOICE_OVER_SPEAKER_RE.test(normalizeSpeaker(match[1])) !== (kind === 'narration'))) continue
            const speaker = normalizeSpeaker(match?.[1] ?? '')
            // Allow punctuation/spacing changes and splitting at natural pauses,
            // while preserving the actual spoken words and their speaker.
            const speech = (match?.[2] ?? line)
                .normalize('NFKC')
                .replace(/[\s\p{P}]/gu, '')
                .toLowerCase()
            if (!speech) continue
            const previous = dialogue.at(-1)
            // One turn may span several shots. Merge adjacent fragments only;
            // merging all lines by speaker would lose the conversation's order.
            if (previous?.speaker === speaker) {
                previous.speech += speech
                previous.original += `\n${line}`
                if (entry.beatId && !previous.beatIds.includes(entry.beatId)) previous.beatIds.push(entry.beatId)
                if (entry.shotIndex !== undefined && !previous.shotIndexes.includes(entry.shotIndex)) previous.shotIndexes.push(entry.shotIndex)
            } else dialogue.push({ speaker, speech, original: line, beatIds: entry.beatId ? [entry.beatId] : [], shotIndexes: entry.shotIndex === undefined ? [] : [entry.shotIndex] })
        }
    }
    return dialogue
}

function speechMismatch(source: SpeechTurn[], actual: SpeechTurn[], shots: ProductionStoryboard[]) {
    const equal = (left: SpeechTurn, right: SpeechTurn) => left.speaker === right.speaker && left.speech === right.speech
    let start = 0
    while (start < source.length && start < actual.length && equal(source[start], actual[start])) start++
    if (start === source.length && start === actual.length) return null
    let sourceEnd = source.length
    let actualEnd = actual.length
    while (sourceEnd > start && actualEnd > start && equal(source[sourceEnd - 1], actual[actualEnd - 1])) {
        sourceEnd--
        actualEnd--
    }
    const sourceBeatIds = source.slice(start, sourceEnd).flatMap(turn => turn.beatIds)
    const shotIndexes = new Set(actual.slice(start, actualEnd).flatMap(turn => turn.shotIndexes))
    shots.forEach((shot, index) => {
        if (Array.isArray(shot?.sourceBeatIds) && shot.sourceBeatIds.some(id => sourceBeatIds.includes(id))) shotIndexes.add(index)
    })
    return {
        shotIndexes: [...shotIndexes].sort((a, b) => a - b),
        details: { turn: start + 1, expected: source[start]?.original.slice(0, 400) ?? null, actual: actual[start]?.original.slice(0, 400) ?? null, sourceBeatIds }
    }
}

function countStateUnits(text: string) {
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
    return (text.match(cjk)?.length ?? 0) + (text.replace(cjk, ' ').match(/[\p{L}\p{M}\p{N}]+/gu)?.length ?? 0)
}

function isWeakMiddleState(value: string) {
    if (countStateUnits(value) < 12) return true
    return /^(?:继续|持续|正在|保持)?(?:动作|表演|情绪|过渡)(?:中|变化|推进)?$|^(?:continue|continuing|action|performance|emotion|transition|same as before)$/i.test(value.trim())
}

export function validateStoryboardProduction(shots: ProductionStoryboard[], beats: ScriptBeat[]): StoryboardProductionIssue[] {
    const issues: StoryboardProductionIssue[] = []
    if (!shots.length) return [{ path: 'storyboards', code: 'empty_storyboards', message: '分镜为空，不能标记为完成' }]
    const expected = new Set(beats.map(beat => beat.id))
    const positions = new Map(beats.map((beat, index) => [beat.id, index]))
    const covered = new Set<string>()
    let latestPosition = -1
    let previousIds = new Set<string>()
    for (const [index, shot] of shots.entries()) {
        const path = `storyboards[${index}]`
        if (!shot || typeof shot !== 'object') {
            issues.push({ path, code: 'invalid_shot', message: '分镜必须是完整对象' })
            continue
        }
        if (typeof shot.imagePrompt !== 'string' || !shot.imagePrompt.trim()) issues.push({ path, code: 'missing_image_prompt', message: '缺少首帧画面描述' })
        if (shot.dialogue != null && typeof shot.dialogue !== 'string') issues.push({ path, code: 'invalid_dialogue', message: '对白必须是文本' })
        if (shot.narration != null && typeof shot.narration !== 'string') issues.push({ path, code: 'invalid_narration', message: '旁白/内心独白必须是文本' })
        if (shot.characterNames != null && (!Array.isArray(shot.characterNames) || shot.characterNames.some(name => typeof name !== 'string')))
            issues.push({ path, code: 'invalid_characters', message: '人物名单必须是名字数组' })
        if (shot.sceneName != null && typeof shot.sceneName !== 'string') issues.push({ path, code: 'invalid_scene', message: '场景名必须是文本' })
        const actionPlan = normalizeStoryboardActionPlan(shot.actionPlan, typeof shot.actionDesc === 'string' ? shot.actionDesc : null)
        const canonicalActionDesc = actionPlan ? serializeStoryboardActionPlan(actionPlan) : typeof shot.actionDesc === 'string' ? shot.actionDesc : null
        const state = extractStoryboardBoundaryStates(canonicalActionDesc)
        if (!state.openingState || !state.endingState) issues.push({ path, code: 'missing_boundary', message: '缺少明确的开场或结束画面状态' })
        const middles = actionPlan?.middles ?? []
        const hasDialogue = typeof shot.dialogue === 'string' && !!shot.dialogue.trim()
        const hasNarration = typeof shot.narration === 'string' && !!shot.narration.trim()
        const needsMiddleState = hasDialogue || hasNarration
        if (needsMiddleState && middles.length === 0) {
            issues.push({ path, code: 'missing_middle_state', message: '含对白/旁白的镜头必须包含可见的 Middle state 1 表演状态' })
        }
        for (const [middleIndex, middle] of middles.entries()) {
            // state is a short summary in the generation schema. Evaluate the
            // actual performance, including its structured detail fields.
            const performance = [middle.state, middle.trigger, middle.gazeTarget, middle.facialPerformance, middle.bodyPerformance, middle.propMotion].filter(Boolean).join(' ')
            if (isWeakMiddleState(performance)) {
                issues.push({
                    path: `${path}.actionPlan.middles[${middleIndex}]`,
                    code: 'weak_middle_state',
                    message: 'Middle state 过于抽象；请写明触发、视线目标，以及脸部/呼吸/手部/肩背/重心或道具的可见变化'
                })
            }
        }
        const rawActionPlan = shot.actionPlan && typeof shot.actionPlan === 'object' && !Array.isArray(shot.actionPlan) ? (shot.actionPlan as Record<string, unknown>) : null
        const rawMiddles = rawActionPlan && Array.isArray(rawActionPlan.middles) ? rawActionPlan.middles : rawActionPlan && Array.isArray(rawActionPlan.middleStates) ? rawActionPlan.middleStates : []
        const usesStructuredDetails = rawMiddles.some(
            middle => middle && typeof middle === 'object' && ['trigger', 'gazeTarget', 'facialPerformance', 'bodyPerformance', 'propMotion'].some(key => key in (middle as Record<string, unknown>))
        )
        if (usesStructuredDetails && actionPlan && actionPlan.middles.some(middle => !hasStructuredPerformanceDetails(actionPlan, middle.index))) {
            issues.push({ path, code: 'incomplete_performance_plan', message: '结构化 Middle state 必须包含 trigger、gazeTarget，并至少填写两类脸部/呼吸、身体或道具表演细节' })
        }
        if (hasDialogue && hasNarration) {
            issues.push({ path, code: 'mixed_speech_modes', message: '同一镜头同时包含可见对白和画外音；请按原剧本顺序拆成相邻镜头，避免口型与旁白冲突' })
        }
        const ids = Array.isArray(shot.sourceBeatIds) ? shot.sourceBeatIds : []
        if (!ids.length) issues.push({ path, code: 'missing_source_beats', message: '镜头没有对应的剧本动作或对白；过渡镜头也要关联被承接的动作' })
        for (const id of ids) {
            if (expected.has(id)) {
                const position = positions.get(id)!
                if (position < latestPosition && (!covered.has(id) || !previousIds.has(id)))
                    issues.push({ path, code: 'source_order_changed', message: `剧本动作 ${id} 被移到后续事件之后，请恢复原剧情顺序` })
                latestPosition = Math.max(latestPosition, position)
                covered.add(id)
            } else issues.push({ path, code: 'unknown_source_beat', message: `镜头引用了本批不存在的剧本动作 ${String(id)}` })
        }
        previousIds = new Set(ids)
    }
    for (const beat of beats) {
        if (!covered.has(beat.id)) issues.push({ path: beat.id, code: 'uncovered_beat', message: `遗漏剧本动作或对白：${beat.text}` })
    }
    if (beats.every(beat => covered.has(beat.id))) {
        const sourceEntries = beats.map(beat => ({ text: beat.text, beatId: beat.id }))
        const sourceDialogue = speechTurns(sourceEntries, 'dialogue', true)
        const shotDialogue = speechTurns(
            shots.map((shot, shotIndex) => ({ text: typeof shot?.dialogue === 'string' ? shot.dialogue : '', shotIndex })),
            'dialogue',
            false
        )
        const dialogueMismatch = speechMismatch(sourceDialogue, shotDialogue, shots)
        if (dialogueMismatch) {
            issues.push({
                path: 'storyboards.dialogue',
                code: 'dialogue_mismatch',
                message: '对白内容或说话顺序与剧本不一致：请保留原台词、说话人及对话轮次，不得遗漏、重复、改写或让回应提前发生',
                ...dialogueMismatch
            })
        }
        const sourceNarration = speechTurns(sourceEntries, 'narration', true)
        const shotNarration = speechTurns(
            shots.map((shot, shotIndex) => ({ text: typeof shot?.narration === 'string' ? shot.narration : '', shotIndex })),
            'narration',
            false
        )
        const narrationMismatch = speechMismatch(sourceNarration, shotNarration, shots)
        if (narrationMismatch) {
            issues.push({
                path: 'storyboards.narration',
                code: 'narration_mismatch',
                message: '旁白/内心独白内容或顺序与剧本不一致：必须放入 narration，保留原说话标识与原文，不得塞入可见对白',
                ...narrationMismatch
            })
        }
    }
    return issues
}
