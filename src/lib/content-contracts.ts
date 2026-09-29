import type { EpisodeFormatSpec, NovelEpisodeStatePlan } from './novel'
import { findActingOrSpeakingCharacterNames, findMentionedCharacterNames } from './script-character-scope'
import { analyzeScriptTiming } from './script-timing'

export const CONTENT_CONTRACT_VERSION = 'content-contracts/v8@2026-09-29'

export interface ContractIssue {
    path: string
    code: string
    message: string
}

export interface OutlineContractChapter extends Omit<NovelEpisodeStatePlan, 'episodeNumber'> {
    chapterNumber: number
    title: string
    synopsis: string
    intensity?: number
}

export function countContentUnits(text: string | null | undefined): number {
    const value = text?.trim() ?? ''
    const cjk = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
    const latinWords = (value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length
    return cjk + latinWords
}

export function getChapterMinimumUnits(targetWords: number): number {
    return Math.round(targetWords * 0.85)
}

/**
 * A repair response must never make an already-short chapter even shorter.
 * Once either draft reaches the hard minimum, normal contract validation can
 * decide which version is usable.
 */
export function preferChapterRepair(current: string, candidate: string, targetWords: number): string {
    const repaired = candidate.trim()
    if (!repaired) return current

    const minimum = getChapterMinimumUnits(targetWords)
    const currentUnits = countContentUnits(current)
    const candidateUnits = countContentUnits(repaired)
    if (currentUnits < minimum && candidateUnits < minimum && candidateUnits <= currentUnits) return current
    return repaired
}

function requiredText(value: unknown, path: string, issues: ContractIssue[], minLength = 1) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length < minLength) issues.push({ path, code: 'required', message: `${path} 不能为空` })
}

export function validateEpisodeStatePlan(plan: NovelEpisodeStatePlan[] | null | undefined, totalEpisodes: number): ContractIssue[] {
    const issues: ContractIssue[] = []
    const rows = Array.isArray(plan) ? plan : []
    const byNumber = new Map<number, NovelEpisodeStatePlan>()

    for (const [index, row] of rows.entries()) {
        const number = Number(row?.episodeNumber)
        if (!Number.isInteger(number) || number < 1 || number > totalEpisodes) {
            issues.push({ path: `episodeStatePlan[${index}].episodeNumber`, code: 'range', message: '集号必须在项目集数范围内' })
            continue
        }
        if (byNumber.has(number)) issues.push({ path: `episodeStatePlan[${index}].episodeNumber`, code: 'duplicate', message: `第 ${number} 集重复` })
        byNumber.set(number, row)
        requiredText(row.openingState, `episodeStatePlan[${index}].openingState`, issues)
        requiredText(row.endingState, `episodeStatePlan[${index}].endingState`, issues)
        requiredText(row.characterStateChanges, `episodeStatePlan[${index}].characterStateChanges`, issues)
        requiredText(row.continuityBridge, `episodeStatePlan[${index}].continuityBridge`, issues)
        requiredText(row.coldOpen, `episodeStatePlan[${index}].coldOpen`, issues, 6)
        requiredText(row.protagonistGoal, `episodeStatePlan[${index}].protagonistGoal`, issues, 6)
        requiredText(row.primaryObstacle, `episodeStatePlan[${index}].primaryObstacle`, issues, 6)
        requiredText(row.escalation, `episodeStatePlan[${index}].escalation`, issues, 6)
        requiredText(row.irreversibleChoice, `episodeStatePlan[${index}].irreversibleChoice`, issues, 6)
        requiredText(row.cost, `episodeStatePlan[${index}].cost`, issues, 4)
        requiredText(row.reversal, `episodeStatePlan[${index}].reversal`, issues, 6)
        requiredText(row.informationGain, `episodeStatePlan[${index}].informationGain`, issues, 6)
        requiredText(row.cliffhanger, `episodeStatePlan[${index}].cliffhanger`, issues, 6)
        if (!Array.isArray(row.setupPayoffs) || row.setupPayoffs.length === 0 || row.setupPayoffs.some(item => typeof item !== 'string' || !item.trim())) {
            issues.push({ path: `episodeStatePlan[${index}].setupPayoffs`, code: 'invalid_setup_payoff', message: '每集至少规划一项伏笔设置、推进或回收' })
        }
    }

    for (let episodeNumber = 1; episodeNumber <= totalEpisodes; episodeNumber += 1) {
        if (!byNumber.has(episodeNumber)) issues.push({ path: 'episodeStatePlan', code: 'missing_episode', message: `缺少第 ${episodeNumber} 集状态计划` })
        if (episodeNumber > 1) {
            const previous = byNumber.get(episodeNumber - 1)
            const current = byNumber.get(episodeNumber)
            if (previous && current && previous.endingState?.trim() && current.openingState?.trim() && !current.continuityBridge?.trim()) {
                issues.push({ path: `episodeStatePlan.${episodeNumber}.continuityBridge`, code: 'disconnected', message: `第 ${episodeNumber - 1} 集结尾与第 ${episodeNumber} 集开场缺少桥接` })
            }
        }
    }
    return issues
}

export function validateOutlineContract(chapters: OutlineContractChapter[] | null | undefined, requestedNumbers: number[]): ContractIssue[] {
    const issues: ContractIssue[] = []
    const allowed = new Set(requestedNumbers)
    const seen = new Set<number>()
    for (const [index, chapter] of (chapters ?? []).entries()) {
        const base = `chapters[${index}]`
        const number = Number(chapter?.chapterNumber)
        if (!Number.isInteger(number) || !allowed.has(number)) issues.push({ path: `${base}.chapterNumber`, code: 'range', message: '章节号不在本批请求范围内' })
        if (seen.has(number)) issues.push({ path: `${base}.chapterNumber`, code: 'duplicate', message: `第 ${number} 章重复` })
        seen.add(number)
        requiredText(chapter.title, `${base}.title`, issues)
        if (countContentUnits(chapter.synopsis) < 200) issues.push({ path: `${base}.synopsis`, code: 'too_short', message: '章节梗概少于 200 字' })
        const intensity = Number(chapter.intensity)
        if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) issues.push({ path: `${base}.intensity`, code: 'range', message: 'intensity 必须是 1-10 的整数' })
        requiredText(chapter.openingState, `${base}.openingState`, issues)
        requiredText(chapter.endingState, `${base}.endingState`, issues)
        requiredText(chapter.characterStateChanges, `${base}.characterStateChanges`, issues)
        requiredText(chapter.continuityBridge, `${base}.continuityBridge`, issues)
        requiredText(chapter.coldOpen, `${base}.coldOpen`, issues, 6)
        requiredText(chapter.protagonistGoal, `${base}.protagonistGoal`, issues, 6)
        requiredText(chapter.primaryObstacle, `${base}.primaryObstacle`, issues, 6)
        requiredText(chapter.escalation, `${base}.escalation`, issues, 6)
        requiredText(chapter.irreversibleChoice, `${base}.irreversibleChoice`, issues, 6)
        requiredText(chapter.cost, `${base}.cost`, issues, 4)
        requiredText(chapter.reversal, `${base}.reversal`, issues, 6)
        requiredText(chapter.informationGain, `${base}.informationGain`, issues, 6)
        requiredText(chapter.cliffhanger, `${base}.cliffhanger`, issues, 6)
        if (!Array.isArray(chapter.setupPayoffs) || chapter.setupPayoffs.length === 0 || chapter.setupPayoffs.some(item => typeof item !== 'string' || !item.trim())) {
            issues.push({ path: `${base}.setupPayoffs`, code: 'invalid_setup_payoff', message: '每章至少明确一项伏笔设置、推进或回收' })
        }
        if (!Array.isArray(chapter.requiredEvents) || chapter.requiredEvents.length < 3 || chapter.requiredEvents.some(event => typeof event !== 'string' || !event.trim())) {
            issues.push({ path: `${base}.requiredEvents`, code: 'invalid_events', message: '必保事件至少三项，明确本集的目标、行动及结果' })
        }
    }
    for (const number of requestedNumbers) {
        if (!seen.has(number)) issues.push({ path: 'chapters', code: 'missing_chapter', message: `缺少第 ${number} 章` })
    }
    const validChapters = (chapters ?? []).filter(chapter => requestedNumbers.includes(Number(chapter?.chapterNumber)))
    if (validChapters.length >= 3 && new Set(validChapters.map(chapter => Number(chapter.intensity))).size < 2) {
        issues.push({ path: 'chapters.intensity', code: 'flat_intensity', message: '连续章节强度完全相同，缺少可感知的波峰波谷' })
    }
    for (const field of ['protagonistGoal', 'reversal', 'cliffhanger'] as const) {
        const normalized = validChapters.map(chapter => chapter[field]?.replace(/[\s\p{P}]/gu, '').toLowerCase()).filter(Boolean)
        if (normalized.length >= 2 && new Set(normalized).size !== normalized.length) {
            issues.push({ path: `chapters.${field}`, code: 'repeated_dramatic_beat', message: `不同章节的 ${field} 重复，剧情没有产生新的局面变化` })
        }
    }
    return issues
}

export function validateChapterContract(params: { content: string; targetWords: number; synopsis?: string | null; statePlan?: NovelEpisodeStatePlan | null }): ContractIssue[] {
    const issues: ContractIssue[] = []
    const minimum = getChapterMinimumUnits(params.targetWords)
    const units = countContentUnits(params.content)
    if (units < minimum) issues.push({ path: 'chapterContent', code: 'too_short', message: `正文仅 ${units} 字，低于 ${minimum} 字下限` })
    // Event coverage and boundary meaning are checked by the narrative reviewer.
    // Keyword overlap or paragraph length cannot establish either property.
    return issues
}

export function validateScriptContract(params: {
    script: string
    spec: EpisodeFormatSpec
    allowedCharacterNames: string[]
    referenceOnlyCharacterNames?: string[]
    outOfScopeCharacterNames?: string[]
    title?: string | null
    synopsis?: string | null
}): ContractIssue[] {
    const issues: ContractIssue[] = []
    requiredText(params.title, 'title', issues)
    requiredText(params.synopsis, 'synopsis', issues)
    requiredText(params.script, 'script', issues)
    const sceneMarkers = [...params.script.matchAll(/【场景[：:][^】]+】/g)]
    const sceneCount = sceneMarkers.length
    if (sceneCount < params.spec.minSceneChanges) issues.push({ path: 'script.scenes', code: 'too_few_scenes', message: `剧本仅 ${sceneCount} 个场景，至少需要 ${params.spec.minSceneChanges} 个` })
    if (!/Opening state\s*:/i.test(params.script)) issues.push({ path: 'script.openingState', code: 'required', message: '缺少 Opening state' })
    if (!/Ending state\s*:/i.test(params.script)) issues.push({ path: 'script.endingState', code: 'required', message: '缺少 Ending state' })

    const sceneSections = sceneMarkers.map((marker, index) => {
        const start = (marker.index ?? 0) + marker[0].length
        const end = sceneMarkers[index + 1]?.index ?? params.script.length
        return params.script.slice(start, end)
    })
    const missingSceneDescriptions = sceneSections.filter(section => !/[（(]\s*场景描述\s*[：:]/.test(section)).length
    if (missingSceneDescriptions > 0) {
        issues.push({ path: 'script.sceneDescriptions', code: 'scene_description_missing', message: `${missingSceneDescriptions} 个场景缺少“场景描述”` })
    }
    const missingCharacterStates = sceneSections.filter((section, index) => !/[（(]\s*人物状态\s*[：:]/.test(section) && !(index === 0 && /Opening state\s*:/i.test(section))).length
    if (missingCharacterStates > 0) {
        issues.push({ path: 'script.characterStates', code: 'character_state_missing', message: `${missingCharacterStates} 个场景缺少开场人物状态` })
    }
    const missingActionBeats = sceneSections.filter(section => !/[（(]\s*动作\s*[：:]/.test(section)).length
    if (missingActionBeats > 0) {
        issues.push({ path: 'script.actionBeats', code: 'action_beat_missing', message: `${missingActionBeats} 个场景缺少结构化动作` })
    }
    if (!/[（(]\s*表情\s*[：:]/.test(params.script)) {
        issues.push({ path: 'script.expression', code: 'expression_detail_missing', message: '剧本缺少可见的表情变化描述' })
    }
    const timing = analyzeScriptTiming(params.script)
    // Whole-episode runtime is an editing guide, not a reason to discard a script.
    // Keep performance checks independent from that rough estimate.
    if (timing.longDialogueTurns.length > 0) {
        issues.push({
            path: 'script.dialogue',
            code: 'long_dialogue_turn',
            message: `存在 ${timing.longDialogueTurns.length} 段超过 12 秒的连续台词，应在自然停顿处分句并插入有因果的反应或动作`
        })
    }
    if (timing.staticDialogueRuns > 0) {
        issues.push({ path: 'script.performance', code: 'talking_heads', message: `存在 ${timing.staticDialogueRuns} 处连续对白缺少动作或表情反应，容易生成站桩念词` })
    }

    const allowed = new Set([...params.allowedCharacterNames, '旁白'])
    const speakers = [...params.script.matchAll(/^(?![（(【])([^\n：:]{1,40})[：:]/gm)].map(match => match[1].trim())
    const unknown = [
        ...new Set(
            speakers.filter(speaker => {
                if (allowed.has(speaker)) return false
                const innerVoice = speaker.match(/^(.+?)[（(](?:内心|心声|独白|画外)[）)]$/)
                return !innerVoice || !allowed.has(innerVoice[1].trim())
            })
        )
    ]
    if (params.allowedCharacterNames.length > 0 && unknown.length > 0) {
        issues.push({ path: 'script.speakers', code: 'unknown_speaker', message: `出现未登记说话人：${unknown.join('、')}` })
    }
    const outOfScopeCharacters = findMentionedCharacterNames([params.title, params.synopsis, params.script].filter(Boolean).join('\n'), params.outOfScopeCharacterNames ?? [])
    if (outOfScopeCharacters.length > 0) {
        issues.push({ path: 'script.characters', code: 'out_of_scope_character', message: `出现本章原文未出场的项目角色：${outOfScopeCharacters.join('、')}` })
    }
    const referenceOnlyActors = findActingOrSpeakingCharacterNames(params.script, params.referenceOnlyCharacterNames ?? [])
    if (referenceOnlyActors.length > 0) {
        issues.push({ path: 'script.characters', code: 'reference_only_character_acted', message: `仅在原文中被提及的角色被错误写成出场人物：${referenceOnlyActors.join('、')}` })
    }
    return issues
}

export interface EpisodeFactSnapshot {
    episodeNumber: number
    summary: string
    openingState: string
    endingState: string
    characterStateChanges: string
    continuityBridge: string
    sourceVersion: number
    kind?: 'planned' | 'observed'
    events?: Array<{ description: string; evidence: string }>
}

export function buildEpisodeFactSnapshot(params: { episodeNumber: number; synopsis?: string | null; statePlan?: NovelEpisodeStatePlan | null; sourceVersion?: number }): EpisodeFactSnapshot {
    return {
        kind: 'planned',
        episodeNumber: params.episodeNumber,
        summary: params.synopsis?.trim() ?? '',
        openingState: params.statePlan?.openingState?.trim() ?? '',
        endingState: params.statePlan?.endingState?.trim() ?? '',
        characterStateChanges: params.statePlan?.characterStateChanges?.trim() ?? '',
        continuityBridge: params.statePlan?.continuityBridge?.trim() ?? '',
        sourceVersion: params.sourceVersion ?? 1
    }
}
