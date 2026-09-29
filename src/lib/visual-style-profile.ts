import { isLiveActionHumanStyle } from './character-reference-policy'
import { getRegionalStoryPreset } from './regional-story-presets'

export const VISUAL_STYLE_PROFILE_VERSION = 'visual-style-profile/v1@2026-08-25'

export interface VisualStyleDescriptor {
    key: string
    label: string
    hint: string
    imagePromptPrefix: string
    videoPromptPrefix: string
    negativePrompt?: string
}

interface VisualStyleDimension {
    /** 面向创作者的简短说明，便于在创建项目时确认风格。 */
    summary: string
    /** 面向图像/视频模型的稳定英文指令。 */
    prompt: string
}

/**
 * 创建项目时冻结的项目级视觉圣经。后续预设即使发生调整，已有项目仍然
 * 使用创建时确认的构图、线条、光影、色彩和镜头规则。
 */
export interface VisualStyleProfile {
    version: typeof VISUAL_STYLE_PROFILE_VERSION
    presetKey: string
    label: string
    hint: string
    artDirection: VisualStyleDimension
    rendering: VisualStyleDimension
    composition: VisualStyleDimension
    linework: VisualStyleDimension
    lighting: VisualStyleDimension
    colorPalette: VisualStyleDimension
    texture: VisualStyleDimension
    cameraLanguage: VisualStyleDimension
    motionLanguage: VisualStyleDimension
    productionDesign: VisualStyleDimension
    imagePromptPrefix: string
    videoPromptPrefix: string
    negativePrompt: string
}

const dimension = (summary: string, prompt: string): VisualStyleDimension => ({ summary, prompt })

function includesAny(context: string, pattern: RegExp): boolean {
    return pattern.test(context)
}

function resolveRendering(context: string, liveAction: boolean): VisualStyleDimension {
    if (includesAny(context, /wildlife|natural-history|documentary|纪录片|纪实/i)) {
        return dimension('自然纪实摄影', 'observational natural-history cinematography, species-accurate and physically plausible, never staged or glossy')
    }
    if (includesAny(context, /claymation|stop.motion|clay |黏土|定格/i)) {
        return dimension('黏土定格动画', 'handmade clay stop-motion animation with miniature practical sets and deliberately tactile construction')
    }
    if (includesAny(context, /paper.cut|paper theater|pop.up|felt|plush|toy.brick|sticker|剪纸|纸艺|毛毡|玩偶/i)) {
        return dimension('手工材料动画', 'handcrafted material-based animation; preserve visible paper, felt, fabric or miniature construction')
    }
    if (includesAny(context, /watercolor|水彩/i)) return dimension('透明水彩插画', 'transparent watercolor illustration with layered washes and visible paper response')
    if (includesAny(context, /ink wash|gongbi|chinese ink|水墨|工笔/i)) return dimension('水墨与工笔绘画', 'Chinese ink-wash and gongbi illustration with controlled brush rhythm and deliberate blank space')
    if (includesAny(context, /oil painting|油画/i)) return dimension('古典油画', 'classical oil painting with layered pigment, visible brushwork and painterly tonal modelling')
    if (includesAny(context, /linocut|risograph|ukiyo|stained glass|charcoal|pastel pencil|版画|浮世绘|彩窗|炭笔/i)) {
        return dimension('版画与材料插画', 'graphic printmaking or material illustration; preserve the selected medium instead of smoothing it into photography')
    }
    if (includesAny(context, /pixel art|voxel|像素/i)) return dimension('像素化数字艺术', 'deliberate pixel or voxel construction with crisp scale-consistent forms')
    if (includesAny(context, /\b3d\b|cgi|render|三维|国漫/i)) return dimension('风格化三维动画', 'polished stylized 3D animation with coherent modelling, shading and material response')
    if (includesAny(context, /anime|manga|webtoon|comic|illustration|cel.shad|cartoon|动漫|漫画|插画/i)) {
        return dimension('二维动画与插画', 'designed 2D illustration or animation with stable character shapes and a clearly non-photorealistic finish')
    }
    if (liveAction) return dimension('真人电影摄影', 'premium live-action cinematography with believable optics, natural anatomy and production-ready realism')
    return dimension('风格化影视画面', 'cohesive stylized cinematic imagery with one clearly controlled rendering language')
}

function resolveComposition(context: string): VisualStyleDimension {
    if (includesAny(context, /wildlife|documentary|landscape|savanna|ocean|forest|desert|nature|纪录片|草原|雨林|海洋|荒漠/i)) {
        return dimension('环境主导的纵深构图', 'environment-led wide compositions with readable foreground, midground and background, natural leading lines and clear scale')
    }
    if (includesAny(context, /(?<!live-)\baction\b|battle|\bwar\b|adventure|disaster|survival|thriller|动作|战争|冒险|灾难|生存/i)) {
        return dimension('动势与尺度优先', 'dynamic diagonal composition, strong foreground-to-background action axis, readable silhouette and controlled asymmetry')
    }
    if (includesAny(context, /romance|romantic|melodrama|情感|言情|浪漫|甜宠/i)) {
        return dimension('人物关系与情绪优先', 'intimate character-led framing, balanced negative space, eyeline-driven staging and selective emotional close-ups')
    }
    if (includesAny(context, /noir|horror|suspense|gothic|crime|悬疑|惊悚|恐怖|暗黑/i)) {
        return dimension('压迫性非对称构图', 'controlled asymmetry, layered occlusion, purposeful negative space and frames-within-frames to build tension')
    }
    return dimension('叙事性三层构图', 'story-led composition with a clear focal hierarchy, foreground-midground-background separation, leading lines and stable visual balance')
}

function resolveLinework(context: string, liveAction: boolean): VisualStyleDimension {
    if (includesAny(context, /graphic novel|comic|manga|webtoon|linocut|ink outlines|版画|漫画|条漫/i)) {
        return dimension('明确而有节奏的描线', 'clean intentional contour lines with controlled weight variation; preserve crisp silhouettes and avoid muddy edges')
    }
    if (includesAny(context, /anime|cel.shad|cartoon|动漫|动画/i)) {
        return dimension('干净动画线稿', 'clean stable line art, readable contour hierarchy and restrained interior detail across every frame')
    }
    if (includesAny(context, /watercolor|ink wash|gongbi|oil painting|charcoal|pastel|水彩|水墨|工笔|油画|炭笔/i)) {
        return dimension('媒介原生笔触', 'visible medium-specific strokes and edge variation; retain expressive marks instead of synthetic vector outlines')
    }
    if (includesAny(context, /\b3d\b|cgi|render|clay|voxel|三维|黏土/i)) {
        return dimension('轮廓由造型与材质定义', 'shape-led silhouettes defined by modelling, material edges and light separation, with no arbitrary drawn outlines')
    }
    if (liveAction) return dimension('自然摄影轮廓', 'photographic edges defined by focus, contrast and light; no illustration outlines or artificial edge halos')
    return dimension('统一轮廓语言', 'consistent edge treatment and silhouette hierarchy appropriate to the selected medium')
}

function resolveLighting(context: string): VisualStyleDimension {
    if (includesAny(context, /neon|cyberpunk|霓虹|赛博/i)) return dimension('霓虹动机光', 'motivated cyan-magenta neon, wet-surface reflections, controlled high contrast and preserved skin or subject separation')
    if (includesAny(context, /noir|gothic|horror|suspense|dark fantasy|悬疑|惊悚|恐怖|暗黑/i)) {
        return dimension('低调戏剧光', 'low-key motivated lighting, shaped shadow, selective rim light and protected highlight detail')
    }
    if (includesAny(context, /romance|soft daylight|pastel|healing|浪漫|言情|治愈|清透/i)) {
        return dimension('柔和自然光', 'soft directional daylight or warm practical light, gentle contrast, flattering falloff and luminous atmosphere')
    }
    if (includesAny(context, /wildlife|documentary|nature|纪录片|纪实|自然/i)) {
        return dimension('可信自然光', 'physically coherent natural light tied to time, weather and geography, with realistic atmospheric depth')
    }
    return dimension('有来源的电影光线', 'motivated key, fill and back light with a consistent direction, controlled contrast and readable depth')
}

function resolveColor(context: string): VisualStyleDimension {
    if (includesAny(context, /neon|cyberpunk|magenta|cyan|霓虹|赛博/i)) return dimension('青洋红高反差色盘', 'controlled cyan-magenta palette with dark neutrals, reflective accents and no uncontrolled rainbow color drift')
    if (includesAny(context, /noir|nordic|cold blue|monochrome|水墨|黑白/i)) return dimension('克制冷调或单色', 'restrained cool or near-monochrome palette with one intentional accent color and stable neutral balance')
    if (includesAny(context, /romance|pastel|watercolor|healing|浪漫|水彩|治愈|清透/i)) return dimension('柔和低对比色盘', 'harmonious pastel or warm-neutral palette with protected skin tones and restrained saturation')
    if (includesAny(context, /royal|palace|gold|mythology|宫廷|神话|金色/i)) return dimension('宝石色与金色点缀', 'rich jewel tones and controlled gold accents balanced by deep neutrals; avoid indiscriminate oversaturation')
    if (includesAny(context, /wildlife|documentary|nature|纪录片|纪实|自然/i)) return dimension('环境原生色彩', 'location-accurate natural color with restrained grading and consistent weather and time-of-day response')
    return dimension('受控叙事色盘', 'a limited story-driven palette with stable neutrals, one dominant hue family and consistent accent colors')
}

function resolveTexture(context: string, liveAction: boolean): VisualStyleDimension {
    if (includesAny(context, /clay|paper.cut|paper theater|pop.up|felt|plush|miniature|handmade|黏土|剪纸|纸艺|毛毡|玩偶|微缩/i)) {
        return dimension('可见手工材质', 'visible handcrafted surface grain, seams, fibers, paper edges or miniature-set imperfections')
    }
    if (includesAny(context, /watercolor|ink wash|oil painting|charcoal|pastel|linocut|risograph|水彩|水墨|油画|炭笔|版画/i)) {
        return dimension('真实画材肌理', 'medium-authentic paper tooth, pigment pooling, brush grain or print texture; no generic digital smoothing')
    }
    if (includesAny(context, /\b3d\b|cgi|render|三维|国漫/i)) return dimension('一致的三维材质系统', 'physically coherent but stylized material response, stable roughness and detailed cloth, skin, metal and environment surfaces')
    if (liveAction) return dimension('真实可触的摄影质感', 'natural skin pores, fabric weave, weathering and subtle film grain without waxy retouching or plastic surfaces')
    return dimension('媒介一致的表面质感', 'coherent material and surface treatment with stable detail density across characters and environments')
}

function resolveCamera(context: string, liveAction: boolean): VisualStyleDimension {
    if (includesAny(context, /wildlife|documentary|nature|纪录片|纪实|自然/i)) {
        return dimension('观察式长焦与环境广角', 'alternate patient telephoto observation with geography-establishing wide shots; preserve believable spatial scale')
    }
    if (includesAny(context, /(?<!live-)\baction\b|battle|\bwar\b|adventure|disaster|动作|战争|冒险|灾难/i)) {
        return dimension('沉浸式广角与动势机位', 'use wide and medium-wide lenses for spatial action, selective low angles for scale and close-ups only for decisive beats')
    }
    if (includesAny(context, /romance|emotional|言情|浪漫|情感/i)) {
        return dimension('亲密中焦人像语言', 'favor natural-perspective medium lenses, selective shallow depth of field and eyeline-matched close-ups')
    }
    if (liveAction) return dimension('自然透视电影镜头', 'use motivated wide, medium and close coverage, natural perspective and depth of field tied to narrative focus')
    return dimension('保持造型的虚拟镜头', 'use clear establishing, medium and close views while preserving shape language, scale and style consistency')
}

function resolveMotion(context: string, liveAction: boolean): VisualStyleDimension {
    if (includesAny(context, /stop.motion|clay|paper|felt|定格|黏土|纸艺|毛毡/i)) return dimension('可感知的逐格运动', 'deliberate pose-to-pose stop-motion cadence, small handcrafted imperfections and no live-action interpolation')
    if (includesAny(context, /anime|manga|comic|illustration|watercolor|ink wash|动漫|漫画|插画|水彩|水墨/i)) {
        return dimension('保持画风的动画运动', 'clear pose-to-pose action, controlled parallax and camera movement without drifting into live action or changing linework')
    }
    if (includesAny(context, /wildlife|documentary|nature|纪录片|纪实|自然/i)) return dimension('克制观察式运动', 'patient pans, restrained tracking and behavior-led camera movement without artificial spectacle')
    if (includesAny(context, /(?<!live-)\baction\b|battle|\bwar\b|adventure|动作|战争|冒险/i)) return dimension('动作轴清晰的动态摄影', 'motivated tracking and reveal moves with readable action geography, stable screen direction and controlled acceleration')
    if (liveAction) return dimension('叙事驱动的电影运动', 'motivated dolly, pan or restrained handheld movement; preserve screen direction and avoid random camera drift')
    return dimension('风格一致的镜头运动', 'purposeful camera and subject motion that preserves the selected medium and stable spatial continuity')
}

function joinPrompt(parts: Array<string | null | undefined>): string {
    return parts
        .map(part => part?.trim())
        .filter((part): part is string => Boolean(part))
        .filter((part, index, all) => all.indexOf(part) === index)
        .join(', ')
}

export function createVisualStyleProfile(style: VisualStyleDescriptor): VisualStyleProfile {
    const context = [style.key, style.label, style.hint, style.imagePromptPrefix, style.videoPromptPrefix].join(' ')
    const liveAction = isLiveActionHumanStyle(style)
    const rendering = resolveRendering(context, liveAction)
    const composition = resolveComposition(context)
    const linework = resolveLinework(context, liveAction)
    const lighting = resolveLighting(context)
    const colorPalette = resolveColor(context)
    const texture = resolveTexture(context, liveAction)
    const cameraLanguage = resolveCamera(context, liveAction)
    const motionLanguage = resolveMotion(context, liveAction)
    const artDirection = dimension(`${style.label}：${style.hint}`, style.imagePromptPrefix)
    const productionDesign = dimension('统一时代、地域、服装与场景设计', `coherent production design derived from ${style.label}; keep era, culture, wardrobe, architecture, props and environment mutually consistent`)
    const imagePromptPrefix = joinPrompt([
        style.imagePromptPrefix,
        rendering.prompt,
        composition.prompt,
        linework.prompt,
        lighting.prompt,
        colorPalette.prompt,
        texture.prompt,
        cameraLanguage.prompt,
        productionDesign.prompt
    ])
    const videoPromptPrefix = joinPrompt([
        style.videoPromptPrefix,
        rendering.prompt,
        composition.prompt,
        lighting.prompt,
        colorPalette.prompt,
        texture.prompt,
        cameraLanguage.prompt,
        motionLanguage.prompt,
        productionDesign.prompt
    ])
    const mediumMismatchNegative = liveAction
        ? 'anime, cartoon, illustration, painterly rendering, plastic CGI skin'
        : 'unintended live action, accidental photorealistic humans, inconsistent rendering medium'

    return {
        version: VISUAL_STYLE_PROFILE_VERSION,
        presetKey: style.key,
        label: style.label,
        hint: style.hint,
        artDirection,
        rendering,
        composition,
        linework,
        lighting,
        colorPalette,
        texture,
        cameraLanguage,
        motionLanguage,
        productionDesign,
        imagePromptPrefix,
        videoPromptPrefix,
        negativePrompt: joinPrompt([style.negativePrompt, mediumMismatchNegative, 'style drift, inconsistent palette, inconsistent lighting direction, mixed visual media'])
    }
}

function isDimension(value: unknown): value is VisualStyleDimension {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidate = value as Partial<VisualStyleDimension>
    return typeof candidate.summary === 'string' && candidate.summary.length > 0 && typeof candidate.prompt === 'string' && candidate.prompt.length > 0
}

export function resolveVisualStyleProfile(style: VisualStyleDescriptor, stored: unknown): VisualStyleProfile {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return createVisualStyleProfile(style)
    const candidate = stored as Partial<VisualStyleProfile>
    const dimensions = [
        candidate.artDirection,
        candidate.rendering,
        candidate.composition,
        candidate.linework,
        candidate.lighting,
        candidate.colorPalette,
        candidate.texture,
        candidate.cameraLanguage,
        candidate.motionLanguage,
        candidate.productionDesign
    ]
    if (
        candidate.version !== VISUAL_STYLE_PROFILE_VERSION ||
        candidate.presetKey !== style.key ||
        candidate.label !== style.label ||
        !dimensions.every(isDimension) ||
        typeof candidate.imagePromptPrefix !== 'string' ||
        typeof candidate.videoPromptPrefix !== 'string' ||
        typeof candidate.negativePrompt !== 'string'
    ) {
        return createVisualStyleProfile(style)
    }
    return candidate as VisualStyleProfile
}

export function applyVisualStyleProfile<T extends VisualStyleDescriptor>(style: T, stored: unknown): T {
    const profile = resolveVisualStyleProfile(style, stored)
    return {
        ...style,
        imagePromptPrefix: profile.imagePromptPrefix,
        videoPromptPrefix: profile.videoPromptPrefix,
        negativePrompt: profile.negativePrompt
    }
}

export function formatVisualStyleProfile(profile: VisualStyleProfile): string {
    return [
        `风格身份：${profile.label}（${profile.hint}）`,
        `艺术方向：${profile.artDirection.prompt}`,
        `渲染媒介：${profile.rendering.prompt}`,
        `构图逻辑：${profile.composition.prompt}`,
        `线条/轮廓：${profile.linework.prompt}`,
        `光影：${profile.lighting.prompt}`,
        `色彩：${profile.colorPalette.prompt}`,
        `材质：${profile.texture.prompt}`,
        `镜头语言：${profile.cameraLanguage.prompt}`,
        `运动语言：${profile.motionLanguage.prompt}`,
        `美术与场景：${profile.productionDesign.prompt}`,
        `负面约束：${profile.negativePrompt}`
    ].join('\n')
}

/** Build preview art from the same visual-language contract used in production. */
export function buildVisualStylePreviewPrompt(style: VisualStyleDescriptor, stored?: unknown): string {
    const profile = resolveVisualStyleProfile(style, stored)
    return joinPrompt([
        profile.imagePromptPrefix,
        getRegionalStoryPreset(style.key)?.previewScene ?? '',
        'premium vertical short-drama key visual that demonstrates this exact rendering medium, composition logic, linework, lighting, palette, texture, camera language and production design',
        'one coherent finished scene with a clear focal hierarchy and production-ready detail',
        'no text, no title, no logo, no watermark, no UI'
    ])
}
