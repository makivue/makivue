import type { VisualStylePreset } from './novel'
import type { VisualStyleProfile } from './visual-style-profile'
import { sanitizePromptForVisualStyle } from './visual-style-lock'
import { SCENE_REFERENCE_NEGATIVE, SCENE_SINGLE_IMAGE_LOCK, sanitizeSceneReferenceLocationPrompt } from './scene-reference-retry'

type ScenePromptSource = {
    name: string
    description?: string | null
    locationPrompt?: string | null
    timeOfDay?: string | null
}

type SceneReferencePromptInput = {
    scene: ScenePromptSource
    style: VisualStylePreset
    styleProfile: VisualStyleProfile
    broadScene: boolean
    aspectRatio: '9:16' | '16:9' | '1:1'
    hasStyleReference: boolean
    generationNonce?: string
}

function cleanSceneText(value: string | null | undefined, style: VisualStylePreset) {
    return sanitizeSceneReferenceLocationPrompt(sanitizePromptForVisualStyle(value, style))
}

function sceneProductionDesignDirection(scene: ScenePromptSource): { positive: string[]; negative: string[] } {
    const context = [scene.name, scene.description, scene.locationPrompt].filter(Boolean).join(' ')
    const positive: string[] = []
    const negative: string[] = [
        'generic location substitution',
        'generic neon alley',
        'repeated generic sci-fi corridor',
        'copying the style-reference composition instead of designing the named location'
    ]

    if (/(盘山|山路|公路|悬崖|绝壁|峡谷|峭壁|mountain road|cliff road|highway|canyon road|switchback)/i.test(context)) {
        positive.push(
            'MOUNTAIN ROAD GEOGRAPHY: unmistakable open-air mountain terrain at immense scale; the road visibly clings to exposed cliff faces with readable switchbacks, guardrails, rock strata and a deep valley or abyss; use a very wide geography-first view with strong foreground, midground and distant mountain depth'
        )
        negative.push('indoor corridor', 'tunnel replacing the open mountain road', 'urban alley', 'city canyon', 'cramped close framing')
    }

    if (/(地下车库|地下停车|停车场|parking garage|underground parking|car park)/i.test(context)) {
        positive.push(
            'LARGE UNDERGROUND VEHICULAR SPACE: it must read immediately as a spacious parking facility, with multiple drive lanes and parking bays, a long structural column grid, ramps, turning radii, security access and deep vanishing-point scale; preserve clear vehicle circulation rather than reducing the location to one hallway'
        )
        negative.push('narrow hallway', 'server room', 'warehouse aisle', 'tiny room', 'neon nightclub')
    }

    if (/(国会|议会|政府|总统府|国宾|礼宾|capitol|congress|parliament|government|presidential|state ceremony)/i.test(context)) {
        positive.push(
            'MONUMENTAL CIVIC INSTITUTION: express government authority through disciplined symmetry, secure access layers, generous ceiling height, durable stone, concrete, steel or restrained brass detailing, and formal institutional circulation; the scale must feel nationally important rather than commercial or domestic'
        )
        negative.push('cheap retail interior', 'domestic room', 'generic warehouse', 'low-budget office')
    }

    if (/(后台|交接仪式|仪式后台|候场|backstage|ceremony staging|holding area)/i.test(context)) {
        positive.push(
            'CEREMONIAL BACKSTAGE FUNCTION: show a coherent secure staging and holding area connected to the formal venue, with service access, protocol circulation, equipment storage and a clear transition toward the main ceremony space; retain the institution’s grand scale even behind the public-facing hall'
        )
        negative.push('featureless small back room', 'single residential doorway')
    }

    return { positive, negative }
}

function aspectRatioDirection(aspectRatio: SceneReferencePromptInput['aspectRatio']) {
    if (aspectRatio === '9:16') return 'vertical establishing composition for short drama, preserve large-scale depth through strong foreground-to-background layering'
    if (aspectRatio === '1:1') return 'square establishing composition with readable spatial depth and complete location identity'
    return 'wide horizontal establishing composition with readable spatial depth and complete location identity'
}

export function buildSceneReferenceGenerationPrompt(input: SceneReferencePromptInput): { prompt: string; negativePrompt: string } {
    const { scene, style, styleProfile } = input
    const locationPrompt = cleanSceneText(scene.locationPrompt, style)
    const description = cleanSceneText(scene.description, style)
    const productionDesign = sceneProductionDesignDirection(scene)
    const locationIdentity = [
        `exact named location: ${cleanSceneText(scene.name, style)}`,
        description ? `confirmed spatial function and continuity facts: ${description}` : null,
        scene.timeOfDay ? `established time or lighting condition: ${cleanSceneText(scene.timeOfDay, style)}` : null,
        locationPrompt ? `location design details: ${locationPrompt}` : null
    ]
        .filter(Boolean)
        .join('; ')
    const locationPriorityLock =
        `LOCATION IDENTITY HAS HIGHER PRIORITY THAN DECORATIVE STYLE MOTIFS. The result must be instantly recognizable as "${cleanSceneText(scene.name, style)}" by its location category, physical function, scale and navigable topology. ` +
        'The selected story style may change rendering medium, material treatment, technology accents and color grading, but MUST NOT replace an exterior with an interior, natural geography with architecture, a road with a corridor, a large civic or infrastructure space with a small room, or the named location with a generic neon alley.'
    const styleTreatment =
        `AUTHORITATIVE PROJECT VISUAL LANGUAGE: ${style.label}. Preserve the selected rendering medium and visual finish: ${styleProfile.rendering.prompt}; ${styleProfile.linework.prompt}; ${styleProfile.texture.prompt}; ${styleProfile.cameraLanguage.prompt}. ` +
        `Adapt its lighting and palette to this location's established time, weather, function and scale: ${styleProfile.lighting.prompt}; ${styleProfile.colorPalette.prompt}. Use signature colors as controlled motivated accents, not as mandatory neon fixtures, wet streets or city scenery.`
    const referenceRule = input.hasStyleReference
        ? 'STYLE REFERENCE ROLE: use the supplied image only for rendering medium, line quality, material response and overall art-direction fidelity. Do not copy its location, architecture, layout, camera position, weather, light placement or object arrangement.'
        : null
    const layoutDirection = input.broadScene
        ? 'Create an environment master of the broad location with several connected usable zones, clear circulation between them, and distinct foreground, midground and background anchors.'
        : 'Create a reusable establishing view with clear entrances, exits, circulation, permanent landmarks and spatial relationships; do not reduce it to an isolated decorative corner.'

    return {
        prompt: [
            'TASK: create one production-ready empty environment identity reference for a short drama.',
            locationPriorityLock,
            `LOCATION BRIEF: ${locationIdentity}`,
            ...productionDesign.positive,
            styleTreatment,
            referenceRule,
            layoutDirection,
            aspectRatioDirection(input.aspectRatio),
            'detailed production environment, believable scale cues, coherent architecture and geography, atmospheric depth, no temporary story action',
            `FINAL LOCATION CHECK: show "${cleanSceneText(scene.name, style)}" itself—not a generic set dressed in the project colors. Preserve its defining scale, function and topology at first glance.`,
            SCENE_SINGLE_IMAGE_LOCK,
            input.generationNonce ? `Create a visibly new composition for request ${input.generationNonce}; do not reproduce a previous candidate.` : null
        ]
            .filter(Boolean)
            .join('\n'),
        negativePrompt: [styleProfile.negativePrompt, SCENE_REFERENCE_NEGATIVE, ...productionDesign.negative].filter(Boolean).join(', ')
    }
}
