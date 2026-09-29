export type ContinuityMode = 'independent' | 'stateful' | 'continuous' | 'seamless'

export type ContinuityDraft = {
    order: number
    sceneId?: string | number | bigint | null
    sceneName?: string | null
    sceneTimeOfDay?: string | null
    characterNames?: string[]
    actionDesc?: string | null
    imagePrompt?: string | null
    continuityMode?: string | null
    continuityReason?: string | null
}

const HARD_BREAK = /(?:later|meanwhile|the next day|hours later|flashback|dream|cut to|转场|与此同时|稍后|次日|翌日|数小时后|回忆|梦境|时空切换)/i
const STRICT_PIXEL_CONTINUITY_REASON = /(?:^强连续[：:]|^无缝连续[：:]|复杂动作自动拆镜|超长对白自动拆镜)/i
const SYSTEM_SPLIT_CONTINUITY_REASON = /(?:复杂动作自动拆镜|超长对白自动拆镜)/i

function boundaryState(actionDesc: string | null | undefined, label: 'Opening' | 'Ending') {
    if (!actionDesc) return null
    const pattern =
        label === 'Opening'
            ? /Opening state\s*[:：]\s*([\s\S]*?)(?=[;；]\s*Ending state\s*[:：]|$)/i
            : /Ending state\s*[:：]\s*([\s\S]*?)$/i
    return actionDesc.match(pattern)?.[1]?.trim() || null
}

function normalizeBoundaryState(value: string | null) {
    return value
        ?.normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s，,。.!！?？；;：:'"“”‘’、（）()\[\]【】]/g, '')
        .trim()
}

function hasExactBoundaryHandoff(previous: ContinuityDraft, current: ContinuityDraft) {
    const ending = normalizeBoundaryState(boundaryState(previous.actionDesc, 'Ending'))
    const opening = normalizeBoundaryState(boundaryState(current.actionDesc, 'Opening'))
    return !!ending && ending === opening
}

function overlapRatio(left: string[] = [], right: string[] = []) {
    if (!left.length || !right.length) return 0
    const rightSet = new Set(right)
    return left.filter(name => rightSet.has(name)).length / Math.max(left.length, right.length)
}

export function classifyStoryboardContinuity<T extends ContinuityDraft>(input: T[]) {
    const shots = input.slice().sort((a, b) => a.order - b.order)
    let nextGroup = 1
    let activeGroup: number | null = null
    const result: Array<T & { continuityMode: ContinuityMode; continuityGroup: number | null; continuityReason: string | null }> = []
    shots.forEach((shot, index) => {
        if (index === 0) {
            result.push({ ...shot, continuityMode: 'independent', continuityGroup: null, continuityReason: null })
            return
        }
        const previous = shots[index - 1]
        const combined = [shot.actionDesc, shot.imagePrompt, shot.continuityReason].filter(Boolean).join(' ')
        const explicit = shot.continuityMode === 'stateful' || shot.continuityMode === 'continuous' || shot.continuityMode === 'seamless' ? shot.continuityMode : null
        const sameScene =
            shot.sceneId !== null &&
            shot.sceneId !== undefined &&
            previous.sceneId !== null &&
            previous.sceneId !== undefined
                ? String(shot.sceneId) === String(previous.sceneId)
                : !!shot.sceneName && shot.sceneName === previous.sceneName
        const sceneComparable =
            (shot.sceneId !== null && shot.sceneId !== undefined && previous.sceneId !== null && previous.sceneId !== undefined) ||
            (!!shot.sceneName && !!previous.sceneName)
        const timeChanged = !!shot.sceneTimeOfDay && !!previous.sceneTimeOfDay && shot.sceneTimeOfDay !== previous.sceneTimeOfDay
        const exactBoundaryHandoff = hasExactBoundaryHandoff(previous, shot)
        const continuityReason = shot.continuityReason?.trim() ?? ''
        // 系统拆镜来自同一个原始分镜，场景和角色天然继承。即使旧数据尚未绑定
        // Scene 记录，只要首尾状态逐字相接，也必须保留强连续依赖。
        const systemSplitContinuity = SYSTEM_SPLIT_CONTINUITY_REASON.test(continuityReason)
        const strictPixelContinuity = (sameScene || systemSplitContinuity) && exactBoundaryHandoff && STRICT_PIXEL_CONTINUITY_REASON.test(continuityReason)
        const broken = (sceneComparable && !sameScene) || timeChanged || HARD_BREAK.test(combined)
        const inferred: ContinuityMode = !broken && strictPixelContinuity && overlapRatio(previous.characterNames, shot.characterNames) > 0 ? 'continuous' : !broken && sameScene ? 'stateful' : 'independent'
        // AI 的 continuous/seamless 只是语义建议。缺少逐字可核验的首尾状态
        // 交接时降级为 stateful，避免一个宽泛标签把整场戏都变成串行任务。
        const explicitSafe = explicit === 'continuous' || explicit === 'seamless' ? (strictPixelContinuity ? explicit : 'stateful') : explicit
        const continuityMode = broken ? 'independent' : (explicitSafe ?? inferred)
        if (continuityMode === 'independent') {
            activeGroup = null
            result.push({ ...shot, continuityMode, continuityGroup: null, continuityReason: broken ? null : shot.continuityReason?.trim() || null })
            return
        }
        if (activeGroup === null) {
            activeGroup = nextGroup++
            result[index - 1] = { ...result[index - 1], continuityGroup: activeGroup }
        }
        result.push({
            ...shot,
            continuityMode,
            continuityGroup: activeGroup,
            continuityReason:
                continuityMode === 'stateful' && (explicit === 'continuous' || explicit === 'seamless') && !strictPixelContinuity
                    ? exactBoundaryHandoff
                        ? '只能确认画面状态承接，未证明是未中断的同一物理动作；降级为状态继承'
                        : '首尾状态未严格匹配，降级为状态继承；允许并行生成和重新构图'
                    : shot.continuityReason?.trim() ||
                      (continuityMode === 'stateful' ? '同一场戏的状态继承，可并行生成并允许换机位、反打或人物进出' : '同场景、同角色且上一镜 Ending state 与本镜 Opening state 严格匹配')
        })
    })
    return result
}
