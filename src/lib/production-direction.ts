import type { NovelSetup } from './novel'

type DirectionStage = 'outline' | 'script' | 'extract' | 'storyboard' | 'image' | 'video'

const DIRECTIONS: Record<DirectionStage, string> = {
    outline:
        '开场尽快呈现一个具体未解决的问题；每集围绕人物目标、阻力、选择与代价推进，兑现至少一个局部结果，再留下由本集行动引出的悬念。强度包含紧张与释放，不能每集重复误会、反转或重新开场。将情绪变化落实为可拍的行为和关键道具，并在 synopsis 中交代。保留原著事件顺序，不为制造钩子提前泄露秘密。',
    script: '用行动、反应和潜台词传递情绪：触发事件之后才发生表情变化，人物说话要有对象与目的。删去重复解释同一事实的对白，保留来源中的关键信息和因果；在动作结果、信息揭示和情绪转折处留出可表演的反应空间。氛围通过已有的环境、声音与人物行为表现，不凭空增加天气、音乐、道具或人物。',
    extract:
        '分开记录长期身份与临时剧情状态：脸型、年龄、发型、物种和常用服装属于身份；本场衣物湿损、伤痕、表情、姿势、手持物属于剧情状态。场景库记录空间布局、出入口、固定光源与长期物件；保留同一地点不同日夜状态的关系，不把临时光效写成永久场景。',
    storyboard:
        '先明确每镜的叙事用途：建立空间、推动动作、交付信息或呈现反应；景别与时长服务于该用途，不机械轮换。对话正反打保持 180° 轴线与互补视线，运动保持屏幕方向；越轴必须有剧本支持的可见移动或中性机位交代。相邻同机位镜头避免近似裁切造成跳切；细节镜头交代其属于谁及所在位置。镜尾记录动作阶段、视线目标与出画方向，下一镜从对应阶段接入，不能重演已经完成的动作。明确时间/地点跳转时重新建立空间，不强行无缝延续。所有决定写入现有 actionDesc、imagePrompt、continuityReason，不新增对白或事件。',
    image: 'CINEMATOGRAPHY: depict one readable story instant with a clear focal subject and coherent foreground/background depth. Follow the source light direction, practical sources, exposure, palette and weather; retain readable faces, material texture and highlight detail within the chosen art style. Preserve spatial landmarks, eyelines and screen direction across cuts. Keep faces, hands and story props inside the requested composition; avoid accidental limb crops. Do not add cinematic fog, neon, rain, lens flare, heavy bloom or shallow focus unless supported by the source or style. Existing references and explicit shot instructions take priority; do not redesign their lighting or composition.',
    video: 'CINEMATOGRAPHY AND ATMOSPHERE: let camera movement serve the stated dramatic beat; a stable camera is valid when subject performance carries the scene. Preserve screen direction, eyeline targets, light-source direction, exposure and color across the clip; no focus hunting, flicker, rubbery motion or unmotivated zoom. Actions have readable cause, contact/weight and consequence; continue from the opening pose without replaying a previous action. Reach the specified ending state with natural residual motion, not a freeze or a new event. Animate only environmental elements already present; no invented rain, fog, particles or visual effects. Where native audio is supported, keep dialogue intelligible over consistent scene ambience, preserve speaker turns and do not add an unrelated music cue. Explicit source, reference, style and user direction take priority.'
}

export function productionDirection(stage: DirectionStage): string {
    return DIRECTIONS[stage]
}

export function compositionDirection(setup?: Pick<NovelSetup, 'videoAspectRatio'>): string {
    const ratio = setup?.videoAspectRatio ?? '9:16'
    if (ratio === '16:9') return '16:9 横屏构图：用横向空间交代人物关系，保留视线与运动方向的空间；不要写成竖屏构图。'
    if (ratio === '1:1') return '1:1 方形构图：主体与关键动作在方形画幅内完整可读，避免沿用竖屏或宽银幕裁切。'
    return '9:16 竖屏构图：利用纵向和前后景层次，保留头部、手部与关键道具，避免重要动作贴边。'
}
