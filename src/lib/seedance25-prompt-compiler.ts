export const SEEDANCE_25_PROMPT_COMPILER_VERSION = 'seedance25-guide-v3'

type Seedance25ReferencePurpose = 'opening_frame' | 'ending_frame' | 'character_identity' | 'character_turnaround' | 'visual_style' | 'scene'

export type Seedance25ReferenceAsset = {
    index: number
    purpose: Seedance25ReferencePurpose
    subject?: string
}

export type Seedance25PromptCompilerInput = {
    duration: number
    generationGoal: string
    motionPlan: string
    endingState?: string | null
    characters: string[]
    scene?: string | null
    visualStyle: string
    shotType: string
    referenceAssets?: Seedance25ReferenceAsset[]
    audioDirection?: string | null
    languageDirection?: string | null
    immutableConstraints: string[]
}

function referenceResponsibility(asset: Seedance25ReferenceAsset) {
    const label = `Image ${asset.index}`
    if (asset.purpose === 'opening_frame') {
        return `${label} is the opening frame. It defines the initial composition, subject positions and poses, prop state, scene layout, lighting and camera direction. Begin moving naturally from this state; do not hold it as a static opening.`
    }
    if (asset.purpose === 'ending_frame') {
        return `${label} is the ending frame. It defines the final composition, subject positions and poses, prop state, scene layout, lighting and camera direction. Arrive at it naturally after the event; do not jump or cut to it.`
    }
    if (asset.purpose === 'character_identity') {
        return `${label} defines only ${asset.subject || 'the named character'}'s face, hair, apparent age and identity. Do not copy its background, composition, unrelated people or obsolete story state.`
    }
    if (asset.purpose === 'character_turnaround') {
        return `${label} is ${asset.subject || 'the named character'}'s multi-view turnaround sheet. Use its front, 45-degree, side, back and face-detail depictions together to reconstruct one consistent character, then render that character only once in the requested shot. Never reproduce the sheet, panels, repeated bodies or white background in the video.`
    }
    if (asset.purpose === 'scene') {
        return `${label} defines only ${asset.subject || 'the scene'}'s spatial layout, materials and lighting. Do not copy people or unrelated foreground objects from it.`
    }
    return `${label} defines only the requested visual style, palette, material language and lighting treatment. Do not copy its people, objects, text or composition.`
}

/**
 * Compile provider-neutral storyboard facts into the structure recommended by
 * the Seedance 2.5 prompt guide. This runs for each generation request and does
 * not mutate or replace the stored storyboard copy.
 */
export function compileSeedance25Prompt(input: Seedance25PromptCompilerInput) {
    const references = [...(input.referenceAssets ?? [])].sort((a, b) => a.index - b.index)
    const endingReference = references.find(asset => asset.purpose === 'ending_frame')
    const sections = [
        `[GENERATION GOAL]\nGenerate one ${input.duration}-second continuous video shot. ${input.generationGoal}`,
        references.length ? `[REFERENCE RESPONSIBILITIES]\n${references.map(referenceResponsibility).join('\n')}` : null,
        `[SUBJECTS AND SCENE]\n${input.characters.length ? input.characters.map(character => `- ${character}`).join('\n') : '- No person or humanoid appears in the shot.'}${
            input.scene?.trim() ? `\n- Scene: ${input.scene.trim()}` : ''
        }`,
        `[EVENT AND OBSERVABLE PERFORMANCE]\n${input.motionPlan}`,
        `[ENDING STATE]\n${
            endingReference
                ? `The final visible state must settle naturally into Image ${endingReference.index}, with identity, prop ownership, spatial direction, lighting and camera axis unchanged.`
                : input.endingState?.trim() || 'After the main event, hold its final visible result clearly; do not reset the pose, prop, emotion or scene state.'
        }`,
        `[VISUAL AND COMPOSITION]\nVisual treatment: ${input.visualStyle}. Opening composition: ${input.shotType}. Execute the per-segment CAMERA and CONTINUITY/TRANSITION instructions from the timeline; do not impose one fixed camera movement on the whole video.`,
        input.audioDirection?.trim() || input.languageDirection?.trim() ? `[AUDIO]\n${[input.audioDirection, input.languageDirection].filter(value => value?.trim()).join('\n')}` : null,
        `[KEEP CONSISTENT]\n${input.immutableConstraints.filter(Boolean).join('\n')}`
    ].filter((section): section is string => !!section)

    return sections.join('\n\n')
}
