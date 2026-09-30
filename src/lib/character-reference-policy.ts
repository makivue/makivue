export const LEGACY_BEAUTY_PREFIX =
    'extremely beautiful and handsome characters, high cheekbones, delicate facial features, slim waist, elegant posture, idol-grade looks, cinematic portrait quality, attractive appearance'

export const LIVE_ACTION_BEAUTY_PREFIX =
    'naturally beautiful and handsome adult characters, premium live-action short drama casting, subtle natural makeup and grooming, identity-specific facial features, realistic skin texture with visible pores, fine facial detail, natural facial asymmetry, healthy believable proportions'

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
