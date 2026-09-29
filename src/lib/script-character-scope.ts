export interface ScriptCharacterCandidate {
    name: string
    canonicalName?: string | null
    aliases?: unknown
}

export interface ScriptCharacterScope {
    allowedCharacterNames: string[]
    referenceOnlyCharacterNames: string[]
    outOfScopeCharacterNames: string[]
}

interface CurrentEpisodeCharacterState {
    openingState?: string | null
    endingState?: string | null
    characterStateChanges?: string | null
}

function normalizeForMatch(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function characterLabels(character: ScriptCharacterCandidate): string[] {
    const aliases = Array.isArray(character.aliases) ? character.aliases.filter((alias): alias is string => typeof alias === 'string') : []
    return [...new Set([character.name, character.canonicalName ?? '', ...aliases].map(label => label.trim()).filter(Boolean))]
}

function isReferenceOnlyMention(normalizedText: string, index: number, labelLength: number): boolean {
    const before = normalizedText.slice(Math.max(0, index - 36), index)
    const after = normalizedText.slice(index + labelLength, index + labelLength + 24)
    const referenceCueBefore = /(?:代号|署名|姓名|名字|名单|档案|资料|照片|画像|消息|短信|新闻|传闻|提示|标注|显示|写着|记录为)[：:“”"'【\[]?[^。！？；;\n]{0,8}$/u
    const referenceCueAfter = /^(?:的)?(?:代号|署名|姓名|名字|档案|资料|照片|画像|消息|短信|新闻|传闻)/u
    return referenceCueBefore.test(before) || referenceCueAfter.test(after)
}

function getLabelMentionKinds(normalizedText: string, label: string): { mentioned: boolean; referenceOnly: boolean } {
    const normalizedLabel = normalizeForMatch(label)
    if (!normalizedLabel) return { mentioned: false, referenceOnly: false }
    let index = normalizedText.indexOf(normalizedLabel)
    if (index < 0) return { mentioned: false, referenceOnly: false }

    let referenceOnly = true
    while (index >= 0) {
        if (!isReferenceOnlyMention(normalizedText, index, normalizedLabel.length)) referenceOnly = false
        index = normalizedText.indexOf(normalizedLabel, index + normalizedLabel.length)
    }
    return { mentioned: true, referenceOnly }
}

/**
 * Project characters are metadata, not the cast of every episode. Only a
 * character explicitly referenced by the current episode source/state may be
 * introduced while adapting that episode.
 */
export function deriveScriptCharacterScope(params: {
    characters: ScriptCharacterCandidate[]
    chapterTitle?: string | null
    chapterSynopsis?: string | null
    chapterContent: string
    currentEpisodeState?: CurrentEpisodeCharacterState | null
}): ScriptCharacterScope {
    const currentState = params.currentEpisodeState
    const normalizedChapterContent = normalizeForMatch(params.chapterContent)
    const normalizedMetadata = normalizeForMatch([params.chapterTitle, params.chapterSynopsis].filter(Boolean).join('\n'))
    const normalizedCurrentState = normalizeForMatch([currentState?.openingState, currentState?.endingState, currentState?.characterStateChanges].filter(Boolean).join('\n'))
    const allowedCharacterNames: string[] = []
    const allowedLabels = new Set<string>()
    const referenceOnlyCharacterNames: string[] = []
    const referenceOnlyLabels = new Set<string>()
    const outOfScopeLabels: string[] = []

    for (const character of params.characters) {
        const labels = characterLabels(character)
        const contentMentions = labels.map(label => getLabelMentionKinds(normalizedChapterContent, label)).filter(result => result.mentioned)
        const metadataMentions = labels.map(label => getLabelMentionKinds(normalizedMetadata, label)).filter(result => result.mentioned)
        const stateMentions = labels.map(label => getLabelMentionKinds(normalizedCurrentState, label)).filter(result => result.mentioned)
        const mentions = [...contentMentions, ...metadataMentions, ...stateMentions]
        if (mentions.some(result => !result.referenceOnly)) {
            allowedCharacterNames.push(character.name)
            for (const label of labels) allowedLabels.add(normalizeForMatch(label))
        } else if (mentions.length > 0) {
            referenceOnlyCharacterNames.push(...labels)
            for (const label of labels) referenceOnlyLabels.add(normalizeForMatch(label))
        } else {
            outOfScopeLabels.push(...labels)
        }
    }

    const seenOutOfScope = new Set<string>()
    const outOfScopeCharacterNames = outOfScopeLabels.filter(label => {
        const normalized = normalizeForMatch(label)
        if (!normalized || allowedLabels.has(normalized) || referenceOnlyLabels.has(normalized) || seenOutOfScope.has(normalized)) return false
        seenOutOfScope.add(normalized)
        return true
    })

    return {
        allowedCharacterNames: [...new Set(allowedCharacterNames)],
        referenceOnlyCharacterNames: [...new Set(referenceOnlyCharacterNames)],
        outOfScopeCharacterNames
    }
}

export function findMentionedCharacterNames(text: string, characterNames: string[]): string[] {
    const normalizedText = normalizeForMatch(text)
    const mentioned: string[] = []
    const seen = new Set<string>()
    for (const name of characterNames) {
        const normalized = normalizeForMatch(name)
        if (!normalized || seen.has(normalized) || !normalizedText.includes(normalized)) continue
        seen.add(normalized)
        mentioned.push(name)
    }
    return mentioned
}

export function sanitizeOutOfScopeCharacterReferences(text: string, characterNames: string[] | undefined): string {
    const names = [...new Set((characterNames ?? []).map(name => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
    return names.reduce((current, name) => current.replace(new RegExp(escapeRegExp(name), 'giu'), '〔跨集人物已省略〕'), text)
}

export function findActingOrSpeakingCharacterNames(script: string, characterNames: string[]): string[] {
    const namesByNormalized = new Map<string, string>()
    for (const name of characterNames) {
        const normalized = normalizeForMatch(name)
        if (normalized && !namesByNormalized.has(normalized)) namesByNormalized.set(normalized, name)
    }
    const active = new Set<string>()
    const speakers = [...script.matchAll(/^([^\n：:（）()【】]{1,30})[：:]/gm)].map(match => normalizeForMatch(match[1]))
    for (const speaker of speakers) {
        const name = namesByNormalized.get(speaker)
        if (name) active.add(name)
    }

    const structuredPayloads = [...script.matchAll(/^[（(]\s*(?:Opening state|Ending state|场景描述|人物状态|动作|表情)\s*[：:]\s*([^）)\n]+)/gim)].map(match => match[1])
    for (const payload of structuredPayloads) {
        for (const clause of payload.split(/[，,；;。]/u)) {
            const normalizedClause = normalizeForMatch(clause)
            for (const [normalizedName, name] of namesByNormalized) {
                const index = normalizedClause.indexOf(normalizedName)
                if (index < 0 || index > 16 || isReferenceOnlyMention(normalizedClause, index, normalizedName.length)) continue
                active.add(name)
            }
        }
    }
    return [...active]
}
