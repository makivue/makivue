import type { ContinuityMode } from './storyboard-continuity'

export const STORYBOARD_CONTINUITY_STATE_VERSION = 3

type StateCharacter = {
    id: string | number | bigint
    name: string
    appearancePrompt?: string | null
    referenceImageUrl?: string | null
    sourceVersion?: number | null
}

type StateScene = {
    id: string | number | bigint
    name?: string | null
    locationPrompt?: string | null
    referenceImageUrl?: string | null
    timeOfDay?: string | null
    sourceVersion?: number | null
}

export type StoryboardContinuityState = {
    version: number
    sourceVersion: number
    mode: ContinuityMode
    group: number | null
    openingState: string | null
    endingState: string | null
    camera: {
        shotType: string | null
    }
    scene: {
        id: string
        name: string | null
        locationLock: string | null
        referenceImageUrl: string | null
        sourceVersion: number
        timeOfDay: string | null
    } | null
    characters: Array<{
        id: string
        name: string
        appearanceLock: string | null
        referenceImageUrl: string | null
        sourceVersion: number
    }>
    inheritedFrom: {
        storyboardId: string
        order: number
        frameUrl: string
        mode: Exclude<ContinuityMode, 'independent'>
        anchorKind: 'state' | 'pixel'
    } | null
}

export function extractStoryboardBoundaryStates(actionDesc: string | null | undefined) {
    const value = actionDesc?.trim() ?? ''
    if (!value) return { openingState: null, endingState: null }
    const openingState = value.match(/Opening state\s*[:：]\s*([\s\S]*?)(?=[;；\s]*(?:Middle state\s*\d*|Ending state)\s*[:：]|$)/i)?.[1]?.trim() || null
    const endingState = value.match(/Ending state\s*[:：]\s*([\s\S]*)$/i)?.[1]?.trim() || null
    return { openingState, endingState }
}

export function buildStoryboardContinuityState(input: {
    continuityMode?: string | null
    continuityGroup?: number | null
    actionDesc?: string | null
    shotType?: string | null
    scene?: StateScene | null
    characters: StateCharacter[]
    inheritedFrom?: StoryboardContinuityState['inheritedFrom']
    sourceVersion?: number
}): StoryboardContinuityState {
    const mode: ContinuityMode = input.continuityMode === 'stateful' || input.continuityMode === 'continuous' || input.continuityMode === 'seamless' ? input.continuityMode : 'independent'
    const { openingState, endingState } = extractStoryboardBoundaryStates(input.actionDesc)

    return {
        version: STORYBOARD_CONTINUITY_STATE_VERSION,
        sourceVersion: input.sourceVersion ?? 1,
        mode,
        group: input.continuityGroup ?? null,
        openingState,
        endingState,
        camera: {
            shotType: input.shotType?.trim() || null
        },
        scene: input.scene
            ? {
                  id: String(input.scene.id),
                  name: input.scene.name?.trim() || null,
                  locationLock: input.scene.locationPrompt?.trim() || null,
                  referenceImageUrl: input.scene.referenceImageUrl?.trim() || null,
                  sourceVersion: input.scene.sourceVersion ?? 1,
                  timeOfDay: input.scene.timeOfDay?.trim() || null
              }
            : null,
        characters: input.characters.map(character => ({
            id: String(character.id),
            name: character.name,
            appearanceLock: character.appearancePrompt?.trim() || null,
            referenceImageUrl: character.referenceImageUrl?.trim() || null,
            sourceVersion: character.sourceVersion ?? 1
        })),
        inheritedFrom: input.inheritedFrom ?? null
    }
}
