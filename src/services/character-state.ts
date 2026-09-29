import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { extractStoryboardBoundaryStates } from '@/lib/storyboard-state'

type StatePayload = {
    openingState?: string | null
    endingState?: string | null
    actionDesc?: string | null
    characterName?: string | null
    sourceStoryboardId?: string
    sourceStoryboardOrder?: number
}

export type ResolvedCharacterState = {
    characterId: bigint
    stateKey: string
    statePrompt: string
    sourceStoryboardId: bigint | null
    episodeNumber: number
    sequence: number
}

export function storyboardEndingStateKey(storyboardId: bigint | string) {
    return `storyboard:${storyboardId}:ending`
}

function statePrompt(value: unknown): string {
    if (!value || typeof value !== 'object') return ''
    const state = value as StatePayload
    return state.endingState?.trim() || state.actionDesc?.trim() || state.openingState?.trim() || ''
}

/**
 * Persist the planned end-state timeline as soon as storyboards exist. The
 * sequence convention leaves room for opening/middle events while preserving
 * deterministic ordering inside one episode.
 */
export async function syncEpisodeCharacterStateEvents(episodeId: bigint) {
    // Serialize with narrative/storyboard replacement. A delayed sync must not
    // read the old graph, wait for reset, then reactivate its state events.
    await prisma.$transaction(
        async tx => {
            await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${episodeId} FOR UPDATE`
            const storyboards = await tx.storyboard.findMany({
                where: { episodeId, deletedAt: null },
                orderBy: { order: 'asc' },
                select: {
                    id: true,
                    order: true,
                    actionDesc: true,
                    sourceVersion: true,
                    episode: { select: { projectId: true, episodeNumber: true } },
                    characters: { select: { character: { select: { id: true, name: true } } } }
                }
            })

            // Reordering or editing a shot changes the unique sequence key. Retire
            // previous planned entries before recreating the current timeline.
            if (storyboards.length)
                await tx.characterStateEvent.updateMany({
                    where: { storyboardId: { in: storyboards.map(shot => shot.id) }, sourceType: 'storyboard_plan', status: 'active' },
                    data: { status: 'superseded' }
                })
            for (const storyboard of storyboards) {
                if (!storyboard.characters.length) continue
                const boundaries = extractStoryboardBoundaryStates(storyboard.actionDesc)
                const prompt = boundaries.endingState ?? storyboard.actionDesc?.trim() ?? null
                if (!prompt) continue
                const sequence = storyboard.order * 10 + 9
                const key = storyboardEndingStateKey(storyboard.id)
                for (const relation of storyboard.characters) {
                    const payload: StatePayload = {
                        ...boundaries,
                        actionDesc: storyboard.actionDesc,
                        characterName: relation.character.name,
                        sourceStoryboardId: storyboard.id.toString(),
                        sourceStoryboardOrder: storyboard.order
                    }
                    await tx.characterStateEvent.upsert({
                        where: {
                            characterId_episodeNumber_storyboardId_sequence_stateKey: {
                                characterId: relation.character.id,
                                episodeNumber: storyboard.episode.episodeNumber,
                                storyboardId: storyboard.id,
                                sequence,
                                stateKey: key
                            }
                        },
                        create: {
                            id: genId(),
                            projectId: storyboard.episode.projectId,
                            characterId: relation.character.id,
                            episodeNumber: storyboard.episode.episodeNumber,
                            storyboardId: storyboard.id,
                            sequence,
                            stateKey: key,
                            state: payload,
                            sourceType: 'storyboard_plan',
                            sourceVersion: storyboard.sourceVersion,
                            status: 'active'
                        },
                        update: {
                            state: payload,
                            sourceVersion: storyboard.sourceVersion,
                            sourceType: 'storyboard_plan',
                            status: 'active'
                        }
                    })
                }
            }
        },
        { timeout: 60_000 }
    )
}

/** Resolve the latest state that took effect before the current storyboard. */
export async function resolveCharacterStatesForStoryboard(storyboardId: bigint, characterIds: bigint[]): Promise<Map<string, ResolvedCharacterState>> {
    if (!characterIds.length) return new Map()
    const current = await prisma.storyboard.findFirst({
        where: { id: storyboardId, deletedAt: null },
        select: { order: true, episode: { select: { episodeNumber: true } } }
    })
    if (!current) return new Map()
    const episodeNumber = current.episode.episodeNumber
    const sequenceLimit = current.order * 10
    const events = await prisma.characterStateEvent.findMany({
        where: {
            characterId: { in: characterIds },
            status: 'active',
            OR: [{ episodeNumber: { lt: episodeNumber } }, { episodeNumber, sequence: { lt: sequenceLimit } }],
            AND: [{ OR: [{ effectiveUntilEpisode: null }, { effectiveUntilEpisode: { gte: episodeNumber } }] }]
        },
        orderBy: [{ episodeNumber: 'desc' }, { sequence: 'desc' }, { updatedAt: 'desc' }]
    })
    const latestByCharacter = new Map<string, (typeof events)[number]>()
    for (const event of events) {
        const id = event.characterId.toString()
        if (!latestByCharacter.has(id)) latestByCharacter.set(id, event)
    }
    const selected = [...latestByCharacter.values()]
    if (!selected.length) return new Map()
    return new Map(
        selected
            .map(event => {
                const prompt = statePrompt(event.state)
                if (!prompt) return null
                return [
                    event.characterId.toString(),
                    {
                        characterId: event.characterId,
                        stateKey: event.stateKey,
                        statePrompt: prompt,
                        sourceStoryboardId: event.storyboardId,
                        episodeNumber: event.episodeNumber,
                        sequence: event.sequence
                    } satisfies ResolvedCharacterState
                ] as const
            })
            .filter((entry): entry is readonly [string, ResolvedCharacterState] => entry !== null)
    )
}
