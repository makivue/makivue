import { normalizeCanonicalName } from '@/lib/project-metadata'

export type StoryboardEntityCatalogItem = {
    id: bigint
    name: string
    canonicalName?: string | null
    aliases?: unknown
}

export type StoryboardEntityDraft = {
    sceneName?: string | null
    characterNames?: string[] | null
    dialogue?: string | null
    actionDesc?: string | null
    imagePrompt?: string | null
}

type IndexedEntity<T extends StoryboardEntityCatalogItem> = {
    entity: T
    formalKeys: string[]
    aliasKeys: string[]
}

function stringAliases(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0)
}

function indexCatalog<T extends StoryboardEntityCatalogItem>(catalog: T[]): IndexedEntity<T>[] {
    return catalog.map(entity => {
        const formalKeys = [...new Set([entity.name, entity.canonicalName].map(normalizeCanonicalName).filter(Boolean))]
        const aliasKeys = [
            ...new Set(
                stringAliases(entity.aliases)
                    .map(normalizeCanonicalName)
                    .filter(key => key && !formalKeys.includes(key))
            )
        ]
        return { entity, formalKeys, aliasKeys }
    })
}

function normalizeEntityText(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s·•・]+/g, '')
        .replace(/[“”"'‘’]/g, '')
}

function uniqueExactMatch<T extends StoryboardEntityCatalogItem>(value: string, indexed: IndexedEntity<T>[]): T | null {
    const key = normalizeCanonicalName(value)
    if (!key) return null
    const matches = indexed.filter(item => item.formalKeys.includes(key) || item.aliasKeys.includes(key))
    return matches.length === 1 ? matches[0].entity : null
}

function resolveNamedEntity<T extends StoryboardEntityCatalogItem>(value: string, indexed: IndexedEntity<T>[]): T | null {
    const exact = uniqueExactMatch(value, indexed)
    if (exact) return exact

    const key = normalizeCanonicalName(value)
    if (!key) return null
    const candidates = indexed
        .flatMap(item => [...item.formalKeys, ...item.aliasKeys].map(candidateKey => ({ item, candidateKey })))
        .filter(candidate => candidate.candidateKey.length >= 2 && (key.includes(candidate.candidateKey) || candidate.candidateKey.includes(key)))
        .sort((left, right) => right.candidateKey.length - left.candidateKey.length)
    if (!candidates.length) return null
    const bestLength = candidates[0].candidateKey.length
    const bestIds = [...new Set(candidates.filter(candidate => candidate.candidateKey.length === bestLength).map(candidate => candidate.item.entity.id))]
    if (bestIds.length !== 1) return null
    return candidates.find(candidate => candidate.item.entity.id === bestIds[0])?.item.entity ?? null
}

function entityTextScore<T extends StoryboardEntityCatalogItem>(text: string, item: IndexedEntity<T>): number {
    const normalizedText = normalizeEntityText(text)
    if (!normalizedText) return 0
    const formalScore = Math.max(0, ...item.formalKeys.filter(key => key.length >= 2 && normalizedText.includes(key)).map(key => 1_000 + key.length))
    const aliasScore = Math.max(0, ...item.aliasKeys.filter(key => key.length >= 2 && normalizedText.includes(key)).map(key => key.length))
    return Math.max(formalScore, aliasScore)
}

function inferAllFromText<T extends StoryboardEntityCatalogItem>(text: string, indexed: IndexedEntity<T>[]): T[] {
    return indexed.filter(item => entityTextScore(text, item) > 0).map(item => item.entity)
}

function inferOneFromText<T extends StoryboardEntityCatalogItem>(text: string, indexed: IndexedEntity<T>[]): T | null {
    const scored = indexed
        .map(item => ({ item, score: entityTextScore(text, item) }))
        .filter(candidate => candidate.score > 0)
        .sort((left, right) => right.score - left.score)
    if (!scored.length) return null
    if (scored.length > 1 && scored[0].score === scored[1].score) return null
    return scored[0].item.entity
}

function dialogueSpeakers(dialogue: string | null | undefined): string[] {
    if (!dialogue) return []
    return dialogue
        .split(/\r?\n/)
        .map(line => line.match(/^\s*([^：:\n]{1,24})[：:]/)?.[1]?.trim())
        .filter((speaker): speaker is string => !!speaker && !/^(?:旁白|narration|narrator)$/i.test(speaker))
}

export function resolveStoryboardEntityLinks<TCharacter extends StoryboardEntityCatalogItem, TScene extends StoryboardEntityCatalogItem>(
    draft: StoryboardEntityDraft,
    catalog: { characters: TCharacter[]; scenes: TScene[] }
): { scene: TScene | null; characters: TCharacter[] } {
    const indexedCharacters = indexCatalog(catalog.characters)
    const indexedScenes = indexCatalog(catalog.scenes)
    const actionText = draft.actionDesc?.trim() ?? ''
    const imageText = draft.imagePrompt?.trim() ?? ''

    const scene = (draft.sceneName ? resolveNamedEntity(draft.sceneName, indexedScenes) : null) ?? inferOneFromText(actionText, indexedScenes) ?? inferOneFromText(imageText, indexedScenes)

    const resolvedCharacters = new Map<bigint, TCharacter>()
    for (const name of [...(draft.characterNames ?? []), ...dialogueSpeakers(draft.dialogue)]) {
        const character = resolveNamedEntity(name, indexedCharacters)
        if (character) resolvedCharacters.set(character.id, character)
    }
    const actionCharacters = inferAllFromText(actionText, indexedCharacters)
    const inferredCharacters = actionCharacters.length > 0 ? actionCharacters : inferAllFromText(imageText, indexedCharacters)
    for (const character of inferredCharacters) resolvedCharacters.set(character.id, character)

    return { scene, characters: [...resolvedCharacters.values()] }
}
