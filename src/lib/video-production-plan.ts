import {
    getHiModelsVideoApiModel,
    getVideoProviderCapability,
    isHiModelsH3Provider,
    isHiModelsVeoProvider,
    SEEDANCE_20_LABEL,
    WAN_3_LABEL,
    type ProductionVideoProvider
} from '@/lib/provider-capabilities'

export type { ProductionVideoProvider } from '@/lib/provider-capabilities'
export const VIDEO_ROUTING_RULE_VERSION = 'feedback-v1-20260813'

export type VideoProviderFeedbackStat = {
    attempts: number
    successRate: number
    averageDurationMs: number | null
    averageCostUsd: number | null
    averageQualityScore: number | null
}

export type VideoProviderFeedback = Partial<Record<ProductionVideoProvider, VideoProviderFeedbackStat>>

export type VideoShotPlanningInput = {
    provider?: ProductionVideoProvider
    shotType?: string | null
    duration?: number | null
    dialogue?: string | null
    actionDesc?: string | null
    imagePrompt?: string | null
    continuityMode?: string | null
    characterCount?: number
    speakerCount?: number
    keyframeCount?: number
}

export type VideoProviderRecommendation = {
    provider: ProductionVideoProvider
    label: string
    reason: string
    comparisonProvider: 'kling' | null
    comparisonReason: string | null
    highDynamic: boolean
    ruleVersion: string
    feedbackSummary: VideoProviderFeedbackStat | null
}

export type ShotConstraintAnalysis = {
    estimatedDialogueSeconds: number
    dialogueCapacitySeconds: number
    dialogueHandling: 'none' | 'normal' | 'light_speedup' | 'split'
    actionHandling: 'normal' | 'split'
    complexActionDetected: boolean
    actionStageCount: number
    recommendedActionSegments: number
    keyframeDialogueConflict: boolean
    warnings: string[]
}

const HIGH_DYNAMIC =
    /(?:fight|battle|combat|punch|kick|strike|chase|sprint|run(?:ning)?|jump|leap|fall|collapse|collision|crash|explosion|blast|storm|whip pan|handheld|打斗|搏斗|挥拳|出拳|拳击|击中|掌击|踢|踹|格挡|闪避|追逐|狂奔|奔跑|跳跃|坠落|摔倒|碰撞|爆炸|爆破|风暴|手持|甩镜)/i
// Blocking a generation is much stricter than recommending a model. Camera
// style (for example handheld) and weather can make a shot visually dynamic,
// but they are not evidence that the character performs several action beats.
const HIGH_DYNAMIC_ACTION =
    /(?:fight|battle|combat|punch|kick|strike|chase|sprint|run(?:ning)?|jump|leap|fall|collapse|collision|crash|explosion|blast|打斗|搏斗|挥拳|出拳|拳击|击中|掌击|踢|踹|格挡|闪避|追逐|狂奔|奔跑|跳跃|坠落|摔倒|碰撞|爆炸|爆破)/i
const CLOSE_FACE = /(?:close[-\s]?up|extreme[-\s]?close|portrait|reaction|微表情|特写|近景|反应镜头)/i
const SEQUENCE_MARKERS = /(?:then|after that|followed by|and then|随后|接着|然后|紧接着|与此同时|最终|先.+再)/gi
const NUMBERED_ACTION_STAGES = /(?:第\s*[一二三四五六七八九十\d]+\s*(?:拳|掌|脚|腿|击|刀|剑|招|次)|(?:first|second|third|fourth|fifth)\s+(?:punch|kick|strike|blow|attack|move))/gi
const REPEATED_ACTION_CHAIN = /(?:连续|接连|连着|一连|又|再)(?:[^。！？.!?]{0,12})(?:拳|掌|踢|踹|击|打|砍|刺|撞)|(?:combo|flurry|barrage|again)\b/gi

function compactShotText(input: VideoShotPlanningInput) {
    return [input.shotType, input.actionDesc, input.imagePrompt].filter(Boolean).join(' ')
}

function actionEvidenceText(input: VideoShotPlanningInput) {
    const action = input.actionDesc?.trim()
    if (!action) return input.imagePrompt?.trim() ?? ''
    // Generated storyboards describe the same transition in both Opening and
    // Ending state. Counting both halves (and the duplicated image prompt)
    // turns one action into three. Ending state is the authoritative action
    // progression for this shot; fall back to the complete description when
    // the structured marker is absent.
    const endingState = action.match(/(?:Ending state|结束状态)\s*[:：]\s*([\s\S]+)$/i)?.[1]?.trim()
    return endingState || action
}

export function isHighDynamicVideoShot(input: VideoShotPlanningInput): boolean {
    return HIGH_DYNAMIC.test(compactShotText(input))
}

export function estimateDialogueDurationSeconds(dialogue: string | null | undefined): number {
    const value = dialogue?.replace(/^[^：:\n]{1,24}[：:]\s*/gm, '').trim()
    if (!value) return 0
    const hanCount = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
    const latinWords = (value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu) ?? []).length
    const punctuationPauses = (value.match(/[，,。.!！？?；;：:…]/g) ?? []).length
    return Number((hanCount / 4.2 + latinWords / 2.6 + punctuationPauses * 0.12).toFixed(1))
}

export function analyzeVideoShotConstraints(input: VideoShotPlanningInput): ShotConstraintAnalysis {
    const estimatedDialogueSeconds = estimateDialogueDurationSeconds(input.dialogue)
    // 按已验证的视频模型能力判断；不能仅凭 Ark endpoint ID 推断
    // Seedance 版本或开放未确认的时长。
    const dialogueCapacity = input.provider ? (getVideoProviderCapability(input.provider)?.duration.max ?? 15) : 15
    const speedRatio = estimatedDialogueSeconds > 0 ? estimatedDialogueSeconds / dialogueCapacity : 1
    const dialogueHandling = estimatedDialogueSeconds === 0 ? 'none' : speedRatio <= 1 ? 'normal' : speedRatio <= 1.12 ? 'light_speedup' : 'split'

    const text = actionEvidenceText(input)
    const sequenceCount = (text.match(SEQUENCE_MARKERS) ?? []).length
    const numberedStageCount = (text.match(NUMBERED_ACTION_STAGES) ?? []).length
    const repeatedChainCount = (text.match(REPEATED_ACTION_CHAIN) ?? []).length
    const actionStageCount = Math.max(1, numberedStageCount, sequenceCount + 1, repeatedChainCount + 1)
    const keyframeDialogueConflict = !!input.dialogue?.trim() && (input.keyframeCount ?? 0) >= 3
    // This result blocks generation, so require explicit high-confidence action
    // evidence. Generic words such as “随后/然后” are useful for an advisory
    // stage estimate but are too broad for a hard gate. Likewise, camera style,
    // weather and duplicated prompt text must never force an automatic split.
    const complexAction = HIGH_DYNAMIC_ACTION.test(text) && (numberedStageCount >= 2 || repeatedChainCount >= 2)
    const actionHandling = keyframeDialogueConflict || complexAction ? 'split' : 'normal'
    const recommendedActionSegments = actionHandling === 'split' ? Math.min(4, Math.max(2, actionStageCount)) : 1
    const warnings: string[] = []
    if (dialogueHandling === 'light_speedup') warnings.push(`预计台词 ${estimatedDialogueSeconds.toFixed(1)} 秒，生成时可在不变调的前提下轻微加速，且不截断对白。`)
    if (dialogueHandling === 'split') warnings.push(`预计台词 ${estimatedDialogueSeconds.toFixed(1)} 秒，超过单镜自然承载范围，建议拆成相邻分镜。`)
    if (complexAction) warnings.push('本镜包含多个高动态动作阶段，建议按“起势/接触/受力结果”拆成相邻分镜。')
    if (keyframeDialogueConflict) {
        warnings.push('本镜同时包含对白和 3 张以上动作关键帧；Seedance 原生对白只能单次生成，继续会忽略中间帧。请先拆镜，让每镜只承载一个动作阶段和一段对白。')
    }
    return {
        estimatedDialogueSeconds,
        dialogueCapacitySeconds: dialogueCapacity,
        dialogueHandling,
        actionHandling,
        complexActionDetected: complexAction,
        actionStageCount,
        recommendedActionSegments,
        keyframeDialogueConflict,
        warnings
    }
}

function feedbackScore(stat: VideoProviderFeedbackStat): number {
    const quality = stat.averageQualityScore === null ? 0.7 : Math.max(0, Math.min(1, stat.averageQualityScore / 100))
    const latencyPenalty = stat.averageDurationMs === null ? 0 : Math.min(1, stat.averageDurationMs / 10 / 60_000) * 0.05
    const costPenalty = stat.averageCostUsd === null ? 0 : Math.min(1, stat.averageCostUsd / 1) * 0.05
    return stat.successRate * 0.55 + quality * 0.35 - latencyPenalty - costPenalty
}

function applyProviderFeedback(
    recommendation: Omit<VideoProviderRecommendation, 'ruleVersion' | 'feedbackSummary'>,
    candidates: ProductionVideoProvider[],
    feedback?: VideoProviderFeedback
): VideoProviderRecommendation {
    const eligible = candidates
        .map(provider => ({ provider, stat: feedback?.[provider] }))
        .filter((item): item is { provider: ProductionVideoProvider; stat: VideoProviderFeedbackStat } => !!item.stat && item.stat.attempts >= 5)
        .map(item => ({ ...item, score: feedbackScore(item.stat) }))
        .sort((a, b) => b.score - a.score)
    const current = eligible.find(item => item.provider === recommendation.provider)
    const best = eligible[0]
    const shouldSwitch = best && best.provider !== recommendation.provider && best.score >= (current?.score ?? 0.5) + 0.08
    const selected = shouldSwitch ? best : current
    if (!shouldSwitch) {
        return { ...recommendation, ruleVersion: VIDEO_ROUTING_RULE_VERSION, feedbackSummary: selected?.stat ?? null }
    }
    return {
        ...recommendation,
        provider: best.provider,
        label: `${getVideoProviderCapability(best.provider)?.label ?? best.provider}（生产反馈推荐）`,
        reason: `${recommendation.reason} 最近生产窗口中 ${getVideoProviderCapability(best.provider)?.label ?? best.provider} 的成功率/质量综合分更高（${best.stat.attempts} 次样本），因此数据层建议优先。`,
        ruleVersion: VIDEO_ROUTING_RULE_VERSION,
        feedbackSummary: best.stat
    }
}

export function recommendVideoProvider(input: VideoShotPlanningInput, feedback?: VideoProviderFeedback): VideoProviderRecommendation {
    const text = compactShotText(input)
    const hasDialogue = !!input.dialogue?.trim()
    const speakerCount = input.speakerCount ?? (hasDialogue ? 1 : 0)
    const highDynamic = isHighDynamicVideoShot(input)

    if (hasDialogue && speakerCount > 1) {
        return applyProviderFeedback(
            {
                provider: 'seedance',
                label: `${SEEDANCE_20_LABEL}（多人原生对白）`,
                reason: '本镜包含多位说话人，优先让模型一次生成对白顺序、各自口型、情绪和环境声。',
                comparisonProvider: highDynamic ? 'kling' : null,
                comparisonReason: highDynamic ? '同时包含高动态动作，可在实验区与 Kling 做对照，但不替换主结果。' : null,
                highDynamic
            },
            ['seedance'],
            feedback
        )
    }
    if (hasDialogue) {
        return applyProviderFeedback(
            {
                provider: 'seedance',
                label: `${SEEDANCE_20_LABEL}（原生对白）`,
                reason: '情绪对白默认使用原生音频，让画面、台词、口型、表情和环境声在同一次生成中协调。',
                comparisonProvider: highDynamic ? 'kling' : null,
                comparisonReason: highDynamic ? '同时包含高动态动作，可在实验区与 Kling 做对照，但不替换主结果。' : null,
                highDynamic
            },
            ['seedance'],
            feedback
        )
    }
    if (CLOSE_FACE.test(text)) {
        return applyProviderFeedback(
            {
                provider: 'wan3',
                label: WAN_3_LABEL,
                reason: '无对白人物近景优先使用 Wan 3.0，以兼顾面部稳定、细微动作和参考图一致性。',
                comparisonProvider: highDynamic ? 'kling' : null,
                comparisonReason: highDynamic ? '同时包含高动态动作，可在实验区与 Kling 做对照，但不替换主结果。' : null,
                highDynamic
            },
            ['wan3', 'seedance'],
            feedback
        )
    }
    return applyProviderFeedback(
        {
            provider: 'seedance',
            label: SEEDANCE_20_LABEL,
            reason: highDynamic ? '当前主链优先保留首帧约束，并用简化后的单一动作保证稳定。' : '通用连续镜头优先兼顾参考帧、内容驱动的动态镜头计划和人物一致性。',
            comparisonProvider: highDynamic ? 'kling' : null,
            comparisonReason: highDynamic ? `这是 Kling 对照测试候选；只生成旁路样片，不自动覆盖 ${SEEDANCE_20_LABEL} 结果。` : null,
            highDynamic
        },
        ['seedance', 'wan3'],
        feedback
    )
}

export function buildVideoProviderConstraintPackage(provider: ProductionVideoProvider, input: VideoShotPlanningInput): string {
    const common =
        provider === 'seedance25'
            ? [
                  'PRODUCTION CONSISTENCY: keep character identity, apparent age, exact wardrobe colors/materials/silhouette, hair, props and their ownership, injuries/dirt, scene layout, time of day, light direction and color palette stable.',
                  'Present one readable causal performance arc in one continuous shot. Give every gaze a named physical target and show emotion through two to four observable changes in eyes, brows, mouth, breath, shoulders, hands, weight or prop handling.',
                  'Keep character count, body structure, object count, spatial direction and camera axis stable. The main action must create a visible state change rather than idle breathing, blinking or background-only motion.'
              ]
            : [
                  'PRODUCTION CONSTRAINTS: preserve character identity, apparent age, exact wardrobe colors/materials/silhouette, hair, props, injuries/dirt, scene layout, time of day, light direction and color palette.',
                  'Use one continuous shot with one readable causal performance arc. Every gaze needs a named physical target in the scene; unless explicitly scripted, never stare into the camera.',
                  'Avoid vacant eyes, idle swaying, mannequin-like stillness, frozen opening holds, generic breathing/blinking as the main action, cuts, scene reset, wardrobe change, extra people, face morphing, body warping, text, subtitles, logos or watermark.'
              ]
    if (!isHiModelsVeoProvider(provider)) common.push('The opening frame is the visual source of truth; when an ending frame is supplied, arrive at it naturally without a jump.')
    if (input.continuityMode === 'stateful') {
        common.push(
            'STORY-STATE CHAIN: this is the same scene and story moment with a new camera composition. Preserve shared character identity, current wardrobe/body state, props, scene anchors, time of day and lighting, while allowing a reverse shot, changed crop, changed angle, or characters entering/leaving exactly as described.'
        )
    } else if (input.continuityMode === 'continuous' || input.continuityMode === 'seamless') {
        common.push("CONTINUITY CHAIN: carry forward the previous shot's final identity, wardrobe/body state, props, scene atmosphere and lighting; change only framing and the next action beat.")
    }

    if (provider === 'wanx') {
        common.push(
            'HAPPYHORSE 1.1 VISUAL-ONLY PATH: prioritize stable face geometry and natural restrained movement. This model has no native dialogue-audio capability; do not depend on audio instructions.'
        )
    } else if (provider === 'wan3' || provider === 'wan3prime') {
        common.push(
            'WAN 3.0: use supplied images as multimodal visual anchors; synchronize visible performance, dialogue, camera movement and sound in one coherent continuous shot. Do not switch model variants.'
        )
    } else if (isHiModelsVeoProvider(provider)) {
        common.push(
            'VEO: restate all identity, wardrobe, scene and camera facts explicitly in text because this production path does not currently use the storyboard reference image. Avoid relying on “same as reference” wording.'
        )
    } else if (isHiModelsH3Provider(provider)) {
        common.push(
            'MINIMAX H3: use every supplied image and video as an explicit multimodal continuity reference; generate synchronized native dialogue, ambience and camera movement, and use multiple shots only when the storyboard action calls for them.'
        )
    } else if (getHiModelsVideoApiModel(provider)) {
        common.push(
            'HIMODELS SEEDANCE: use the supplied opening image as the exact initial composition; when an ending image is supplied, preserve identity, wardrobe, scene, lighting and camera continuity while arriving at it naturally.'
        )
    } else if (provider === 'seedance25') {
        common.push(
            'SEEDANCE 2.5: assign every supplied image one explicit responsibility, begin from the opening state without a static hold, execute the action/camera/transition timeline in order, and finish on a clear visible ending state.'
        )
    } else {
        common.push(
            'SEEDANCE: begin moving naturally from the first-frame state, execute each content-adaptive semantic action/camera/transition beat in order, and settle cleanly into the supplied final keyframe when present.'
        )
    }
    return common.join(' ')
}

export type ContinuityAnchorShot = {
    order: number
    sceneId?: string | number | bigint | null
    sceneTimeOfDay?: string | null
    continuityMode?: string | null
    continuityGroup?: number | null
    characterIds?: Array<string | number | bigint>
    actionDesc?: string | null
}

function extractBoundaryState(actionDesc: string | null | undefined, label: 'Opening' | 'Ending') {
    if (!actionDesc) return null
    const pattern = label === 'Opening' ? /Opening state\s*[:：]\s*([\s\S]*?)(?=[;；]\s*Ending state\s*[:：]|$)/i : /Ending state\s*[:：]\s*([\s\S]*?)$/i
    return actionDesc.match(pattern)?.[1]?.trim() || null
}

function normalizeBoundaryState(value: string | null) {
    return value
        ?.normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s，,。.!！?？；;：:'"“”‘’、（）()\[\]【】]/g, '')
        .trim()
}

export function assessPreviousEndingFrameAnchor(previous: ContinuityAnchorShot | null, current: ContinuityAnchorShot) {
    const issues: string[] = []
    const stateful = current.continuityMode === 'stateful'
    const pixelContinuous = current.continuityMode === 'continuous' || current.continuityMode === 'seamless'
    if (!previous) issues.push('没有上一镜')
    if (!stateful && !pixelContinuous) issues.push('当前镜头不是剧情连续/连续/无缝镜头')
    if (previous && (previous.sceneId === null || previous.sceneId === undefined || current.sceneId === null || current.sceneId === undefined)) issues.push('前后镜缺少明确场景绑定')
    if (previous && String(previous.sceneId ?? '') !== String(current.sceneId ?? '')) issues.push('前后镜场景不同')
    if (
        previous &&
        previous.continuityGroup !== null &&
        previous.continuityGroup !== undefined &&
        current.continuityGroup !== null &&
        current.continuityGroup !== undefined &&
        previous.continuityGroup !== current.continuityGroup
    ) {
        issues.push('前后镜不在同一连续性分组')
    }
    if (previous) {
        const previousIds = new Set((previous.characterIds ?? []).map(String))
        const currentIds = new Set((current.characterIds ?? []).map(String))
        const exactCharacterSet = previousIds.size === currentIds.size && [...previousIds].every(characterId => currentIds.has(characterId))
        const endingState = normalizeBoundaryState(extractBoundaryState(previous.actionDesc, 'Ending'))
        const openingState = normalizeBoundaryState(extractBoundaryState(current.actionDesc, 'Opening'))
        const exactBoundaryHandoff = !!endingState && endingState === openingState
        // StoryboardCharacter 是整镜涉及角色，不等于边界帧可见角色。
        // 首尾状态逐字一致时允许配角在镜头早段出现或离开。
        if (pixelContinuous && !exactCharacterSet && !exactBoundaryHandoff) issues.push('强连续镜头的角色集合不同且首尾状态无法证明可见角色一致')
    }
    if (/(?:later|meanwhile|the next day|hours later|flashback|dream|cut to|转场|与此同时|稍后|次日|翌日|数小时后|回忆|梦境|时空切换)/i.test(current.actionDesc ?? '')) {
        issues.push('动作描述包含时间或空间跳转')
    }
    return {
        eligible: issues.length === 0,
        issues,
        anchorKind: stateful ? ('state' as const) : ('pixel' as const)
    }
}

/**
 * Validates the strict pixel-continuity contract with the preceding shot.
 * Stateful shots inherit visual facts without requiring identical boundary
 * states. Batch scheduling serializes both modes before resolving their anchors.
 */
export function assessSequentialContinuityDependency(previous: ContinuityAnchorShot | null, current: ContinuityAnchorShot) {
    const issues: string[] = []
    const pixelContinuous = current.continuityMode === 'continuous' || current.continuityMode === 'seamless'
    if (!previous) issues.push('没有相邻上一镜')
    if (!pixelContinuous) issues.push('只有动作连续或无缝连续镜头需要串行')
    if (previous && current.order <= previous.order) issues.push('镜头顺序不是向前衔接')
    if (previous && (previous.sceneId === null || previous.sceneId === undefined || current.sceneId === null || current.sceneId === undefined)) {
        issues.push('前后镜缺少明确场景绑定')
    }
    if (previous && String(previous.sceneId ?? '') !== String(current.sceneId ?? '')) issues.push('前后镜场景不同')
    if (previous && previous.sceneTimeOfDay && current.sceneTimeOfDay && previous.sceneTimeOfDay !== current.sceneTimeOfDay) issues.push('前后镜时间段不同')
    if (
        previous &&
        (previous.continuityGroup === null ||
            previous.continuityGroup === undefined ||
            current.continuityGroup === null ||
            current.continuityGroup === undefined ||
            previous.continuityGroup !== current.continuityGroup)
    ) {
        issues.push('前后镜缺少一致的连续性分组')
    }
    if (previous) {
        const previousIds = new Set((previous.characterIds ?? []).map(String))
        const currentIds = new Set((current.characterIds ?? []).map(String))
        const exactCharacterSet = previousIds.size === currentIds.size && [...previousIds].every(characterId => currentIds.has(characterId))
        const endingState = normalizeBoundaryState(extractBoundaryState(previous.actionDesc, 'Ending'))
        const openingState = normalizeBoundaryState(extractBoundaryState(current.actionDesc, 'Opening'))
        if (!endingState || !openingState) issues.push('前后镜缺少可核验的 Ending/Opening state')
        else if (endingState !== openingState) issues.push('上一镜 Ending state 与本镜 Opening state 不一致')
        if (!exactCharacterSet && (!endingState || endingState !== openingState)) issues.push('前后镜角色集合不同且边界状态无法证明可见角色一致')
    }
    if (/(?:later|meanwhile|the next day|hours later|flashback|dream|cut to|转场|与此同时|稍后|次日|翌日|数小时后|回忆|梦境|时空切换)/i.test(current.actionDesc ?? '')) {
        issues.push('动作描述包含时间或空间跳转')
    }
    return {
        sequential: issues.length === 0,
        issues,
        confidence: issues.length === 0 ? ('strict' as const) : ('rejected' as const)
    }
}
