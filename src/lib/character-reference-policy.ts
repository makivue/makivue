import type { HiModelsImageModel } from './himodels-models'

export const CHARACTER_REFERENCE_PROMPT_VERSION = 'character-reference/live-action-natural-v2@2026-08-13'

export const LEGACY_BEAUTY_PREFIX =
    'extremely beautiful and handsome characters, high cheekbones, delicate facial features, slim waist, elegant posture, idol-grade looks, cinematic portrait quality, attractive appearance'

export const LIVE_ACTION_BEAUTY_PREFIX =
    'naturally beautiful and handsome adult characters, premium live-action short drama casting, subtle natural makeup and grooming, identity-specific facial features, realistic skin texture with visible pores, fine facial detail, natural facial asymmetry, healthy believable proportions'

export const LIVE_ACTION_ANTI_WAX_NEGATIVE =
    'waxy skin, plastic skin, CGI face, doll-like face, porcelain skin, airbrushed skin, excessive skin smoothing, beauty filter, over-symmetrical face, heavy makeup'

const LIVE_ACTION_ANIMAL_PRESENTATION =
    'photorealistic natural-history wildlife character design, species-accurate head and body anatomy, realistic fur, feather, scale or shell detail as appropriate, physically plausible proportions, distinctive natural markings, no human anatomy, no human face, no human skin, no human hairstyle, no human wardrobe'

const STYLIZED_ANIMAL_PRESENTATION =
    'appealing original animal character design, expressive species-accurate eyes and muzzle or head structure, distinctive fur, feather, scale or shell pattern as appropriate, natural animal anatomy, no human anatomy, no human skin, no human hairstyle, no human wardrobe'

export type CharacterReferenceImageProvider = 'banana' | 'doubao' | 'qwen-image-3.0-pro' | HiModelsImageModel

const STYLIZED_RENDERING_SIGNAL =
    /(?:\banime\b|animation|animated|\b3d\b|illustration|illustrated|manga|comic|graphic novel|painting|painted|watercolor|ink wash|gongbi|brushwork|cel[- ]?shad|claymation|stop[- ]motion|linocut|paper cut|paper-cut|stained glass|pixel art|sticker|non[- ]?photorealistic|not live action|not real people|动物动画|动漫|动画|漫画|插画|水墨|工笔|油画|水彩|黏土|定格|贴纸)/i

const NON_HUMAN_RENDERING_SIGNAL = /(?:animal characters?|animal animation|animal adventure|wildlife documentary|natural-history|no humans?|动物动画|动物王国|野生动物|自然纪录片)/i

type VisualStyleDescriptor = {
    key: string
    label: string
    hint: string
    imagePromptPrefix: string
    videoPromptPrefix: string
}

/**
 * Detect whether the selected visual style represents live-action humans so the
 * character prompt can use natural skin/casting constraints. Image provider
 * routing remains controlled by the user's configured provider.
 */
export function isLiveActionHumanStyle(style: VisualStyleDescriptor): boolean {
    const context = [style.key, style.label, style.hint, style.imagePromptPrefix, style.videoPromptPrefix].join(' ')
    if (NON_HUMAN_RENDERING_SIGNAL.test(context)) return false
    return !STYLIZED_RENDERING_SIGNAL.test(context)
}

export function resolveCharacterReferencePolicy(style: VisualStyleDescriptor, requestedProvider: CharacterReferenceImageProvider = 'banana') {
    const liveAction = isLiveActionHumanStyle(style)
    return {
        liveAction,
        provider: requestedProvider,
        promptVersion: liveAction ? CHARACTER_REFERENCE_PROMPT_VERSION : 'character-reference/stylized-v1',
        stylePromptPrefix: liveAction ? style.imagePromptPrefix.replaceAll(LEGACY_BEAUTY_PREFIX, LIVE_ACTION_BEAUTY_PREFIX) : style.imagePromptPrefix,
        negativePrompt: liveAction ? LIVE_ACTION_ANTI_WAX_NEGATIVE : ''
    }
}

/** Replace human casting/beauty anchors before a visual style is applied to an animal identity. */
export function adaptCharacterReferenceStylePrompt(stylePrompt: string, liveAction: boolean, animalOnly: boolean): string {
    if (!animalOnly) return stylePrompt
    const animalPresentation = liveAction ? LIVE_ACTION_ANIMAL_PRESENTATION : STYLIZED_ANIMAL_PRESENTATION
    return stylePrompt.replaceAll(LIVE_ACTION_BEAUTY_PREFIX, animalPresentation).replaceAll(LEGACY_BEAUTY_PREFIX, animalPresentation)
}

export function getCharacterBeautyPrompt(gender: string | null | undefined, liveAction: boolean, animalOnly: boolean): string {
    if (animalOnly) {
        return liveAction ? LIVE_ACTION_ANIMAL_PRESENTATION : STYLIZED_ANIMAL_PRESENTATION
    }
    if (!liveAction) {
        if (gender === '男') return 'extremely handsome young man, defined jawline, balanced brows, refined contemporary features, tall slim elegant figure, idol-grade looks'
        if (gender === '女') return 'extremely beautiful young woman, refined natural lips, slim waist, expressive eyes, natural healthy skin, slim elegant figure, idol-grade looks'
        return 'extremely attractive, delicate facial features, slim elegant figure, idol-grade looks'
    }
    if (gender === '男') {
        return 'naturally handsome adult man, premium live-action short drama casting, natural grooming, identity-specific facial structure, realistic skin texture with visible pores, fine facial detail, natural facial asymmetry, healthy believable proportions'
    }
    if (gender === '女') {
        return 'naturally beautiful adult woman, premium live-action short drama casting, subtle natural makeup, identity-specific facial structure, realistic skin texture with visible pores, fine facial detail, natural facial asymmetry, healthy believable proportions'
    }
    return LIVE_ACTION_BEAUTY_PREFIX
}
