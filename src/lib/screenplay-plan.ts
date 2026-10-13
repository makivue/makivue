import type { ContractIssue } from './content-contracts'
import { parseScriptSpeaker } from './script-format'

export type ScriptSourceCharacter = {
    name: string
    evidence: string
    speakingEvidence: string | null
}

export type EpisodeScriptPlan = {
    scenes: EpisodeScenePlan[]
    characters: ScriptSourceCharacter[]
}

export type EpisodeScenePlan = {
    sceneNumber: number
    slugline: string
    purpose: string
    protagonistGoal: string
    conflict: string
    turn: string
    exitHook: string
    estimatedSeconds: number
    requiredEvents: string[]
}

function normalizedSource(value: string) {
    return value.normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/gu, '').toLowerCase()
}

function normalizedEvidence(value: string) {
    return normalizedSource(value).replace(/。/g, '.').replace(/、/g, ',')
}

/** Recover typography only, then return the actual contiguous source quote. */
function sourceQuote(value: unknown, source: string): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined
    if (source.includes(value)) return value
    const offsets: { start: number; end: number }[] = []
    let normalized = ''
    let offset = 0
    for (const character of source) {
        const part = normalizedEvidence(character)
        for (let index = 0; index < part.length; index++) offsets.push({ start: offset, end: offset + character.length })
        normalized += part
        offset += character.length
    }
    const quote = normalizedEvidence(value)
    const start = normalized.indexOf(quote)
    if (!quote || start < 0) return undefined
    return source.slice(offsets[start].start, offsets[start + quote.length - 1].end)
}

/** Never guess an identity or reconstruct paraphrased/fragmented evidence. */
export function recoverScriptSourceCharacters(characters: ScriptSourceCharacter[], source: string, characterNameGroups: string[][] = [], excludedNames: string[] = []): ScriptSourceCharacter[] {
    if (!Array.isArray(characters)) return characters
    const normalized = normalizedSource(source)
    const excluded = new Set(excludedNames.map(normalizedSource))
    const owners = new Map<string, number>()
    for (const group of characterNameGroups) {
        for (const key of new Set(group.map(normalizedSource))) owners.set(key, (owners.get(key) ?? 0) + 1)
    }
    const seen = new Set<string>()
    return characters.flatMap(character => {
        if (!character || typeof character.name !== 'string') return [character]
        let name = character.name.trim()
        const evidence = sourceQuote(character.evidence, source) ?? character.evidence
        const speakingEvidence = character.speakingEvidence === null ? null : (sourceQuote(character.speakingEvidence, source) ?? character.speakingEvidence)
        const key = normalizedSource(name)
        if (key && !normalized.includes(key) && !excluded.has(key) && owners.get(key) === 1 && typeof evidence === 'string' && sourceQuote(evidence, source)) {
            const group = characterNameGroups.find(group => group.some(label => normalizedSource(label) === key))!
            const candidates = [
                ...new Set(
                    group
                        .filter(label => {
                            const alias = normalizedSource(label)
                            return owners.get(alias) === 1 && !excluded.has(alias) && normalizedSource(evidence).includes(alias)
                        })
                        .map(label => label.trim())
                )
            ]
            if (candidates.length === 1) name = candidates[0]
        }
        const recovered = { ...character, name, evidence, speakingEvidence }
        const signature = JSON.stringify([normalizedSource(name), evidence, speakingEvidence])
        if (seen.has(signature) && !validateScriptSourceCharacters([recovered], source, excludedNames).length) return []
        seen.add(signature)
        return [recovered]
    })
}

/**
 * Character extraction is supporting metadata for screenplay generation. Keep
 * trustworthy names, but do not fail the whole scene plan because a model
 * paraphrased an evidence quote or omitted the optional cast array.
 */
export function sanitizeScriptSourceCharacters(
    characters: ScriptSourceCharacter[] | null | undefined,
    source: string,
    characterNameGroups: string[][] = [],
    excludedNames: string[] = []
): ScriptSourceCharacter[] {
    const recovered = recoverScriptSourceCharacters(Array.isArray(characters) ? characters : [], source, characterNameGroups, excludedNames)
    const byName = new Map<string, ScriptSourceCharacter>()
    for (const character of recovered) {
        const issues = validateScriptSourceCharacters([character], source, excludedNames)
        if (issues.some(issue => issue.code === 'invalid_source_character')) continue
        const evidenceInvalid = issues.some(issue => issue.path.endsWith('.evidence'))
        const speakingInvalid = issues.some(issue => issue.path.endsWith('.speakingEvidence'))
        const safe = {
            ...character,
            // A source name anchors identity without claiming physical presence.
            // The finished screenplay review checks actual participation/speech.
            evidence: evidenceInvalid ? character.name.trim() : character.evidence,
            speakingEvidence: speakingInvalid ? null : character.speakingEvidence
        }
        const key = normalizedSource(safe.name)
        const previous = byName.get(key)
        if (!previous || (previous.speakingEvidence === null && safe.speakingEvidence !== null)) byName.set(key, safe)
    }
    return [...byName.values()]
}

/** The cast belongs to the chapter, even before a project character library exists. */
export function validateScriptSourceCharacters(characters: ScriptSourceCharacter[] | null | undefined, source: string, excludedNames: string[] = []): ContractIssue[] {
    if (!Array.isArray(characters)) return [{ path: 'scriptPlan.characters', code: 'missing_source_cast', message: '缺少本章原文出场人物及对白证据' }]
    const issues: ContractIssue[] = []
    const normalized = normalizedSource(source)
    const excluded = new Set(excludedNames.map(normalizedSource))
    const seen = new Set<string>()
    for (const [index, character] of characters.entries()) {
        const path = `scriptPlan.characters[${index}]`
        const name = typeof character?.name === 'string' ? character.name.trim() : ''
        const key = normalizedSource(name)
        if (!name || name.length > 100 || /[:：\n]/.test(name) || parseScriptSpeaker(name).mode !== 'dialogue' || !normalized.includes(key) || excluded.has(key) || seen.has(key))
            issues.push({ path, code: 'invalid_source_character', message: '出场人物必须使用本章原文中的姓名或称呼，不能重复、虚构或把仅被提及的人物安排出场' })
        seen.add(key)
        for (const field of ['evidence', 'speakingEvidence'] as const) {
            const value = character?.[field]
            if (field === 'speakingEvidence' && value === null) continue
            if (typeof value !== 'string' || !value.trim() || !normalized.includes(normalizedSource(value))) {
                issues.push({ path: `${path}.${field}`, code: 'invalid_source_evidence', message: '人物出场和开口对白证据必须逐字摘自本章正文；没有开口对白时 speakingEvidence 为 null' })
            }
        }
    }
    return issues
}

/** Validate structure here; event fidelity is reviewed against the chapter in the finished script. */
export function validateEpisodeScenePlan(plan: EpisodeScenePlan[] | null | undefined): ContractIssue[] {
    const issues: ContractIssue[] = []
    if (!Array.isArray(plan) || plan.length === 0) return [{ path: 'scenePlan', code: 'empty_scene_plan', message: '缺少剧本场景规划' }]
    for (const [index, scene] of plan.entries()) {
        const path = `scenePlan[${index}]`
        if (scene.sceneNumber !== index + 1) issues.push({ path: `${path}.sceneNumber`, code: 'scene_order', message: '场景编号必须连续' })
        for (const key of ['slugline', 'purpose', 'protagonistGoal', 'conflict', 'turn', 'exitHook'] as const) {
            if (typeof scene[key] !== 'string' || scene[key].trim().length < 4) issues.push({ path: `${path}.${key}`, code: 'weak_scene_plan', message: `场景 ${index + 1} 的 ${key} 不具体` })
        }
        if (!Number.isFinite(scene.estimatedSeconds) || scene.estimatedSeconds < 5)
            issues.push({ path: `${path}.estimatedSeconds`, code: 'invalid_scene_duration', message: `场景 ${index + 1} 缺少合理时长` })
        if (!Array.isArray(scene.requiredEvents) || scene.requiredEvents.length === 0 || scene.requiredEvents.some(event => typeof event !== 'string' || !event.trim()))
            issues.push({ path: `${path}.requiredEvents`, code: 'missing_scene_events', message: `场景 ${index + 1} 没有关联必保事件` })
    }
    return issues
}
