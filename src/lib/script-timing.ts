export type ScriptTimingAnalysis = {
    estimatedSeconds: number
    dialogueSeconds: number
    actionSeconds: number
    dialogueRatio: number
    longDialogueTurns: Array<{ speaker: string; seconds: number; text: string }>
    staticDialogueRuns: number
}

function speechUnits(text: string) {
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
    const words = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
    return { cjk, words }
}

export function estimateSpeechSeconds(text: string) {
    const { cjk, words } = speechUnits(text)
    const punctuationPauses = text.match(/[，,。！？!?；;…]/g)?.length ?? 0
    return cjk / 4.2 + words / 2.6 + punctuationPauses * 0.16
}

export function analyzeScriptTiming(script: string): ScriptTimingAnalysis {
    let dialogueSeconds = 0
    let actionSeconds = 0
    let consecutiveDialogue = 0
    let staticDialogueRuns = 0
    const longDialogueTurns: ScriptTimingAnalysis['longDialogueTurns'] = []

    for (const rawLine of script.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line) continue
        const dialogue = line.match(/^(?![（(【])([^：:\n]{1,40})[：:]\s*(.+)$/)
        if (dialogue) {
            const seconds = estimateSpeechSeconds(dialogue[2])
            dialogueSeconds += seconds
            consecutiveDialogue += 1
            if (seconds > 12) longDialogueTurns.push({ speaker: dialogue[1].trim(), seconds: Number(seconds.toFixed(1)), text: dialogue[2].trim() })
            continue
        }

        if (/^[（(]\s*(?:动作|表情|人物状态|Opening state|Ending state)\s*[:：]/i.test(line)) {
            if (consecutiveDialogue >= 4) staticDialogueRuns += 1
            consecutiveDialogue = 0
            const content = line.replace(/^[（(][^:：]+[:：]\s*|[）)]$/g, '')
            const units = speechUnits(content)
            actionSeconds += Math.min(8, 1.2 + (units.cjk + units.words * 1.5) / 10)
            continue
        }
        if (/^【场景[：:]/.test(line)) {
            if (consecutiveDialogue >= 4) staticDialogueRuns += 1
            consecutiveDialogue = 0
            actionSeconds += 1.2
        }
    }
    if (consecutiveDialogue >= 4) staticDialogueRuns += 1
    const estimatedSeconds = Math.max(0, dialogueSeconds + actionSeconds)
    return {
        estimatedSeconds: Number(estimatedSeconds.toFixed(1)),
        dialogueSeconds: Number(dialogueSeconds.toFixed(1)),
        actionSeconds: Number(actionSeconds.toFixed(1)),
        dialogueRatio: estimatedSeconds > 0 ? Number((dialogueSeconds / estimatedSeconds).toFixed(2)) : 0,
        longDialogueTurns,
        staticDialogueRuns
    }
}
