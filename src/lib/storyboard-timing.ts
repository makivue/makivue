export interface StoryboardTimingInput {
    shotType?: string | null
    duration?: number | null
    dialogue?: string | null
    narration?: string | null
    actionDesc?: string | null
    imagePrompt?: string | null
    characterCount?: number | null
}

const CJK_RE = /[\u3400-\u9fff]/g
const WORD_RE = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g
const ACTION_SPLIT_RE = /(?:Opening state:|Ending state:|->|→|=>|[;；。,.，、])/i
const HIGH_MOTION_RE = /(奔跑|追逐|打斗|搏斗|摔|撞|冲向|逃|爆炸|坠落|抢夺|转身|跨过|推开|跪下|起身|\b(rush|run|chase|fight|grab|fall|collapse|explode|turns?|steps?)\b)/i
const TRANSITION_RE = /(转场|过渡|跨空间|跨时间|闪回|梦境|回忆|与此同时|另一边|突然切到|进入|离开|from .* to |flashback|transition|meanwhile)/i
const DETAIL_RE =
    /(特写|指尖|手指|手掌|双手|赤足|脚底|足底|眼睛|眼眸|瞳孔|嘴唇|额头|脸颊|血液|泪|戒指|项链|手机|杯子|钥匙|锁链|裂纹|神纹|纹路|\b(detail|close-up|finger|hands?|eyes?|pupil|lip|blood|tear|ring|phone|key|chain|crack|wound)\b)/i
const FACE_RE = /(脸|眼神|表情|皱眉|微笑|笑容|惊恐|震惊|害怕|怯意|愤怒|哭|泪|瞳孔|嘴唇|\b(face|facial|gaze|expression|smile|shock|fear|anger|tear|lip)\b)/i
const ENVIRONMENT_RE = /(广阔|全景|远景|天空|广场|宫殿|花海|云海|废墟|街道|人群|战场|城市|全貌|展现|建立|四周|山崖|星河|天庭|废墟|establish|wide|landscape|sky|city|crowd|battlefield|palace|ruins)/i
const TRACKING_RE = /(追|赶|奔跑|跑|冲向|走去|走进|走出|穿过|进入|离开|靠近|退后|飞行|腾空|跃过|移动|前进|逃|\b(run|chase|walk|step|rush|enter|leave|approach|follow|fly|move)\b)/i
const CHAOS_RE = /(摔|坠落|撞飞|失去平衡|爆炸|风暴|震动|颤抖|摇晃|混乱|崩塌|撕裂|席卷|\b(fall|collapse|explode|storm|shake|chaos|impact|crash)\b)/i

function cleanText(text: string | null | undefined) {
    return (text ?? '').trim()
}

function countReadingUnits(text: string | null | undefined) {
    const raw = cleanText(text)
    if (!raw) return 0
    const cjkCount = raw.match(CJK_RE)?.length ?? 0
    const wordCount = raw.match(WORD_RE)?.length ?? 0
    return cjkCount + wordCount
}

function getStoryboardText(input: StoryboardTimingInput) {
    return [input.dialogue, input.narration, input.actionDesc, input.imagePrompt]
        .filter(Boolean)
        .join('\n')
        .replace(/no [^,.;，。；]*(?:hands?|limbs?|text|subtitles?|logo|watermark)[^,.;，。；]*/gi, '')
        .replace(/(?:distorted hands?|extra limbs?|no text|no logo|no watermark|no subtitles?)/gi, '')
}

function hasSpokenDialogue(input: StoryboardTimingInput) {
    const dialogue = cleanText(input.dialogue)
    return !!dialogue && !/^旁白\s*[:：]/.test(dialogue)
}

function getSpeechUnits(input: StoryboardTimingInput) {
    let spokenUnits = 0
    let spokenLineCount = 0
    let narrationUnits = countReadingUnits(input.narration)
    const dialogue = cleanText(input.dialogue)

    if (dialogue) {
        for (const line of dialogue.split(/\n+/)) {
            const part = line.trim()
            if (!part) continue
            if (/^旁白\s*[:：]/.test(part)) {
                narrationUnits += countReadingUnits(part.replace(/^旁白\s*[:：]\s*/, ''))
            } else {
                spokenUnits += countReadingUnits(part)
                spokenLineCount += 1
            }
        }
    }

    return {
        spokenUnits,
        spokenLineCount,
        narrationUnits,
        // 旁白可以覆盖多个画面，不能像人物台词一样把单个镜头硬拉长。
        timedSpeechUnits: spokenUnits + Math.min(24, Math.round(narrationUnits * 0.3))
    }
}

function countStoryboardActionParts(actionDesc: string | null | undefined) {
    return cleanText(actionDesc)
        .split(ACTION_SPLIT_RE)
        .map(part => part.trim())
        .filter(part => countReadingUnits(part) >= 8).length
}

function getTimingSignals(input: StoryboardTimingInput) {
    const speech = getSpeechUnits(input)
    const dialogueUnits = speech.spokenUnits + speech.narrationUnits
    const actionText = cleanText(input.actionDesc)
    const imagePrompt = cleanText(input.imagePrompt)
    const actionUnits = countReadingUnits(actionText)
    const promptUnits = countReadingUnits(imagePrompt)
    const actionPartCount = countStoryboardActionParts(actionText)
    const shotType = cleanText(input.shotType).toLowerCase()
    const combined = [actionText, imagePrompt].join('\n')

    return {
        dialogueUnits,
        spokenDialogueUnits: speech.spokenUnits,
        spokenLineCount: speech.spokenLineCount,
        narrationUnits: speech.narrationUnits,
        timedSpeechUnits: speech.timedSpeechUnits,
        actionUnits,
        promptUnits,
        actionPartCount,
        hasHighMotion: HIGH_MOTION_RE.test(combined),
        hasTransition: TRANSITION_RE.test(combined),
        isCloseShot: shotType.includes('close'),
        isWideShot: shotType.includes('wide') || shotType.includes('aerial')
    }
}

function clampInt(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.round(value)))
}

const STORYBOARD_DURATION_STEPS = [4, 5, 6, 8, 10, 12, 15, 18, 20, 24, 30] as const

function ceilDurationStep(seconds: number) {
    return STORYBOARD_DURATION_STEPS.find(value => value >= seconds) ?? STORYBOARD_DURATION_STEPS[STORYBOARD_DURATION_STEPS.length - 1]
}

export function recommendStoryboardDuration(input: StoryboardTimingInput, maxDuration = 30) {
    const signals = getTimingSignals(input)
    const hasContent = signals.dialogueUnits + signals.actionUnits + signals.promptUnits > 0
    if (!hasContent) return Math.min(maxDuration, 6)

    let score = 0
    if (signals.timedSpeechUnits >= 100) score += 4
    else if (signals.timedSpeechUnits >= 70) score += 3
    else if (signals.timedSpeechUnits >= 42) score += 2
    else if (signals.timedSpeechUnits >= 8) score += 1

    if (signals.actionPartCount >= 5) score += 2
    else if (signals.actionPartCount >= 3) score += 1

    if (signals.actionUnits >= 180) score += 2
    else if (signals.actionUnits >= 100) score += 1

    if (signals.hasTransition) score += 2
    if (signals.hasHighMotion) score += 1
    if (signals.isWideShot) score += 1
    if (signals.isCloseShot && signals.timedSpeechUnits < 35 && signals.actionPartCount <= 2) score -= 1
    if (signals.timedSpeechUnits === 0 && signals.actionPartCount <= 1 && signals.actionUnits < 80) score -= 1
    if (signals.spokenDialogueUnits === 0 && signals.narrationUnits > 0 && !signals.hasHighMotion && !signals.hasTransition) {
        score = Math.min(score, 3)
    }

    const visualDuration = score <= -1 ? 4 : score === 0 ? 5 : score === 1 ? 6 : score === 2 ? 8 : score === 3 ? 10 : score === 4 ? 12 : 15
    // 对白按自然语速决定镜头下限，避免长台词仍被统一压成 10/15 秒。
    // 旁白可跨画面，不用强行拉长当前单镜。
    const speechSeconds = signals.spokenDialogueUnits > 0 ? signals.spokenDialogueUnits / 4.2 + signals.spokenLineCount * 0.35 + 1 : 0
    const contentDuration = speechSeconds > 0 ? Math.max(visualDuration, ceilDurationStep(speechSeconds)) : visualDuration
    return clampInt(contentDuration, 3, Math.max(3, maxDuration))
}

export function normalizeStoryboardDuration(value: unknown, fallbackInput?: StoryboardTimingInput, maxDuration = 30) {
    if (typeof value === 'number' && Number.isFinite(value)) return clampInt(value, 3, maxDuration)
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return clampInt(Number(value), 3, maxDuration)
    return recommendStoryboardDuration(fallbackInput ?? {}, maxDuration)
}

export function recommendStoryboardShotType(input: StoryboardTimingInput) {
    const text = getStoryboardText(input)
    const signals = getTimingSignals(input)
    const hasDialogue = hasSpokenDialogue(input)
    const hasDetail = DETAIL_RE.test(text)
    const hasFace = FACE_RE.test(text)
    const hasEnvironment = ENVIRONMENT_RE.test(text) || signals.hasTransition
    const hasMotion = HIGH_MOTION_RE.test(text) || TRACKING_RE.test(text)

    if (hasDetail && !hasMotion) return hasFace || hasDialogue ? 'close-up' : 'extreme-close-up'
    if (hasEnvironment && !hasDetail && (!hasDialogue || signals.actionPartCount >= 3 || signals.hasTransition)) return 'wide'
    if (CHAOS_RE.test(text) || hasMotion || signals.actionPartCount >= 3) return hasEnvironment ? 'wide' : 'medium'
    if (hasDialogue && (hasFace || signals.dialogueUnits <= 45)) return 'close-up'
    if (!hasDialogue && hasFace) return 'close-up'
    return 'medium'
}

export function recommendMiddleFrameCount(input: StoryboardTimingInput) {
    const duration = normalizeStoryboardDuration(input.duration, input)
    const signals = getTimingSignals(input)
    const characterCount = Math.max(0, Math.round(input.characterCount ?? 0))

    if (duration <= 8 && signals.actionPartCount <= 2 && signals.timedSpeechUnits < 60 && !signals.hasHighMotion && !signals.hasTransition) {
        return 0
    }
    if (duration <= 6) return 0
    if (duration >= 14 && (signals.actionPartCount >= 5 || signals.hasHighMotion || signals.hasTransition)) return 2
    if (duration >= 8 && characterCount > 0 && (signals.hasHighMotion || signals.actionPartCount >= 2)) return 1
    if (duration >= 10 && (signals.actionPartCount >= 3 || signals.timedSpeechUnits >= 80 || signals.hasHighMotion || signals.hasTransition)) return 1
    if (duration >= 9 && signals.actionPartCount >= 4) return 1
    return 0
}
