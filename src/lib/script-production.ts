export interface ScriptBeat {
    id: string
    text: string
}

export interface ScriptProductionBatch {
    script: string
    beats: ScriptBeat[]
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
