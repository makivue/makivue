import { getStylePreviewSrc } from './style-preview'
import { buildRegionalPreviewPrompt, REGIONAL_STORY_PRESETS, regionalVisualDirection } from './regional-story-presets'
import { isLiveActionHumanStyle, LEGACY_BEAUTY_PREFIX, LIVE_ACTION_BEAUTY_PREFIX } from './character-reference-policy'
import { DEFAULT_VISUAL_STYLE_KEY } from './project-metadata'
import type { EpisodeFactSnapshot } from './content-contracts'
import { applyVisualStyleProfile, createVisualStyleProfile, resolveVisualStyleProfile, type VisualStyleProfile } from './visual-style-profile'

export type { VisualStyleProfile } from './visual-style-profile'

export interface NovelCharacterInput {
    name: string
    role?: string
    age?: string
    gender?: string
    persona?: string
    dialogueProfile?: {
        voice?: string
        sentencePattern?: string
        preferredVocabulary?: string
        concealmentStyle?: string
        emotionalLeak?: string
        verbalTaboos?: string
    }
}

/** 剧集形态：影响单集时长、剧本输出容量、分镜数和改编浓缩程度。 */
export type EpisodeFormat = 'micro' | 'short' | 'long'

export interface EpisodeFormatSpec {
    label: string
    durationDescription: string
    minDurationSeconds: number
    maxDurationSeconds: number
    scriptStyle: string
    /** 拆剧本输出容量参考；整集估算时长和字数均不作为验收硬门槛。 */
    minWords: number
    targetWords: number
    maxWords: number
    /** 分镜数量参考（生成分镜时让 LLM 命中） */
    shotCountHint: string
    /** 单镜时长参考 */
    shotDurationHint: string
    /** 拆剧本时给 LLM 的浓缩思路提示 */
    compressionHint: string
    /** 至少有一个场次；场次增减由剧情决定，不以切换地点凑数。 */
    minSceneChanges: number
    /** 默认每章正文目标字数（写小说阶段用） */
    chapterWordHint: number
    /** 拆剧本 LLM 调用最大输出 token */
    scriptMaxTokens: number
}

const EPISODE_FORMAT_SPECS: Record<EpisodeFormat, EpisodeFormatSpec> = {
    micro: {
        label: '微剧（竖屏 1-2 分钟）',
        durationDescription: '1-2 分钟',
        minDurationSeconds: 60,
        maxDurationSeconds: 120,
        scriptStyle: '紧凑对白 + 清楚的动作因果与状态变化，必要时少量旁白',
        minWords: 800,
        targetWords: 1200,
        maxWords: 2400,
        shotCountHint: '8-15 个分镜',
        shotDurationHint: '5-8 秒/镜',
        compressionHint: '把一整章压成最强钩子+反转，砍掉大段铺垫和支线，保留核心冲突',
        minSceneChanges: 1,
        chapterWordHint: 2500,
        scriptMaxTokens: 8192
    },
    short: {
        label: '标准短剧（5-8 分钟）',
        durationDescription: '5-8 分钟',
        minDurationSeconds: 300,
        maxDurationSeconds: 480,
        scriptStyle: '对白为主 + 可执行的场景、动作与表情描述',
        minWords: 3000,
        targetWords: 4000,
        maxWords: 5500,
        shotCountHint: '30-50 个分镜',
        shotDurationHint: '6-10 秒/镜',
        compressionHint: '保留章节主要场景和冲突，必要时合并次要场景；展开关键对话和情绪转折',
        minSceneChanges: 1,
        chapterWordHint: 5000,
        scriptMaxTokens: 12288
    },
    long: {
        label: '长篇剧（15-30 分钟）',
        durationDescription: '15-30 分钟',
        minDurationSeconds: 900,
        maxDurationSeconds: 1800,
        scriptStyle: '完整对白 + 详细动作 + 必要的环境描写',
        minWords: 8000,
        targetWords: 11000,
        maxWords: 15000,
        shotCountHint: '80-150 个分镜',
        shotDurationHint: '8-15 秒/镜',
        compressionHint: '逐场景改编，原章节大部分内容都要保留；可适当扩写次要角色对白让节奏更立体',
        minSceneChanges: 1,
        chapterWordHint: 10000,
        scriptMaxTokens: 32768
    }
}

export function getEpisodeFormatSpec(format: EpisodeFormat | undefined | null): EpisodeFormatSpec {
    return EPISODE_FORMAT_SPECS[format ?? 'micro'] ?? EPISODE_FORMAT_SPECS.micro
}

export function listEpisodeFormats(): Array<{ value: EpisodeFormat; spec: EpisodeFormatSpec }> {
    return (Object.keys(EPISODE_FORMAT_SPECS) as EpisodeFormat[]).map(value => ({ value, spec: EPISODE_FORMAT_SPECS[value] }))
}

export interface NovelEpisodeStatePlan {
    episodeNumber: number
    openingState?: string
    endingState?: string
    characterStateChanges?: string
    continuityBridge?: string
    coldOpen?: string
    protagonistGoal?: string
    primaryObstacle?: string
    escalation?: string
    irreversibleChoice?: string
    cost?: string
    reversal?: string
    informationGain?: string
    cliffhanger?: string
    setupPayoffs?: string[]
    /** Ordered, indispensable events, including the causal turn and ending hook. */
    requiredEvents?: string[]
}

export interface NovelSetup {
    /** AI 新生成的小说、大纲、剧本、分镜等创作内容所使用的语言；与页面语言相互独立 */
    contentLanguage?: import('@/i18n/config').Locale
    targetWordCount?: number
    /** 主类型只能有一个，用来锁定题材底盘；appealTags 只做爽点/辅标签 */
    primaryGenre?: string
    /** 项目级视频比例，会影响分镜构图、首尾帧图片和视频生成 */
    videoAspectRatio?: '9:16' | '16:9' | '1:1'
    /** 剧集形态：决定单集时长、剧本输出容量、分镜数和拆剧本浓缩程度。 */
    episodeFormat?: EpisodeFormat
    perspective?: string
    pace?: string
    tone?: string
    appealTags?: string[]
    /** 故事最小承诺：一句话卖点、主冲突、主角欲望、反派阻力、爽点公式 */
    coreSeed?: string
    /** 世界观与拍摄规则：时代、地点、阶层、职业/能力系统、禁忌、视觉边界 */
    worldBible?: string
    /** 长线结构：开端事件、中段反转、阶段高潮、终局爆点 */
    plotArchitecture?: string
    /** 角色弧光：主要角色的目标、秘密、关系变化、不可违背的行为准则 */
    characterArcs?: string
    /** 项目级风格参考图，会作为角色/场景/首尾帧生成的风格锚点 */
    styleReferenceImages?: string[]
    /** 风格参考图生成提示，可让用户补充质感、色彩、镜头语言 */
    styleReferencePrompt?: string
    mainCharacters?: NovelCharacterInput[]
    supportingCharacters?: NovelCharacterInput[]
    relationships?: string
    outline?: string
    keyPlots?: string[]
    /** 由大纲阶段生成/维护，用于后续章节、剧本、分镜衔接 */
    episodeStatePlan?: NovelEpisodeStatePlan[]
    /** 全剧事实/伏笔账本；长上下文裁剪时仍完整传递。 */
    factLedger?: EpisodeFactSnapshot[]
    /** setup 字段来源：user / model / inherited / derived。 */
    fieldSources?: Record<string, string>
    /** 关键提示词和校验契约版本登记。 */
    promptVersions?: Record<string, string>
    /** 最近一次全剧大纲统稿结果，供后续生成与诊断复用。 */
    /** 视觉风格预设 key，见 VISUAL_STYLE_PRESETS */
    visualStyle?: string
    /** 创建项目时冻结的完整视觉语言规范，供分镜、图片和视频全链路复用。 */
    visualStyleProfile?: VisualStyleProfile
}

export interface VisualStylePreset {
    key: string
    label: string
    hint: string
    /** 生成风格样张/项目风格参考图时使用的提示词 */
    previewPrompt: string
    /** 图像生成的风格前缀（所有 char ref / scene ref / frame 都会加） */
    imagePromptPrefix: string
    /** 视频生成的风格锁定 prompt，防止视频模型把图像风格真人化 */
    videoPromptPrefix: string
    /** 负面提示（可选） */
    negativePrompt?: string
}

// 审美锚按渲染族分流：写实族保留自然皮肤与人物差异；动漫/3D/插画族沿用强风格化美型锚。
const BEAUTY_PREFIX = LEGACY_BEAUTY_PREFIX

function expandedStylePreset(key: string, label: string, hint: string, visualDirection: string, negativePrompt = 'generic setting, text, logo, watermark, ugly, low quality'): VisualStylePreset {
    const videoPromptPrefix = `${visualDirection}, premium cinematic video, consistent costumes, setting, lighting and cultural details`
    const beautyPrefix = isLiveActionHumanStyle({ key, label, hint, imagePromptPrefix: visualDirection, videoPromptPrefix })
        ? LIVE_ACTION_BEAUTY_PREFIX
        : BEAUTY_PREFIX
    return {
        key,
        label,
        hint,
        previewPrompt: `${visualDirection}, premium vertical short drama key visual, distinctive cultural and visual details, sharp cinematic composition, no text, no logo, no watermark`,
        imagePromptPrefix: `${visualDirection}, consistent production design, ${beautyPrefix}`,
        videoPromptPrefix,
        negativePrompt
    }
}

function expandedEnvironmentStylePreset(key: string, label: string, hint: string, visualDirection: string, negativePrompt: string): VisualStylePreset {
    const preset = expandedStylePreset(key, label, hint, visualDirection, negativePrompt)
    return {
        ...preset,
        imagePromptPrefix: `${visualDirection}, consistent premium natural-history production design`,
        videoPromptPrefix: `${visualDirection}, premium cinematic documentary video, physically coherent motion and environment`
    }
}

function expandedAnimalAnimationStylePreset(key: string, label: string, hint: string, visualDirection: string): VisualStylePreset {
    const preset = expandedStylePreset(key, label, hint, visualDirection, 'humans, live action, text, logo, watermark, malformed animals, low quality')
    return {
        ...preset,
        imagePromptPrefix: `${visualDirection}, expressive species-accurate animal characters, consistent animated production design, no humans`,
        videoPromptPrefix: `${visualDirection}, premium animated animal adventure video, expressive animal motion, no live action and no humans`
    }
}

const RAW_VISUAL_STYLE_PRESETS: VisualStylePreset[] = [
    {
        key: 'anime',
        label: '日系动漫',
        hint: 'cel-shaded 日系动画风，一致性最好',
        previewPrompt:
            'anime style key visual for a premium short drama, beautiful young heroine in a rain-lit city street, expressive eyes, clean linework, cel-shaded japanese animation, cinematic composition, no text, no logo',
        imagePromptPrefix: `anime style illustration, cel-shaded, japanese animation art style, vibrant colors, clean linework, flat shading, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'strict 2D anime video, cel-shaded japanese animation look, clean line art, flat shaded colors, animated characters only, keep every frame non-photorealistic, NOT live action, NOT real people',
        negativePrompt: 'photorealistic, real person, ugly, old-looking, blurry face, deformed face, bad anatomy'
    },
    {
        key: 'cinematic',
        label: '电影写实',
        hint: '高质感电影风，真人级',
        previewPrompt:
            'cinematic photorealistic short drama key visual, attractive young lead in dramatic side light, rainy window, shallow depth of field, 35mm film grain, premium film still, no text, no logo',
        imagePromptPrefix: `cinematic photorealistic style, film still, dramatic lighting, shallow depth of field, 35mm film grain, professional cinematography, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'cinematic live-action short drama video, photorealistic film still look, dramatic lighting, shallow depth of field, professional vertical cinematography',
        negativePrompt: 'ugly, disfigured, old, blurry, low quality'
    },
    {
        key: 'chinese-ink',
        label: '中国古风（水墨/工笔）',
        hint: '古装剧首选，水墨工笔风',
        previewPrompt:
            'chinese ink and gongbi style drama key visual, elegant hanfu heroine beside misty pavilion, flowing brush lines, soft paper texture, refined ancient atmosphere, no text, no logo',
        imagePromptPrefix: `chinese traditional ink painting style, elegant brushwork, hanfu costume, classical chinese aesthetic, xianxia wuxia art, soft color palette, ${BEAUTY_PREFIX}, delicate cherry lips, willow-leaf waist for female, handsome jade-like gentleman for male`,
        videoPromptPrefix:
            'animated chinese ink painting video, gongbi brushwork, elegant hanfu drama aesthetic, soft paper texture, flowing ink lines, stylized non-photorealistic characters, NOT live action, NOT real people',
        negativePrompt: 'ugly, modern clothes, low quality'
    },
    {
        key: 'cn-3d',
        label: '国漫 3D',
        hint: '国产 3D 动画电影风',
        previewPrompt:
            'chinese 3D animated film key visual, handsome and beautiful fantasy drama characters, polished 3D render, cinematic lighting, detailed costume and environment, no text, no logo',
        imagePromptPrefix: `chinese 3d animation style, stylized 3d render, high-end chinese animated feature look, detailed character modeling, cinematic 3d lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'stylized chinese 3D animated film video, high quality 3D character animation, cinematic lighting, polished fantasy drama look, animated characters only, NOT live action, NOT photorealistic real people',
        negativePrompt: 'ugly, deformed, low quality'
    },
    {
        key: 'graphic-novel',
        label: '漫画分镜',
        hint: '强线条、网点、漫画冲击力',
        previewPrompt: 'graphic novel short drama key visual, bold ink outlines, screen tone shading, high contrast emotional close-up, dynamic panel composition, no text, no logo',
        imagePromptPrefix: `graphic novel comic style, strong ink outlines, screen tone shading, high contrast panel composition, dynamic manga-inspired drama framing, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'animated graphic novel video, bold ink outlines, comic book screen tones, high contrast panel-like composition, stylized drawn characters only, NOT live action, NOT photorealistic',
        negativePrompt: 'photorealistic, real person, soft blurry lines, low contrast, ugly, deformed'
    },
    {
        key: 'western-3d',
        label: '欧美动画电影',
        hint: '商业动画电影质感，表演夸张',
        previewPrompt:
            'stylized western 3D animated movie key visual, expressive attractive protagonist, colorful cinematic lighting, polished character design, dramatic short drama mood, no text, no logo',
        imagePromptPrefix: `stylized western 3d animated film style, expressive faces, polished character design, colorful cinematic lighting, detailed 3d environment, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'stylized western 3D animated movie video, expressive animated characters, polished 3D lighting, family animation film quality, NOT live action, NOT photorealistic real people',
        negativePrompt: 'live action, real person, uncanny face, low quality, ugly, deformed'
    },
    {
        key: 'claymation',
        label: '粘土定格',
        hint: '手工感强，适合奇趣题材',
        previewPrompt:
            'claymation stop-motion key visual, handmade clay drama characters on miniature practical set, tactile material texture, soft studio lighting, charming handcrafted look, no text, no logo',
        imagePromptPrefix: `claymation stop-motion style, handmade clay characters, miniature practical sets, tactile material texture, soft studio lighting, charming handcrafted look, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'claymation stop-motion animated video, handmade clay characters, miniature sets, tactile material texture, frame-by-frame animation feel, NOT live action, NOT photorealistic',
        negativePrompt: 'live action, real person, glossy plastic, low quality, deformed'
    },
    {
        key: 'cyberpunk',
        label: '赛博霓虹',
        hint: '雨夜都市、霓虹、科幻悬疑',
        previewPrompt: 'cyberpunk anime short drama key visual, beautiful lead in neon rainy futuristic Chinese city, magenta cyan lighting, reflective wet street, suspense mood, no text, no logo',
        imagePromptPrefix: `cyberpunk anime illustration style, neon city lights, rainy street reflections, futuristic chinese metropolis, high contrast magenta cyan lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'stylized cyberpunk anime video, neon rainy city, magenta and cyan lighting, futuristic urban drama, animated illustrated characters only, NOT live action, NOT photorealistic',
        negativePrompt: 'daylight flat lighting, photorealistic real person, dull colors, ugly, low quality'
    },
    {
        key: 'hk-film',
        label: '港风胶片',
        hint: '90 年代港片、霓虹、胶片颗粒',
        previewPrompt: '1990s Hong Kong cinema short drama key visual, neon alley, attractive protagonist, warm tungsten and magenta lights, moody film grain, stylish suspense, no text, no logo',
        imagePromptPrefix: `1990s Hong Kong cinema style, neon alley, moody film grain, warm tungsten light, dramatic urban night, stylish short drama still, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: '1990s Hong Kong cinema video, neon alley atmosphere, moody film grain, warm tungsten lighting, stylish live-action short drama look, vertical cinematography',
        negativePrompt: 'flat lighting, modern sterile look, ugly, low quality, over-smoothed skin'
    },
    {
        key: 'minguo',
        label: '民国复古',
        hint: '旧上海、旗袍、西装、暖胶片',
        previewPrompt: '1930s Shanghai republican era drama key visual, elegant qipao and tailored suit characters, vintage interior, warm film tone, refined period lighting, no text, no logo',
        imagePromptPrefix: `1930s Shanghai republican era drama style, qipao, tailored suits, vintage interiors, warm film tone, elegant period lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: '1930s Shanghai republican era drama video, qipao and tailored suits, vintage warm film tone, elegant period lighting, refined live-action drama look',
        negativePrompt: 'modern clothes, modern city signs, low quality, ugly, anachronistic objects'
    },
    {
        key: 'dark-fantasy',
        label: '暗黑奇幻',
        hint: '哥特、迷雾、强戏剧光',
        previewPrompt: 'dark fantasy drama key visual, beautiful protagonist in misty gothic hall, magical rim lighting, mysterious atmosphere, dramatic painterly composition, no text, no logo',
        imagePromptPrefix: `dark fantasy illustration style, gothic atmosphere, misty castle or ancient hall, dramatic rim lighting, mysterious magical ambience, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'stylized dark fantasy animated video, gothic atmosphere, mist, dramatic rim lighting, magical ambience, illustrated non-photorealistic characters, NOT live action, NOT real people',
        negativePrompt: 'bright comedy look, photorealistic real person, low quality, ugly, flat lighting'
    },
    {
        key: 'oil-painting',
        label: '油画',
        hint: '古典油画质感',
        previewPrompt:
            'classical oil painting short drama key visual, attractive protagonist under dramatic chiaroscuro, rich brushstrokes, renaissance portrait mood, cinematic composition, no text, no logo',
        imagePromptPrefix: `oil painting style, rich brushstrokes, classical oil painting, dramatic chiaroscuro lighting, renaissance portrait aesthetic, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated oil painting video, visible rich brushstrokes, classical chiaroscuro, painterly motion, non-photorealistic painted characters, NOT live action, NOT real people',
        negativePrompt: 'ugly, deformed'
    },
    {
        key: 'watercolor',
        label: '水彩',
        hint: '柔和水彩插画',
        previewPrompt:
            'watercolor illustration short drama key visual, gentle emotional protagonist, soft pastel tones, transparent wash, paper texture, elegant cinematic composition, no text, no logo',
        imagePromptPrefix: `watercolor illustration style, soft pastel tones, transparent wash, paper texture, delicate watercolor art, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'animated watercolor illustration video, soft pastel tones, transparent wash, paper texture, gentle painterly motion, non-photorealistic drawn characters, NOT live action, NOT real people',
        negativePrompt: 'ugly, harsh lines'
    },
    {
        key: 'modern-drama',
        label: '现代短剧写实',
        hint: '现代都市、办公室、家庭伦理',
        previewPrompt:
            'modern Chinese short drama key visual, attractive lead in contemporary city interior, clean commercial lighting, realistic drama atmosphere, premium vertical poster still, no text, no logo',
        imagePromptPrefix: `modern Chinese short drama photorealistic style, contemporary city life, clean commercial lighting, realistic wardrobe and interiors, premium drama still, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'modern Chinese live-action short drama video, contemporary urban setting, clean commercial lighting, realistic performances, premium vertical drama look',
        negativePrompt: 'fantasy costume, cartoon, anime, old-looking, ugly, blurry, low quality'
    },
    {
        key: 'korean-clean',
        label: '韩剧清透感',
        hint: '柔光、清爽、恋爱/职场',
        previewPrompt: 'clean romantic drama key visual, attractive protagonist in soft daylight, bright refined interior, translucent skin tone, gentle pastel color grading, no text, no logo',
        imagePromptPrefix: `clean romantic drama style, soft daylight, bright refined interiors, gentle pastel color grading, polished fashion, elegant emotional close-up, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'clean romantic drama video, soft daylight, gentle pastel color grading, refined interiors, subtle emotional acting, premium live-action look',
        negativePrompt: 'harsh shadows, dirty color, horror, cyberpunk, ugly, low quality'
    },
    {
        key: 'thai-saturated',
        label: '泰剧高饱和',
        hint: '强情绪、高饱和、豪门狗血',
        previewPrompt:
            'high-saturation melodrama key visual, attractive lead in luxury villa, dramatic sunlight, vivid colors, intense emotional expression, premium soap drama still, no text, no logo',
        imagePromptPrefix: `high-saturation melodrama style, luxury villa and glamorous wardrobe, vivid colors, dramatic sunlight, intense emotional close-up, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'high-saturation live-action melodrama video, luxury interiors, vivid color grading, intense emotional performance, glossy short drama look',
        negativePrompt: 'flat lighting, dull colors, documentary look, ugly, low quality'
    },
    {
        key: 'urban-neon-real',
        label: '都市霓虹写实',
        hint: '夜店、雨夜、都市悬疑',
        previewPrompt: 'photorealistic urban neon short drama key visual, attractive lead under rainy neon lights, wet street reflections, suspenseful city night, no text, no logo',
        imagePromptPrefix: `photorealistic urban neon drama style, rainy city night, wet street reflections, neon signs without readable text, suspense mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'photorealistic urban neon drama video, rainy city night, wet reflections, neon lighting, suspenseful live-action short drama look',
        negativePrompt: 'cartoon, daylight, readable text, ugly, low quality'
    },
    {
        key: 'hk-crime',
        label: '港风警匪',
        hint: '警匪、卧底、街头追逐',
        previewPrompt: 'Hong Kong crime thriller key visual, attractive detective in neon alley, wet asphalt, tense cinematic lighting, gritty film grain, no text, no logo',
        imagePromptPrefix: `Hong Kong crime thriller style, neon alley, wet asphalt, police undercover atmosphere, gritty film grain, tense cinematic lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'Hong Kong crime thriller video, neon alley, tense street atmosphere, gritty film grain, handheld but controlled live-action drama look',
        negativePrompt: 'comedy look, clean sterile lighting, cartoon, ugly, low quality'
    },
    {
        key: 'xianxia',
        label: '古装仙侠',
        hint: '仙门、灵气、法术光效',
        previewPrompt: 'xianxia fantasy drama key visual, beautiful hanfu protagonist on cloud mountain, glowing spiritual energy, elegant sword, cinematic ancient fantasy, no text, no logo',
        imagePromptPrefix: `xianxia fantasy drama style, elegant hanfu, cloud mountain, glowing spiritual energy, ancient sect atmosphere, cinematic magical lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'xianxia fantasy drama video, elegant hanfu, cloud mountain, glowing spiritual energy, stylized ancient fantasy motion, premium drama look',
        negativePrompt: 'modern clothes, city, sci-fi, ugly, low quality'
    },
    {
        key: 'wuxia-ink',
        label: '武侠水墨',
        hint: '江湖、剑客、浓淡墨色',
        previewPrompt: 'wuxia ink wash key visual, elegant swordsman in misty bamboo forest, black ink brushwork, restrained color, dynamic martial arts composition, no text, no logo',
        imagePromptPrefix: `wuxia ink wash style, misty bamboo forest, elegant swordsman, dynamic brushwork, restrained monochrome palette, martial arts drama mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated wuxia ink wash video, misty bamboo forest, flowing brush lines, martial arts drama atmosphere, non-photorealistic painterly motion',
        negativePrompt: 'modern clothes, neon city, photorealistic real person, ugly, low quality'
    },
    {
        key: 'new-chinese-3d',
        label: '新中式国漫',
        hint: '国潮、中式纹样、精致 3D',
        previewPrompt: 'new Chinese stylized 3D animation key visual, attractive protagonist with modern Chinese costume details, jade and gold accents, cinematic lighting, no text, no logo',
        imagePromptPrefix: `new Chinese stylized 3D animation style, modern Chinese costume details, jade and gold accents, elegant fantasy architecture, polished cinematic 3D render, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'new Chinese stylized 3D animation video, elegant national-style design, polished 3D lighting, modern Chinese fantasy drama look',
        negativePrompt: 'cheap plastic, low-poly, western medieval, ugly, low quality'
    },
    {
        key: 'shoujo-manga',
        label: '少女漫画',
        hint: '恋爱、闪光、细腻表情',
        previewPrompt: 'shoujo manga romance key visual, beautiful heroine with sparkling eyes, soft flowers and light particles, delicate line art, emotional close-up, no text, no logo',
        imagePromptPrefix: `shoujo manga romance style, sparkling eyes, delicate line art, flowers and soft light particles, emotional close-up, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated shoujo manga romance video, delicate line art, sparkling light, soft emotional performance, non-photorealistic drawn characters',
        negativePrompt: 'photorealistic, horror, gritty crime, ugly, low quality'
    },
    {
        key: 'shonen-action',
        label: '热血少年漫',
        hint: '动作、能量、强冲击',
        previewPrompt: 'shonen action manga key visual, attractive young hero in dynamic battle pose, speed lines, energy burst, bold cel shading, no text, no logo',
        imagePromptPrefix: `shonen action manga style, dynamic battle pose, speed lines, energy burst, bold cel shading, dramatic perspective, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated shonen action video, dynamic battle motion, speed lines, energy burst, bold cel-shaded characters, high-impact composition',
        negativePrompt: 'static pose, photorealistic, weak motion, ugly, low quality'
    },
    {
        key: 'q-version',
        label: 'Q版可爱',
        hint: '轻喜剧、萌系、低龄友好',
        previewPrompt: 'cute chibi short drama key visual, charming small-proportion characters in cozy scene, rounded shapes, bright colors, playful expression, no text, no logo',
        imagePromptPrefix: `cute chibi style, rounded small-proportion characters, bright colors, cozy playful scene, charming expressive faces, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'cute chibi animated video, rounded small-proportion characters, bright colors, playful motion, cozy comedy drama look',
        negativePrompt: 'realistic adult proportions, horror, gritty, ugly, low quality'
    },
    {
        key: 'paper-cutout',
        label: '纸片定格',
        hint: '拼贴、纸纹、轻奇幻',
        previewPrompt: 'paper cutout stop-motion key visual, layered paper characters and miniature set, visible paper texture, soft shadow, whimsical drama mood, no text, no logo',
        imagePromptPrefix: `paper cutout stop-motion style, layered paper characters, visible paper texture, miniature set, soft shadow, handcrafted whimsical look, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'paper cutout stop-motion animated video, layered paper texture, handcrafted motion, miniature theatrical set, whimsical drama atmosphere',
        negativePrompt: 'photorealistic, glossy 3D, messy collage, ugly, low quality'
    },
    {
        key: 'post-apocalyptic',
        label: '废土末世',
        hint: '末日、生存、荒城',
        previewPrompt: 'post-apocalyptic short drama key visual, attractive survivor in ruined city, dusty sunlight, improvised gear, tense survival atmosphere, no text, no logo',
        imagePromptPrefix: `post-apocalyptic survival drama style, ruined city, dusty sunlight, improvised gear, tense survival atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'post-apocalyptic survival drama video, ruined city, dusty sunlight, tense live-action atmosphere, grounded survival performance',
        negativePrompt: 'clean luxury interior, cheerful romance, cartoon, ugly, low quality'
    },
    {
        key: 'fairytale-book',
        label: '童话绘本',
        hint: '温柔、奇遇、儿童向',
        previewPrompt: 'fairytale picture book key visual, gentle protagonist in magical forest, warm lantern light, soft illustrated texture, charming storybook composition, no text, no logo',
        imagePromptPrefix: `fairytale picture book style, magical forest, warm lantern light, soft illustrated texture, charming storybook composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated fairytale picture book video, soft illustrated texture, warm magical lighting, gentle whimsical motion, storybook drama look',
        negativePrompt: 'horror, gritty realism, neon cyberpunk, ugly, low quality'
    },
    {
        key: 'thick-painting',
        label: '厚涂概念艺术',
        hint: '游戏概念、强质感、史诗感',
        previewPrompt: 'thick digital painting concept art key visual, attractive fantasy drama protagonist, bold brush strokes, dramatic rim light, epic atmosphere, no text, no logo',
        imagePromptPrefix: `thick digital painting concept art style, bold brush strokes, dramatic rim light, epic atmosphere, detailed costume and environment, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated thick digital painting video, visible painterly brush strokes, dramatic rim light, epic fantasy drama atmosphere, non-photorealistic motion',
        negativePrompt: 'flat vector, photorealistic real person, low detail, ugly, low quality'
    },
    {
        key: 'webtoon',
        label: '韩漫条漫风',
        hint: '现代恋爱、竖屏漫画',
        previewPrompt: 'vertical webtoon romance key visual, attractive modern protagonist, clean digital line art, glossy color, dramatic close-up and city background, no text, no logo',
        imagePromptPrefix: `vertical webtoon romance style, clean digital line art, glossy color, modern city background, dramatic emotional close-up, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated vertical webtoon video, clean digital line art, glossy colors, modern romance drama mood, stylized drawn characters only',
        negativePrompt: 'photorealistic, messy lines, dull colors, ugly, low quality'
    },
    {
        key: 'toon-shaded-3d',
        label: '卡通渲染 3D',
        hint: '3D 建模配手绘描边',
        previewPrompt:
            'toon shaded 3D animation key visual, attractive fictional adult drama hero with clean cel outlines, polished 3D face, bright cinematic lighting, crisp vertical poster composition, no text, no logo',
        imagePromptPrefix: `toon shaded 3d animation style, cel outlines over polished 3d models, clean stylized faces, crisp cinematic lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'toon shaded 3D animation video, cel outline render, polished 3D motion, stylized animated characters only, NOT live action',
        negativePrompt: 'photorealistic real person, muddy render, blurry face, low quality, ugly'
    },
    {
        key: 'fantasy-3d',
        label: '奇幻 3D 电影',
        hint: '魔法世界、电影级 3D',
        previewPrompt:
            'fantasy 3D animated film key visual, attractive adult protagonist in magical academy courtyard, luminous particles, detailed costume, premium cinematic 3D render, sharp face detail, no text, no logo',
        imagePromptPrefix: `fantasy 3d animated film style, magical environment, luminous particles, detailed costume, premium cinematic 3d render, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'fantasy 3D animated film video, magical particles, polished character animation, cinematic 3D lighting, NOT live action',
        negativePrompt: 'cheap render, flat lighting, live action, low quality, ugly'
    },
    {
        key: 'isometric-3d',
        label: '等距 3D 场景',
        hint: '精致模型、空间感强',
        previewPrompt:
            'isometric stylized 3D short drama key visual, attractive adult character in detailed miniature city set, clean geometry, premium lighting, crisp high-detail render, no text, no logo',
        imagePromptPrefix: `isometric stylized 3d scene style, miniature city set, clean geometry, detailed props, premium soft lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'isometric stylized 3D video, detailed miniature set, clean camera motion, polished animated characters, NOT live action',
        negativePrompt: 'messy geometry, low-poly cheap look, blurry, low quality, ugly'
    },
    {
        key: 'anime-film',
        label: '动画电影感',
        hint: '光影细腻、剧场版质感',
        previewPrompt:
            'anime feature film key visual, attractive adult protagonist on a dramatic rooftop at sunset, refined background painting, cinematic light rays, crisp eyes, polished vertical poster, no text, no logo',
        imagePromptPrefix: `anime feature film style, refined background painting, cinematic light rays, clean linework, detailed expressive eyes, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'anime feature film video, refined painted backgrounds, cinematic light, clean 2D animation, NOT live action, NOT real people',
        negativePrompt: 'photorealistic, rough sketch, blurry eyes, low quality, ugly'
    },
    {
        key: 'retro-anime',
        label: '复古赛璐璐',
        hint: '90 年代动画、胶片颗粒',
        previewPrompt: 'retro cel anime key visual, attractive adult protagonist under neon and moonlight, 1990s hand-painted animation look, subtle film grain, crisp ink lines, no text, no logo',
        imagePromptPrefix: `retro cel anime style, 1990s hand-painted animation look, subtle film grain, crisp ink lines, expressive faces, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'retro cel anime video, 1990s animation look, hand-painted backgrounds, subtle film grain, stylized drawn characters only',
        negativePrompt: 'photorealistic, modern glossy 3d, blurry linework, low quality, ugly'
    },
    {
        key: 'plush-toy',
        label: '毛绒玩偶',
        hint: '软萌材质、治愈喜剧',
        previewPrompt:
            'plush toy animation style key visual, cute soft fabric adult drama mascots in a cozy miniature room, tactile fibers, warm studio lighting, crisp product-like detail, no text, no logo',
        imagePromptPrefix: `plush toy animation style, soft fabric characters, tactile fibers, cozy miniature room, warm studio lighting, charming expressive faces`,
        videoPromptPrefix: 'plush toy animated video, soft fabric texture, cozy miniature sets, gentle stop-motion-like movement, NOT live action',
        negativePrompt: 'real person, hard plastic, dirty fabric, scary, low quality'
    },
    {
        key: 'miniature-diorama',
        label: '微缩布景',
        hint: '手作模型、轻定格感',
        previewPrompt:
            'miniature diorama animation key visual, charming stylized adult character in handcrafted tiny drama set, practical lights, macro lens clarity, crisp textures, no text, no logo',
        imagePromptPrefix: `miniature diorama animation style, handcrafted tiny set, practical lights, macro lens clarity, crisp tactile textures, charming stylized characters`,
        videoPromptPrefix: 'miniature diorama animated video, handcrafted tiny sets, practical lighting, gentle stop-motion motion, NOT photorealistic live action',
        negativePrompt: 'full-size real room, messy craft, blurry macro, low quality'
    },
    {
        key: 'editorial-illustration',
        label: '杂志插画',
        hint: '高级平面、色块构成',
        previewPrompt:
            'editorial illustration short drama key visual, attractive adult protagonist in bold graphic composition, elegant color blocking, refined texture, sharp poster-quality linework, no text, no logo',
        imagePromptPrefix: `editorial illustration style, bold graphic composition, elegant color blocking, refined paper texture, sharp poster-quality linework, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated editorial illustration video, bold color blocks, refined paper texture, elegant graphic motion, non-photorealistic characters',
        negativePrompt: 'photorealistic, cluttered layout, blurry edges, low quality, ugly'
    },
    {
        key: 'pastel-pencil',
        label: '彩铅粉彩',
        hint: '柔和手绘、纸面纹理',
        previewPrompt:
            'pastel pencil illustration key visual, attractive adult protagonist in a quiet emotional scene, visible paper grain, delicate hand-drawn strokes, crisp facial detail, no text, no logo',
        imagePromptPrefix: `pastel pencil illustration style, visible paper grain, delicate hand-drawn strokes, soft color blending, crisp facial detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated pastel pencil illustration video, visible paper grain, delicate hand-drawn strokes, gentle painterly motion, NOT live action',
        negativePrompt: 'photorealistic, harsh vector edges, muddy color, blurry face, low quality'
    },
    {
        key: 'luxury-romance',
        label: '豪门恋爱',
        hint: '高奢场景、强情绪',
        previewPrompt:
            'luxury urban romance short drama key visual, attractive adult couple in a high-end penthouse with rainy skyline, emotional tension, glossy fashion, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `luxury urban romance drama style, high-end penthouse, rainy skyline, glossy fashion, emotional tension, sharp commercial cinematography, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'luxury urban romance video, high-end interiors, rainy skyline, glossy fashion, emotional live-action drama look',
        negativePrompt: 'cheap room, fantasy costume, cartoon, blurry, low quality, ugly'
    },
    {
        key: 'soft-idol-drama',
        label: '偶像剧柔光',
        hint: '暖色柔光、甜虐氛围',
        previewPrompt: 'soft idol drama key visual, attractive adult lead in warm evening light, romantic city cafe, gentle bokeh, polished wardrobe, crisp premium poster detail, no text, no logo',
        imagePromptPrefix: `soft idol drama style, warm evening light, romantic cafe or city street, gentle bokeh, polished wardrobe, premium clean cinematography, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'soft idol drama video, warm romantic lighting, gentle bokeh, polished wardrobe, clean live-action short drama look',
        negativePrompt: 'horror, gritty crime, fantasy costume, blurry, low quality, ugly'
    },
    {
        key: 'docu-realism',
        label: '纪实写实',
        hint: '自然光、生活质感',
        previewPrompt:
            'documentary realism short drama key visual, attractive adult lead in authentic everyday interior, natural window light, grounded wardrobe, sharp realistic texture, no text, no logo',
        imagePromptPrefix: `documentary realism drama style, authentic everyday interior, natural window light, grounded wardrobe, sharp realistic textures, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'documentary realism video, natural light, authentic interiors, grounded live-action performance, premium but realistic texture',
        negativePrompt: 'overly glossy fashion, fantasy, anime, blurry, low quality, ugly'
    },
    {
        key: 'suspense-noir',
        label: '悬疑冷峻',
        hint: '冷色阴影、调查感',
        previewPrompt:
            'suspense noir short drama key visual, attractive adult detective in dim apartment corridor, cold shadows, practical light, tense realistic atmosphere, sharp film still detail, no text, no logo',
        imagePromptPrefix: `suspense noir realistic drama style, cold shadows, practical light, tense apartment corridor or street, sharp film still detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'suspense noir live-action video, cold shadows, practical light, tense realistic atmosphere, controlled handheld drama look',
        negativePrompt: 'bright comedy, fantasy costume, cartoon, blurry, low quality, ugly'
    },
    {
        key: 'palace-drama',
        label: '宫廷古装',
        hint: '宫墙、华服、权谋',
        previewPrompt:
            'ancient Chinese palace drama key visual, attractive adult noble character in ornate hanfu inside imperial corridor, lantern light, rich embroidery, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `ancient Chinese palace drama style, ornate hanfu, imperial corridor, lantern light, rich embroidery, refined period cinematography, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'ancient Chinese palace drama video, ornate hanfu, imperial corridors, lantern light, refined period live-action look',
        negativePrompt: 'modern clothes, sci-fi, cheap costume, blurry, low quality, ugly'
    },
    {
        key: 'mythic-fantasy',
        label: '东方神话',
        hint: '神兽、云海、史诗感',
        previewPrompt:
            'oriental mythic fantasy drama key visual, attractive adult immortal figure above cloud sea, divine light, ancient artifacts, epic Chinese myth atmosphere, sharp detail, no text, no logo',
        imagePromptPrefix: `oriental mythic fantasy style, cloud sea, divine light, ancient artifacts, epic Chinese myth atmosphere, detailed fantasy costume, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'oriental mythic fantasy video, cloud sea, divine light, ancient artifacts, epic stylized fantasy motion',
        negativePrompt: 'modern city, sci-fi neon, dull flat light, blurry, low quality, ugly'
    },
    {
        key: 'dunhuang-fantasy',
        label: '敦煌幻彩',
        hint: '壁画色、飞天、流光',
        previewPrompt:
            'Dunhuang inspired Chinese fantasy key visual, attractive adult protagonist with flowing silk ribbons, mural colors, desert temple light, luminous dust, sharp ornate detail, no text, no logo',
        imagePromptPrefix: `Dunhuang inspired Chinese fantasy style, mural colors, flowing silk ribbons, desert temple light, luminous dust, ornate costume detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'Dunhuang inspired fantasy video, mural colors, flowing silk ribbons, desert temple light, luminous dust, stylized ancient motion',
        negativePrompt: 'modern clothes, western medieval armor, muddy colors, blurry, low quality, ugly'
    },
    {
        key: 'space-opera',
        label: '太空歌剧',
        hint: '星舰、宏大科幻',
        previewPrompt: 'space opera short drama key visual, attractive adult commander on starship bridge, vast nebula outside window, cinematic rim light, sharp futuristic detail, no text, no logo',
        imagePromptPrefix: `space opera drama style, starship bridge, vast nebula, cinematic rim light, sleek futuristic costume, sharp sci-fi detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'space opera video, starship bridge, vast nebula, cinematic futuristic lighting, premium sci-fi drama look',
        negativePrompt: 'ancient costume, fantasy village, dull lighting, blurry, low quality, ugly'
    },
    {
        key: 'steampunk',
        label: '蒸汽朋克',
        hint: '黄铜机械、复古奇幻',
        previewPrompt:
            'steampunk fantasy short drama key visual, attractive adult inventor in brass machine room, gears, warm smoke, Victorian-Chinese fusion costume, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `steampunk fantasy drama style, brass machine room, gears, warm smoke, retro-futuristic costume, sharp cinematic detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'steampunk fantasy video, brass machinery, warm smoke, retro-futuristic costume, cinematic adventure motion',
        negativePrompt: 'clean modern office, cyberpunk neon only, blurry, low quality, ugly'
    },
    {
        key: 'monster-fantasy',
        label: '异兽奇幻',
        hint: '奇异生物、冒险感',
        previewPrompt:
            'monster fantasy adventure key visual, attractive adult protagonist facing a majestic magical creature in ancient ruins, dramatic scale, glowing mist, sharp epic detail, no text, no logo',
        imagePromptPrefix: `monster fantasy adventure style, majestic magical creature, ancient ruins, dramatic scale, glowing mist, sharp epic detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'monster fantasy adventure video, magical creature, ancient ruins, dramatic scale, glowing mist, stylized fantasy motion',
        negativePrompt: 'cute mascot only, modern city office, flat light, blurry, low quality, ugly'
    },
    {
        key: 'game-cg-3d',
        label: '游戏 CG',
        hint: '高燃预告、角色立绘',
        previewPrompt:
            'premium game cinematic CG key visual, attractive adult protagonist in dramatic hero pose, detailed armor-cloth hybrid costume, volumetric rim light, epic vertical splash art, ultra crisp render, no text, no logo',
        imagePromptPrefix: `premium game cinematic CG style, dramatic hero pose, detailed costume and props, volumetric rim light, epic vertical splash art, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'premium game cinematic CG video, dramatic hero pose, volumetric rim light, polished 3D action trailer look, NOT live action',
        negativePrompt: 'flat lighting, cheap mobile render, blurry, low quality, ugly'
    },
    {
        key: 'hyperreal-3d',
        label: '超写实 3D',
        hint: '拟真皮肤、广告级渲染',
        previewPrompt:
            'hyperrealistic 3D character render key visual, attractive adult drama lead with detailed skin shader, realistic fabric, cinematic studio lighting, premium advertising render, sharp vertical poster, no text, no logo',
        imagePromptPrefix: `hyperrealistic 3d render style, detailed skin shader, realistic fabric, cinematic studio lighting, premium advertising render, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'hyperrealistic 3D rendered video, realistic fabric and skin shader, cinematic studio lighting, polished animated character motion',
        negativePrompt: 'live-action photo, uncanny face, waxy skin, blurry, low quality'
    },
    {
        key: 'low-poly-art',
        label: '低多边形',
        hint: '几何切面、设计感强',
        previewPrompt:
            'low poly stylized 3D key visual, attractive adult protagonist in geometric faceted world, clean angular shapes, bold color planes, dramatic lighting, crisp premium poster, no text, no logo',
        imagePromptPrefix: `low poly stylized 3d art style, geometric faceted world, clean angular shapes, bold color planes, dramatic lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'low poly stylized 3D video, geometric faceted environment, clean angular shapes, bold color planes, animated characters only',
        negativePrompt: 'messy mesh, photorealistic, soft blurry render, low quality, ugly'
    },
    {
        key: 'voxel-3d',
        label: '体素方块',
        hint: '像素立方、轻冒险',
        previewPrompt:
            'voxel 3D animation key visual, attractive adult adventurer in blocky cinematic city scene, tiny cube details, glowing windows, playful but premium lighting, sharp vertical poster, no text, no logo',
        imagePromptPrefix: `voxel 3d animation style, blocky cinematic city scene, tiny cube details, glowing windows, playful premium lighting, attractive stylized character`,
        videoPromptPrefix: 'voxel 3D animation video, blocky city scene, tiny cube details, playful premium lighting, stylized animated characters only',
        negativePrompt: 'flat pixel art only, muddy blocks, blurry render, low quality'
    },
    {
        key: 'ceramic-3d',
        label: '瓷釉 3D',
        hint: '白瓷光泽、东方质感',
        previewPrompt:
            'glazed ceramic 3D animation key visual, attractive adult protagonist with porcelain-like stylized material, jade accents, elegant studio light, refined Chinese craft texture, sharp vertical poster, no text, no logo',
        imagePromptPrefix: `glazed ceramic 3d animation style, porcelain-like stylized material, jade accents, elegant studio light, refined craft texture, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'glazed ceramic 3D animation video, porcelain material, jade accents, elegant studio light, polished stylized character motion',
        negativePrompt: 'cheap plastic, cracked broken face, dull lighting, blurry, low quality'
    },
    {
        key: 'holographic-3d',
        label: '全息 3D',
        hint: '透明光效、舞台科技',
        previewPrompt:
            'holographic 3D animation key visual, attractive adult performer in translucent light costume, floating UI-like geometric light without readable text, futuristic stage, crisp luminous render, no text, no logo',
        imagePromptPrefix: `holographic 3d animation style, translucent light costume, floating geometric light, futuristic stage, crisp luminous render, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'holographic 3D animation video, translucent light costume, futuristic stage, crisp luminous motion, stylized animated character',
        negativePrompt: 'readable UI text, dull gray lighting, messy glow, blurry, low quality'
    },
    {
        key: 'lyrical-sky-anime',
        label: '天空物语',
        hint: '云海、逆光、青春感',
        previewPrompt:
            'lyrical sky anime key visual, attractive adult protagonist on a train platform under vast glowing clouds, delicate linework, cinematic backlight, emotional atmosphere, crisp vertical poster, no text, no logo',
        imagePromptPrefix: `lyrical sky anime style, vast glowing clouds, cinematic backlight, delicate linework, emotional atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'lyrical sky anime video, vast glowing clouds, cinematic backlight, delicate linework, gentle emotional motion, NOT live action',
        negativePrompt: 'photorealistic, dark horror, muddy sky, blurry, low quality'
    },
    {
        key: 'noir-anime',
        label: '黑色动漫',
        hint: '雨夜阴影、悬疑感',
        previewPrompt:
            'noir anime thriller key visual, attractive adult protagonist under rainy street lamp, sharp ink shadows, limited color accents, cinematic suspense framing, crisp vertical poster, no text, no logo',
        imagePromptPrefix: `noir anime thriller style, rainy street lamp, sharp ink shadows, limited color accents, cinematic suspense framing, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'noir anime thriller video, rainy street lamp, sharp ink shadows, limited color accents, suspenseful drawn character motion',
        negativePrompt: 'photorealistic, bright comedy palette, soft blurry lines, low quality, ugly'
    },
    {
        key: 'mecha-anime',
        label: '机甲番剧',
        hint: '机械装甲、科幻战斗',
        previewPrompt:
            'mecha anime key visual, attractive adult pilot in sleek cockpit with giant armor silhouette behind, hard-surface mechanical detail, neon rim light, dynamic cel shading, no text, no logo',
        imagePromptPrefix: `mecha anime style, sleek cockpit, giant armor silhouette, hard-surface mechanical detail, neon rim light, dynamic cel shading, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'mecha anime video, sleek cockpit, hard-surface mechanical detail, neon rim light, dynamic cel-shaded action',
        negativePrompt: 'photorealistic live action, rusty clutter, blurry machinery, low quality'
    },
    {
        key: 'fantasy-anime',
        label: '奇幻番剧',
        hint: '魔法学院、冒险队伍',
        previewPrompt:
            'fantasy anime series key visual, attractive adult mage protagonist in luminous academy courtyard, spell circles without text, detailed fantasy costume, vibrant cel shading, no text, no logo',
        imagePromptPrefix: `fantasy anime series style, luminous academy courtyard, spell circles without text, detailed fantasy costume, vibrant cel shading, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'fantasy anime video, luminous academy courtyard, magical light effects, detailed fantasy costume, stylized drawn characters only',
        negativePrompt: 'photorealistic, modern office, muddy magic effects, blurry, low quality'
    },
    {
        key: 'sports-anime',
        label: '竞技热血',
        hint: '速度线、赛场高光',
        previewPrompt:
            'sports anime key visual, attractive adult athlete protagonist in dramatic arena light, speed lines, intense expression, crisp cel shading, high-energy vertical poster, no text, no logo',
        imagePromptPrefix: `sports anime style, dramatic arena light, speed lines, intense expression, crisp cel shading, high-energy composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'sports anime video, dramatic arena light, speed lines, high-energy motion, crisp cel-shaded characters',
        negativePrompt: 'static pose, photorealistic, empty background, blurry, low quality'
    },
    {
        key: 'magical-heroine-anime',
        label: '魔法女主',
        hint: '华丽变身、闪耀光效',
        previewPrompt:
            'magical heroine anime key visual, attractive adult heroine in elegant luminous costume, sparkling transformation light, ornate staff, dramatic vertical composition, crisp line art, no text, no logo',
        imagePromptPrefix: `magical heroine anime style, elegant luminous costume, sparkling transformation light, ornate staff, dramatic vertical composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'magical heroine anime video, sparkling transformation light, elegant costume motion, crisp line art, stylized drawn characters only',
        negativePrompt: 'childlike body, photorealistic, messy glitter, blurry, low quality'
    },
    {
        key: 'felt-craft',
        label: '羊毛毡',
        hint: '软糯手作、治愈触感',
        previewPrompt:
            'felt craft animation key visual, cute stylized adult drama character made of soft wool felt, cozy handmade set, visible fibers, warm tabletop lighting, sharp tactile texture, blank fabric surfaces, no Chinese characters, no labels, no captions, no title, no text, no logo',
        imagePromptPrefix: `felt craft animation style, soft wool felt character, cozy handmade set, visible fibers, warm tabletop lighting, tactile texture, blank fabric surfaces without labels`,
        videoPromptPrefix: 'felt craft animated video, soft wool felt texture, cozy handmade set, gentle stop-motion motion',
        negativePrompt: 'real person, hard plastic, dirty fibers, blurry, low quality'
    },
    {
        key: 'sticker-art',
        label: '贴纸潮玩',
        hint: '厚边贴纸、社媒感',
        previewPrompt:
            'cute sticker art key visual, charming adult drama mascot with thick white outline, glossy sticker finish, colorful props, bold simple shapes, crisp social poster, no text, no logo',
        imagePromptPrefix: `cute sticker art style, thick white outline, glossy sticker finish, colorful props, bold simple shapes, charming adult mascot character`,
        videoPromptPrefix: 'cute sticker art video, thick white outlines, glossy sticker finish, pop social motion, stylized mascot character',
        negativePrompt: 'photorealistic, thin messy lines, readable text, blurry, low quality'
    },
    {
        key: 'toy-brick',
        label: '积木玩具',
        hint: '拼搭世界、喜剧冒险',
        previewPrompt:
            'toy brick animation key visual, charming adult stylized character built from colorful bricks in miniature city set, clean plastic highlights, playful cinematic lighting, pure image only, no Chinese characters, no bottom caption, no labels, no signs, no text, no logo',
        imagePromptPrefix: `toy brick animation style, colorful brick-built character, miniature city set, clean plastic highlights, playful cinematic lighting, pure image without captions or labels`,
        videoPromptPrefix: 'toy brick animated video, colorful brick-built world, playful cinematic lighting, stylized toy character motion',
        negativePrompt: 'brand logo, readable text, broken bricks, blurry, low quality'
    },
    {
        key: 'kawaii-3d',
        label: '萌系 3D',
        hint: '圆润软糖、轻喜剧',
        previewPrompt:
            'kawaii 3D animation key visual, cute rounded adult drama character in pastel city cafe, soft candy-like materials, glossy eyes, clean cheerful lighting, sharp vertical poster, no text, no logo',
        imagePromptPrefix: `kawaii 3d animation style, rounded adult drama character, pastel city cafe, soft candy-like materials, clean cheerful lighting`,
        videoPromptPrefix: 'kawaii 3D animation video, rounded character design, pastel city cafe, soft candy-like materials, cheerful stylized motion',
        negativePrompt: 'real child, scary face, dull lighting, blurry, low quality'
    },
    {
        key: 'pop-up-book',
        label: '立体书',
        hint: '翻页机关、童话舞台',
        previewPrompt:
            'pop-up book illustration key visual, charming adult protagonist in folded paper stage, layered paper mechanisms, soft shadows, magical storybook lighting, crisp vertical poster, blank page margins, no Chinese characters, no title, no captions, no labels, no text, no logo',
        imagePromptPrefix: `pop-up book illustration style, folded paper stage, layered paper mechanisms, soft shadows, magical storybook lighting, blank page margins without labels, charming stylized character`,
        videoPromptPrefix: 'pop-up book animated video, folded paper stage, layered mechanisms, soft shadows, magical storybook motion',
        negativePrompt: 'flat poster only, messy paper, readable text, blurry, low quality'
    },
    {
        key: 'paper-theater',
        label: '纸剧场',
        hint: '舞台剪影、层叠景片',
        previewPrompt: 'paper theater animation key visual, charming adult character on layered cut-paper stage, theatrical side lights, crisp silhouettes, handcrafted shadows, no text, no logo',
        imagePromptPrefix: `paper theater animation style, layered cut-paper stage, theatrical side lights, crisp silhouettes, handcrafted shadows, charming stylized character`,
        videoPromptPrefix: 'paper theater animated video, layered cut-paper stage, theatrical side lights, crisp silhouette motion',
        negativePrompt: 'photorealistic, messy collage, unreadable clutter, blurry, low quality'
    },
    {
        key: 'linocut-print',
        label: '版画雕刻',
        hint: '粗犷刻线、复古张力',
        previewPrompt:
            'linocut print illustration key visual, attractive adult protagonist in dramatic carved line composition, rough ink texture, limited color palette, bold poster contrast, no text, no logo',
        imagePromptPrefix: `linocut print illustration style, carved line composition, rough ink texture, limited color palette, bold poster contrast, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated linocut print video, carved line texture, limited color palette, bold poster contrast, stylized non-photorealistic motion',
        negativePrompt: 'photorealistic, smooth airbrush, blurry carved lines, low quality'
    },
    {
        key: 'risograph',
        label: '孔版印刷',
        hint: '套色颗粒、潮流海报',
        previewPrompt:
            'risograph illustration key visual, attractive adult protagonist in bold layered color composition, visible print grain, slight color misregistration, stylish indie poster, no text, no logo',
        imagePromptPrefix: `risograph illustration style, layered spot colors, visible print grain, slight color misregistration, stylish indie poster, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated risograph illustration video, layered spot colors, print grain, subtle color offset, graphic poster motion',
        negativePrompt: 'photorealistic, glossy 3d, muddy colors, blurry, low quality'
    },
    {
        key: 'art-nouveau',
        label: '新艺术插画',
        hint: '花纹边框、优雅曲线',
        previewPrompt:
            'art nouveau illustration key visual, attractive adult protagonist framed by elegant botanical curves and ornamental lines, jewel-tone palette, refined poster composition, no text, no logo',
        imagePromptPrefix: `art nouveau illustration style, elegant botanical curves, ornamental lines, jewel-tone palette, refined poster composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated art nouveau illustration video, ornamental curves, jewel tones, elegant poster-like motion, non-photorealistic characters',
        negativePrompt: 'photorealistic, flat modern UI, messy ornament, blurry, low quality'
    },
    {
        key: 'charcoal-sketch',
        label: '炭笔素描',
        hint: '黑白颗粒、情绪肖像',
        previewPrompt:
            'charcoal sketch drama key visual, attractive adult protagonist in emotional close-up, expressive black and white strokes, paper dust texture, strong chiaroscuro, no text, no logo',
        imagePromptPrefix: `charcoal sketch style, expressive black and white strokes, paper dust texture, strong chiaroscuro, emotional portrait, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated charcoal sketch video, expressive black and white strokes, paper dust texture, strong chiaroscuro, hand-drawn motion',
        negativePrompt: 'colorful glossy render, photorealistic photo, blurry face, low quality'
    },
    {
        key: 'stained-glass',
        label: '彩窗插画',
        hint: '玻璃分割、神圣光感',
        previewPrompt:
            'stained glass illustration key visual, attractive adult protagonist made of luminous glass panels, lead outlines, radiant backlight, dramatic cathedral-like color, no text, no logo',
        imagePromptPrefix: `stained glass illustration style, luminous glass panels, lead outlines, radiant backlight, dramatic jewel colors, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated stained glass video, luminous glass panels, lead outlines, radiant backlight, stylized light motion',
        negativePrompt: 'photorealistic, dull gray glass, broken face, blurry, low quality'
    },
    {
        key: 'ukiyo-e-print',
        label: '浮世绘版画',
        hint: '平涂浪纹、古典装饰',
        previewPrompt:
            'ukiyo-e inspired print key visual, attractive adult protagonist in dramatic flat-color composition, wave patterns, carved ink lines, refined historic poster mood, no text, no logo',
        imagePromptPrefix: `ukiyo-e inspired print style, flat-color composition, wave patterns, carved ink lines, refined historic poster mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'animated ukiyo-e inspired print video, flat colors, wave patterns, carved ink lines, stylized print motion',
        negativePrompt: 'photorealistic, modern neon city, blurry linework, low quality'
    },
    {
        key: 'campus-romance',
        label: '校园恋爱',
        hint: '大学青春、清爽悸动',
        previewPrompt:
            'college campus romance short drama key visual, attractive adult students under golden tree-lined walkway, clean youthful wardrobe, soft sunlight, gentle emotional tension, sharp poster detail, no text, no logo',
        imagePromptPrefix: `college campus romance drama style, adult students, tree-lined walkway, soft sunlight, clean youthful wardrobe, gentle emotional tension, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'college campus romance video, adult students, soft sunlight, clean youthful wardrobe, gentle emotional live-action drama look',
        negativePrompt: 'school-age child, fantasy costume, dark crime tone, blurry, low quality'
    },
    {
        key: 'office-romance',
        label: '职场恋爱',
        hint: '办公室暧昧、精英感',
        previewPrompt:
            'office romance short drama key visual, attractive adult leads in glass high-rise office at dusk, polished business wardrobe, restrained emotional tension, premium commercial lighting, no text, no logo',
        imagePromptPrefix: `office romance drama style, glass high-rise office, polished business wardrobe, restrained emotional tension, premium commercial lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'office romance video, glass high-rise office, polished business wardrobe, restrained emotional tension, premium live-action look',
        negativePrompt: 'fantasy costume, messy office clutter, flat lighting, blurry, low quality'
    },
    {
        key: 'rainy-neon-romance',
        label: '雨夜霓虹恋',
        hint: '湿街反光、暧昧拉扯',
        previewPrompt:
            'rainy neon romance key visual, attractive adult couple under umbrella on wet city street, magenta and teal reflections, emotional eye contact, cinematic shallow depth, no text, no logo',
        imagePromptPrefix: `rainy neon romance style, umbrella on wet city street, magenta and teal reflections, emotional eye contact, cinematic shallow depth, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'rainy neon romance video, wet city street reflections, umbrella, magenta teal lighting, emotional live-action drama look',
        negativePrompt: 'daylight comedy, fantasy costume, cartoon, blurry, low quality'
    },
    {
        key: 'vintage-romance',
        label: '复古恋歌',
        hint: '胶片暖调、旧日约会',
        previewPrompt:
            'vintage romance drama key visual, attractive adult lead in old cinema lobby with warm film tone, elegant coat, soft tungsten light, nostalgic emotional atmosphere, no text, no logo',
        imagePromptPrefix: `vintage romance drama style, old cinema lobby, warm film tone, elegant coat, soft tungsten light, nostalgic emotional atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'vintage romance video, warm film tone, old cinema or cafe, soft tungsten light, nostalgic live-action drama look',
        negativePrompt: 'futuristic neon, fantasy costume, harsh digital look, blurry, low quality'
    },
    {
        key: 'summer-romance',
        label: '夏日清甜',
        hint: '海边日光、轻松治愈',
        previewPrompt:
            'summer romance short drama key visual, attractive adult lead near bright seaside street, white shirt, blue sky, sparkling sunlight, fresh relaxed emotional mood, sharp poster detail, no text, no logo',
        imagePromptPrefix: `summer romance drama style, bright seaside street, white shirt, blue sky, sparkling sunlight, fresh relaxed emotional mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'summer romance video, seaside street, sparkling sunlight, fresh relaxed emotional mood, clean live-action look',
        negativePrompt: 'dark thriller, heavy fantasy costume, dull gray sky, blurry, low quality'
    },
    {
        key: 'healing-romance',
        label: '治愈生活',
        hint: '日常烟火、温柔陪伴',
        previewPrompt:
            'healing slice-of-life romance key visual, attractive adult lead in cozy kitchen at morning light, warm steam, natural textures, gentle smile, intimate drama composition, no text, no logo',
        imagePromptPrefix: `healing slice-of-life romance style, cozy kitchen, morning light, warm steam, natural textures, gentle intimate mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'healing slice-of-life romance video, cozy kitchen, morning light, warm steam, gentle intimate live-action mood',
        negativePrompt: 'horror, luxury melodrama, fantasy costume, blurry, low quality'
    },
    {
        key: 'action-thriller',
        label: '动作惊悚',
        hint: '追车枪火、冷硬电影感',
        previewPrompt:
            'action thriller short drama key visual, attractive adult lead sprinting through rain-lit alley, controlled motion blur in background only, sharp face, tense cinematic lighting, no text, no logo',
        imagePromptPrefix: `action thriller realistic style, rain-lit alley, urgent chase energy, sharp face, tense cinematic lighting, grounded wardrobe, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'action thriller live-action video, rain-lit alley, urgent chase energy, tense cinematic lighting, grounded controlled camera',
        negativePrompt: 'cartoon, fantasy costume, excessive gore, blurry face, low quality'
    },
    {
        key: 'legal-drama',
        label: '律政精英',
        hint: '法庭、理性、对峙',
        previewPrompt:
            'legal drama key visual, attractive adult lawyer in modern courtroom corridor, tailored suit, cool daylight, tense intellectual confrontation mood, sharp film still detail, no text, no logo',
        imagePromptPrefix: `legal drama realistic style, modern courtroom corridor, tailored suit, cool daylight, tense intellectual confrontation mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'legal drama live-action video, modern courtroom corridor, tailored suit, cool daylight, tense restrained performance',
        negativePrompt: 'fantasy costume, comedy lighting, messy courtroom text, blurry, low quality'
    },
    {
        key: 'medical-drama',
        label: '医疗剧',
        hint: '医院走廊、专业紧张',
        previewPrompt:
            'medical drama key visual, attractive adult doctor in clean hospital corridor, white coat, soft clinical light, urgent but hopeful expression, sharp realistic detail, no text, no logo',
        imagePromptPrefix: `medical drama realistic style, clean hospital corridor, white coat, soft clinical light, urgent hopeful expression, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'medical drama live-action video, clean hospital corridor, soft clinical light, urgent hopeful performance, realistic drama look',
        negativePrompt: 'graphic surgery, blood, fantasy costume, blurry, low quality'
    },
    {
        key: 'family-ethics',
        label: '家庭伦理',
        hint: '客厅争执、生活张力',
        previewPrompt:
            'family ethics drama key visual, attractive adult lead in warm apartment living room, restrained conflict, everyday wardrobe, natural practical lights, sharp emotional realism, no text, no logo',
        imagePromptPrefix: `family ethics drama realistic style, warm apartment living room, restrained conflict, everyday wardrobe, natural practical lights, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'family ethics drama live-action video, warm apartment living room, restrained conflict, natural practical lights, realistic performance',
        negativePrompt: 'fantasy, cartoon, luxury over-gloss, blurry, low quality'
    },
    {
        key: 'business-war',
        label: '商战写实',
        hint: '会议室、权力博弈',
        previewPrompt:
            'business war drama key visual, attractive adult executive in high-rise boardroom at night, city lights, tailored suit, power struggle atmosphere, sharp cinematic realism, no text, no logo',
        imagePromptPrefix: `business war drama realistic style, high-rise boardroom at night, city lights, tailored suit, power struggle atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'business war live-action video, high-rise boardroom, city lights, tailored suit, tense power struggle performance',
        negativePrompt: 'fantasy costume, childish office, flat lighting, blurry, low quality'
    },
    {
        key: 'social-realism',
        label: '社会现实',
        hint: '街头纪实、强叙事',
        previewPrompt:
            'social realism short drama key visual, attractive adult lead on authentic urban street at dusk, natural wardrobe, layered background life, grounded emotional tension, sharp documentary texture, no text, no logo',
        imagePromptPrefix: `social realism drama style, authentic urban street, natural wardrobe, layered background life, grounded emotional tension, sharp documentary texture, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'social realism live-action video, authentic urban street, natural wardrobe, grounded emotional tension, documentary texture',
        negativePrompt: 'glossy fantasy, anime, fake studio backdrop, blurry, low quality'
    },
    {
        key: 'tang-dynasty',
        label: '盛唐华彩',
        hint: '金红宫灯、华服宴乐',
        previewPrompt:
            'Tang dynasty inspired costume drama key visual, attractive adult noble protagonist in rich red and gold hanfu, palace lanterns, lavish banquet glow, ornate period detail, no text, no logo',
        imagePromptPrefix: `Tang dynasty inspired costume drama style, rich red and gold hanfu, palace lanterns, lavish banquet glow, ornate period detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'Tang dynasty costume drama video, red and gold hanfu, palace lanterns, lavish banquet glow, refined period motion',
        negativePrompt: 'modern clothes, sci-fi, cheap costume, blurry, low quality'
    },
    {
        key: 'song-dynasty',
        label: '宋韵雅致',
        hint: '青绿山水、素雅文人',
        previewPrompt:
            'Song dynasty inspired elegant costume drama key visual, attractive adult scholar figure in pale hanfu, quiet garden pavilion, celadon and ink palette, refined restrained beauty, no text, no logo',
        imagePromptPrefix: `Song dynasty inspired costume drama style, pale hanfu, quiet garden pavilion, celadon and ink palette, refined restrained beauty, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'Song dynasty elegant costume drama video, pale hanfu, quiet pavilion, celadon ink palette, restrained refined period motion',
        negativePrompt: 'modern clothes, neon, over-saturated cheap costume, blurry, low quality'
    },
    {
        key: 'wuxia-realism',
        label: '写实武侠',
        hint: '实拍江湖、刀光剑影',
        previewPrompt:
            'realistic wuxia drama key visual, attractive adult swordsman in weathered robes on cliff path, practical costume texture, cold wind, grounded cinematic martial world, no text, no logo',
        imagePromptPrefix: `realistic wuxia drama style, weathered robes, cliff path, practical costume texture, cold wind, grounded cinematic martial world, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'realistic wuxia drama video, weathered robes, cliff path, cold wind, grounded martial arts cinematography',
        negativePrompt: 'modern clothes, cartoon, cheap plastic armor, blurry, low quality'
    },
    {
        key: 'ghost-romance',
        label: '志怪情缘',
        hint: '灯笼雾夜、古典诡美',
        previewPrompt:
            'ancient Chinese supernatural romance key visual, attractive adult protagonist under red lanterns in misty old street, poetic mystery, elegant hanfu, beautiful eerie light, no text, no logo',
        imagePromptPrefix: `ancient Chinese supernatural romance style, red lanterns, misty old street, poetic mystery, elegant hanfu, beautiful eerie light, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'ancient Chinese supernatural romance video, red lanterns, misty old street, poetic mystery, elegant hanfu, beautiful eerie motion',
        negativePrompt: 'modern clothes, graphic horror, ugly monster close-up, blurry, low quality'
    },
    {
        key: 'snow-jianghu',
        label: '雪夜江湖',
        hint: '白雪黑衣、孤冷侠气',
        previewPrompt:
            'snowy jianghu wuxia key visual, attractive adult swordsman in black cloak under falling snow, lonely inn lights, cold blue atmosphere, sharp elegant martial composition, no text, no logo',
        imagePromptPrefix: `snowy jianghu wuxia style, black cloak, falling snow, lonely inn lights, cold blue atmosphere, elegant martial composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'snowy jianghu wuxia video, black cloak, falling snow, lonely inn lights, cold blue atmosphere, elegant martial motion',
        negativePrompt: 'modern city, neon sci-fi, muddy snow, blurry, low quality'
    },
    {
        key: 'lotus-fantasy',
        label: '莲境仙梦',
        hint: '莲池流光、仙气柔美',
        previewPrompt:
            'lotus xianxia fantasy key visual, attractive adult immortal protagonist standing over glowing lotus pond, pale silk hanfu, moonlit mist, dreamy spiritual light, no text, no logo',
        imagePromptPrefix: `lotus xianxia fantasy style, glowing lotus pond, pale silk hanfu, moonlit mist, dreamy spiritual light, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'lotus xianxia fantasy video, glowing lotus pond, pale silk hanfu, moonlit mist, dreamy spiritual motion',
        negativePrompt: 'modern clothes, hard sci-fi, dull mud water, blurry, low quality'
    },
    {
        key: 'solarpunk',
        label: '太阳朋克',
        hint: '绿能未来、明亮乌托邦',
        previewPrompt:
            'solarpunk sci-fi drama key visual, attractive adult protagonist on green rooftop city with solar glass towers, warm sunlight, plants and technology, optimistic future detail, no text, no logo',
        imagePromptPrefix: `solarpunk sci-fi drama style, green rooftop city, solar glass towers, warm sunlight, plants and technology, optimistic future detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'solarpunk sci-fi video, green rooftop city, solar glass towers, warm sunlight, optimistic future motion',
        negativePrompt: 'dark cyberpunk only, polluted wasteland, fantasy hanfu, blurry, low quality'
    },
    {
        key: 'biopunk',
        label: '生物朋克',
        hint: '有机科技、荧光实验室',
        previewPrompt:
            'biopunk sci-fi drama key visual, attractive adult researcher in organic luminous laboratory, botanical technology, translucent materials, teal green light, sharp speculative detail, no text, no logo',
        imagePromptPrefix: `biopunk sci-fi style, organic luminous laboratory, botanical technology, translucent materials, teal green light, sharp speculative detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'biopunk sci-fi video, organic luminous laboratory, botanical technology, translucent materials, teal green cinematic motion',
        negativePrompt: 'body horror, gore, fantasy costume, muddy green blur, low quality'
    },
    {
        key: 'time-travel',
        label: '时空穿越',
        hint: '时间裂隙、双时代感',
        previewPrompt:
            'time travel drama key visual, attractive adult protagonist between modern city street and ancient corridor split by glowing time portal, cinematic contrast, sharp detail, no text, no logo',
        imagePromptPrefix: `time travel drama style, modern city and ancient corridor split by glowing time portal, cinematic contrast, sharp detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'time travel drama video, modern city and ancient corridor, glowing time portal, cinematic contrast, dynamic transition motion',
        negativePrompt: 'readable clock text, messy collage, flat lighting, blurry, low quality'
    },
    {
        key: 'underwater-fantasy',
        label: '海底奇幻',
        hint: '深海宫殿、蓝绿流光',
        previewPrompt:
            'underwater fantasy drama key visual, attractive adult protagonist in luminous submerged palace, flowing fabric, blue green caustic light, mysterious elegant atmosphere, no text, no logo',
        imagePromptPrefix: `underwater fantasy style, luminous submerged palace, flowing fabric, blue green caustic light, mysterious elegant atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'underwater fantasy video, luminous submerged palace, flowing fabric, blue green caustic light, graceful fantasy motion',
        negativePrompt: 'muddy water, scuba documentary, horror gore, blurry, low quality'
    },
    {
        key: 'dreamcore-fantasy',
        label: '梦核奇幻',
        hint: '超现实空间、迷离色彩',
        previewPrompt:
            'dreamcore fantasy drama key visual, attractive adult protagonist in surreal floating room with impossible stairs, soft pastel haze, uncanny beautiful light, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `dreamcore fantasy style, surreal floating room, impossible stairs, soft pastel haze, uncanny beautiful light, sharp cinematic detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'dreamcore fantasy video, surreal floating room, impossible stairs, soft pastel haze, graceful uncanny motion',
        negativePrompt: 'nightmare horror, unreadable text, messy blur, low quality, ugly'
    },
    {
        key: 'dieselpunk',
        label: '柴油朋克',
        hint: '旧工业、飞艇、硬派冒险',
        previewPrompt:
            'dieselpunk adventure drama key visual, attractive adult pilot in leather coat beside retro industrial airship hangar, smoky amber light, riveted machinery, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `dieselpunk adventure style, leather coat, retro industrial airship hangar, smoky amber light, riveted machinery, sharp cinematic detail, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'dieselpunk adventure video, retro industrial hangar, smoky amber light, riveted machinery, hard-edged cinematic motion',
        negativePrompt: 'clean futuristic glass, fantasy palace, flat lighting, blurry, low quality'
    },

    // ============ 欧美/北美地区 ============
    {
        key: 'vampire-gothic',
        label: '吸血鬼哥特',
        hint: '欧美吸血鬼、暗黑贵族、血族恋情',
        previewPrompt:
            'gothic vampire drama key visual, elegant pale vampire noble in Victorian mansion, crimson eyes, ornate black attire, moonlight and candlelight, sensual mysterious atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `gothic vampire drama style, elegant pale vampire nobles, Victorian mansion, crimson eyes, ornate black attire, moonlight and candlelight, sensual mysterious atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'gothic vampire drama live-action video, pale elegant vampires, Victorian gothic interiors, moonlight and crimson accents, sensual mysterious cinematography, premium dark romance look',
        negativePrompt: 'bright daylight, cartoon, ugly, low quality, deformed'
    },
    {
        key: 'werewolf-alpha',
        label: '狼人阿尔法',
        hint: '欧美狼人、族群、荷尔蒙感情线',
        
        previewPrompt:
            'werewolf romance drama key visual, muscular alpha male protagonist in misty forest, glowing amber eyes, torn shirt, moonlit night, primal romantic tension, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `werewolf romance drama style, muscular alpha male, misty forest, glowing amber eyes, moonlit night, primal romantic tension, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'werewolf romance live-action video, muscular alpha protagonist, misty forest, moonlight, primal romantic tension, premium supernatural drama look',
        negativePrompt: 'urban city, cartoon, weak physique, ugly, low quality'
    },
    {
        key: 'american-highschool',
        label: '美式青春校园',
        hint: '啦啦队、橄榄球、舞会、校园偶像',
        
        previewPrompt:
            'american high school drama key visual, attractive cheerleader and quarterback on football field, golden hour sunlight, letterman jacket, prom night vibes, no text, no logo',
        imagePromptPrefix: `american high school drama style, cheerleader outfits, letterman jackets, football field, golden hour sunlight, prom night aesthetic, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'american high school drama video, football field, cheerleader routines, golden sunset, prom night lighting, premium teen live-action drama look',
        negativePrompt: 'asian school uniform, fantasy, cartoon, ugly, low quality'
    },
    {
        key: 'hollywood-blockbuster',
        label: '好莱坞大片',
        hint: '爆炸、追车、英雄主义',
        
        previewPrompt:
            'Hollywood blockbuster action key visual, attractive muscular action hero mid-explosion, lens flare, epic scale destruction, cinematic wide anamorphic composition, sharp detail, no text, no logo',
        imagePromptPrefix: `Hollywood blockbuster action style, muscular action hero, epic explosions, lens flare, anamorphic cinematography, dramatic destruction, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'Hollywood blockbuster action video, epic explosions, lens flares, anamorphic composition, high-octane action performance, premium live-action look',
        negativePrompt: 'low budget, static, cartoon, ugly, low quality'
    },

    // ============ 非洲/黑人地区 ============
    {
        key: 'afrofuturism',
        label: '非洲未来主义',
        hint: '黑豹感、非洲未来科技、传统与科幻融合',
        
        previewPrompt:
            'afrofuturism drama key visual, regal Black protagonist in ornate futuristic African attire, tribal patterns fused with sci-fi tech, golden dust and neon accents, majestic composition, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `afrofuturism drama style, regal Black protagonists with beautiful dark skin, futuristic African attire, tribal patterns fused with sci-fi tech, golden accents, majestic composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'afrofuturism drama video, regal Black characters, futuristic African tech, tribal patterns, golden neon accents, majestic live-action cinematography, premium sci-fi drama look',
        negativePrompt: 'lightened skin, whitewashing, generic sci-fi, cartoon, ugly, low quality'
    },
    {
        key: 'nollywood-glam',
        label: '尼日利亚豪门',
        hint: '尼莱坞豪门、非洲豪华、家族戏剧',
        
        previewPrompt:
            'nollywood luxury drama key visual, elegant Black protagonist in vibrant African fashion inside opulent Lagos mansion, saturated warm colors, dramatic family tension, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `nollywood luxury drama style, elegant Black characters with beautiful dark skin, vibrant African print fashion, opulent Lagos or Accra mansions, saturated warm colors, dramatic family tension, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'nollywood luxury drama video, elegant Black characters, opulent mansions, vibrant African fashion, saturated colors, premium melodramatic live-action look',
        negativePrompt: 'lightened skin, generic western setting, cartoon, ugly, low quality'
    },
    {
        key: 'african-tribal-fantasy',
        label: '非洲部落奇幻',
        hint: '古老部落、传统仪式、灵性魔法',
        
        previewPrompt:
            'african tribal fantasy drama key visual, beautiful dark-skinned warrior in traditional tribal attire, savanna sunset, spiritual glow, ancient patterns, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `african tribal fantasy drama style, beautiful dark-skinned warriors, traditional tribal attire, savanna landscape, spiritual magical glow, ancient patterns, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'african tribal fantasy drama video, dark-skinned warriors, savanna landscape, tribal attire, spiritual magic effects, premium mythological live-action look',
        negativePrompt: 'lightened skin, european medieval, cartoon, ugly, low quality'
    },
    {
        key: 'hiphop-street',
        label: '嘻哈街头',
        hint: '嘻哈文化、街舞、涂鸦、都市黑人青年',
        
        previewPrompt:
            'hip hop street culture drama key visual, stylish Black youth in streetwear on neon-lit Brooklyn alley with graffiti walls, urban night vibe, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `hip hop street culture drama style, stylish Black youth with beautiful dark skin, streetwear fashion, graffiti walls, neon-lit urban alleys, energetic street vibe, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'hip hop street culture drama video, stylish Black characters, streetwear, graffiti, neon urban night, energetic live-action motion, premium urban drama look',
        negativePrompt: 'suburban clean, fantasy costume, cartoon, ugly, low quality'
    },

    // ============ 中东/阿拉伯地区 ============
    {
        key: 'arabian-nights',
        label: '一千零一夜',
        hint: '中东、阿拉伯宫廷、飞毯、神灯',
        
        previewPrompt:
            'arabian nights fantasy drama key visual, beautiful protagonist in ornate Arabic attire inside golden palace, oil lamp glow, silk drapery, mystical desert night atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `arabian nights fantasy drama style, ornate Arabic attire, golden palace, oil lamp glow, silk drapery, mystical desert night, ${BEAUTY_PREFIX}`,
        videoPromptPrefix:
            'arabian nights fantasy drama video, ornate Arabic attire, golden palaces, silk drapery, mystical desert atmosphere, premium orientalist fantasy live-action look',
        negativePrompt: 'modern city, western setting, cartoon, ugly, low quality'
    },
    {
        key: 'middle-east-modern',
        label: '中东现代豪门',
        hint: '迪拜、沙特、石油富豪家族剧',
        
        previewPrompt:
            'middle east luxury drama key visual, elegant protagonist in modern Arabic couture inside Dubai penthouse, city skyline, gold and marble interior, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `middle east luxury drama style, modern Arabic couture, Dubai or Riyadh penthouse, gold and marble interior, city skyline, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'middle east luxury drama video, modern Arabic fashion, Dubai penthouse, gold marble interiors, city skyline, premium wealthy family live-action drama look',
        negativePrompt: 'ancient setting, cartoon, ugly, low quality'
    },
    {
        key: 'desert-tribal',
        label: '沙漠部落',
        hint: '贝都因、骆驼、沙漠冒险',
        
        previewPrompt:
            'desert tribal drama key visual, attractive Bedouin protagonist on camel across golden dunes, flowing robes, sunset, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `desert tribal drama style, Bedouin attire, flowing robes, golden dunes, camel caravan, sunset lighting, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'desert tribal drama video, Bedouin culture, golden dunes, camel caravan, flowing robes, sunset lighting, premium adventure live-action look',
        negativePrompt: 'urban modern, cartoon, ugly, low quality'
    },

    // ============ 印度/南亚地区 ============
    {
        key: 'bollywood',
        label: '宝莱坞歌舞',
        hint: '印度、色彩鲜艳、歌舞、大家庭剧',
        
        previewPrompt:
            'bollywood drama key visual, beautiful protagonist in vibrant sari with intricate embroidery, joyful dance pose, colorful festival background, saturated warm lighting, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `bollywood drama style, vibrant sari and sherwani costumes, intricate embroidery, festival colors, saturated warm lighting, joyful dance atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'bollywood drama video, vibrant Indian costumes, festival colors, joyful dance choreography, saturated warm lighting, premium musical live-action look',
        negativePrompt: 'dull colors, western setting, cartoon, ugly, low quality'
    },
    {
        key: 'indian-mythology',
        label: '印度神话',
        hint: '罗摩衍那、诸神、印度史诗',
        
        previewPrompt:
            'indian mythology epic drama key visual, divine protagonist with golden ornaments and lotus, celestial glow, ancient temple architecture, dramatic epic composition, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `indian mythology epic drama style, divine characters with golden ornaments, celestial glow, ancient temple architecture, lotus motifs, epic dramatic composition, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'indian mythology epic drama video, divine characters, celestial magic, ancient temples, golden ornaments, premium mythological live-action look',
        negativePrompt: 'modern setting, cartoon, ugly, low quality'
    },

    // ============ 拉美/南美地区 ============
    {
        key: 'telenovela',
        label: '拉丁狗血剧',
        hint: '拉美、恩怨情仇、家族豪门',
        
        previewPrompt:
            'latin telenovela drama key visual, passionate protagonist in emotional dramatic moment inside Mexico villa, warm sunlight, vibrant Latin fashion, intense tearful expression, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `latin telenovela drama style, passionate emotional characters, warm sunlight, vibrant Latin fashion, Mexican or Brazilian villa interiors, intense emotional close-ups, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'latin telenovela drama video, passionate emotional performance, warm sunlight, vibrant Latin interiors, intense melodramatic acting, premium live-action look',
        negativePrompt: 'cold colors, asian setting, cartoon, ugly, low quality'
    },
    {
        key: 'latin-carnival',
        label: '拉美狂欢节',
        hint: '巴西狂欢、桑巴、色彩缤纷',
        
        previewPrompt:
            'latin carnival drama key visual, beautiful protagonist in feathered samba costume, Rio de Janeiro carnival street, explosive colors and confetti, joyful festive atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `latin carnival drama style, feathered samba costumes, Rio carnival streets, explosive vibrant colors, confetti, joyful festive atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'latin carnival drama video, samba costumes, carnival streets, vibrant colors, confetti, joyful festive live-action motion, premium celebratory drama look',
        negativePrompt: 'muted colors, quiet interior, cartoon, ugly, low quality'
    },

    // ============ 东南亚地区 ============
    {
        key: 'thai-supernatural',
        label: '泰式恐怖悬疑',
        hint: '泰国鬼怪、灵异、恐怖悬疑',
        
        previewPrompt:
            'thai supernatural horror drama key visual, protagonist in traditional Thai house at night, eerie ghostly presence, dim yellow lamp light, misty atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `thai supernatural horror drama style, traditional Thai house, eerie ghostly presence, dim yellow lamp light, misty atmosphere, tense supernatural mood, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'thai supernatural horror drama video, traditional Thai settings, ghostly presence, dim lighting, misty atmosphere, premium horror live-action look',
        negativePrompt: 'bright cheerful, cartoon, ugly, low quality'
    },
    {
        key: 'southeast-asia-street',
        label: '东南亚街头',
        hint: '越南、菲律宾、街边市集、烟火气',
        
        previewPrompt:
            'southeast asian street drama key visual, protagonist in bustling night market with tropical foliage, warm string lights, motorbikes, humid atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `southeast asian street drama style, bustling night market, tropical foliage, warm string lights, motorbikes, humid urban atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'southeast asian street drama video, night market, tropical urban settings, warm string lights, humid atmosphere, premium slice-of-life live-action look',
        negativePrompt: 'sterile modern, cold colors, cartoon, ugly, low quality'
    },

    // ============ 欧洲地区 ============
    {
        key: 'european-royal',
        label: '欧洲皇室',
        hint: '欧洲宫廷、贵族联姻、王室争斗',
        
        previewPrompt:
            'european royal drama key visual, elegant noble in ornate ballgown or military uniform inside Baroque palace, chandelier light, rich tapestries, refined regal atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `european royal drama style, ornate ballgowns and military uniforms, Baroque palace interiors, chandelier lighting, rich tapestries, refined regal atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'european royal drama video, ornate court attire, Baroque palaces, chandelier lighting, refined regal live-action performance, premium period drama look',
        negativePrompt: 'asian setting, modern city, cartoon, ugly, low quality'
    },
    {
        key: 'nordic-noir',
        label: '北欧冷冽悬疑',
        hint: '北欧、极简、寒冷、犯罪悬疑',
        
        previewPrompt:
            'nordic noir drama key visual, brooding protagonist in minimalist Scandinavian interior, cold blue-grey palette, snow outside window, tense understated atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `nordic noir drama style, minimalist Scandinavian interiors, cold blue-grey palette, snowy exteriors, tense understated atmosphere, sharp realistic cinematography, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'nordic noir drama video, minimalist Scandinavian settings, cold color grading, snowy atmosphere, tense understated live-action performance, premium crime drama look',
        negativePrompt: 'warm colors, tropical, cartoon, ugly, low quality'
    },
    {
        key: 'french-romance',
        label: '法式浪漫',
        hint: '巴黎、埃菲尔铁塔、文艺浪漫',
        
        previewPrompt:
            'french romance drama key visual, elegant couple on Parisian street cafe with Eiffel Tower view, soft golden light, chic fashion, romantic wistful atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `french romance drama style, Parisian cafes and streets, Eiffel Tower background, soft golden light, chic French fashion, romantic wistful atmosphere, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'french romance drama video, Parisian streets, Eiffel Tower vistas, soft golden light, chic fashion, romantic wistful live-action look, premium arthouse quality',
        negativePrompt: 'asian setting, gritty, cartoon, ugly, low quality'
    },
    {
        key: 'british-period',
        label: '英伦古典',
        hint: '英国乡村庄园、简·奥斯汀、绅士淑女',
        
        previewPrompt:
            'british period drama key visual, elegant regency-era protagonist in tailored coat or empire waist gown at English country manor, misty garden, refined atmosphere, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `british period drama style, regency-era attire, English country manor, misty garden, refined understated atmosphere, elegant period cinematography, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'british period drama video, regency-era attire, English country manor, misty garden, refined restrained live-action performance, premium period drama look',
        negativePrompt: 'modern setting, asian costume, cartoon, ugly, low quality'
    },

    // ============ 大洋洲/其他 ============
    {
        key: 'aussie-outback',
        label: '澳洲内陆',
        hint: '澳大利亚、内陆红土、粗犷',
        
        previewPrompt:
            'australian outback drama key visual, rugged protagonist on red-dirt outback with vast horizon, dusty golden light, weathered hat, sharp cinematic detail, no text, no logo',
        imagePromptPrefix: `australian outback drama style, rugged characters, red-dirt outback, vast horizon, dusty golden light, weathered practical wardrobe, ${BEAUTY_PREFIX}`,
        videoPromptPrefix: 'australian outback drama video, red-dirt landscape, vast horizons, dusty golden light, rugged live-action performance, premium adventure drama look',
        negativePrompt: 'urban modern, tropical, cartoon, ugly, low quality'
    },

    // ============ 扩展：非洲、阿拉伯与东南亚民族地域 ============
    expandedStylePreset('west-african-folklore', '西非民间传说', '阿散蒂、约鲁巴神话、金饰与祭典', 'West African folklore drama, Black protagonists, Yoruba and Ashanti inspired ceremonial clothing, carved masks, gold jewelry, sacred grove, warm firelight and ancestral spirits'),
    expandedStylePreset('east-african-pastoral', '东非草原民族', '马赛风俗、草原生活、红色披肩', 'East African pastoral drama, Maasai inspired red shuka clothing and beadwork, dark-skinned protagonists, acacia savanna, cattle village, sunrise documentary cinematography'),
    expandedStylePreset('arabian-bedouin', '阿拉伯贝都因', '沙漠部族、帐篷、骆驼与星空', 'Arabian Bedouin epic drama, authentic desert robes and embroidered textiles, black goat-hair tents, camel caravan, vast dunes and star-filled night sky'),
    expandedStylePreset('persian-folklore', '波斯民间奇幻', '波斯花纹、诗歌意境、神鸟与宫殿', 'Persian folklore fantasy, ornate Persian textiles and miniature painting motifs, turquoise palace, cypress garden, mythical Simurgh bird, jewel-toned cinematic lighting'),
    expandedStylePreset('malay-folklore', '马来民间传说', '马来甘榜、传统服饰、热带传说', 'Malay folklore drama, Southeast Asian protagonists in baju kurung and songket, traditional kampung houses, tropical moonlit forest, keris legend and subtle spirits'),
    expandedStylePreset('indonesian-folklore', '印尼群岛传说', '爪哇巴厘、皮影、火山与神话', 'Indonesian archipelago folklore, Javanese and Balinese inspired traditional dress, wayang shadow motifs, volcanic landscape, temple gates, tropical ceremonial atmosphere'),
    expandedStylePreset('philippine-folklore', '菲律宾民间奇谈', '巴里奥村落、海岛、传统怪谈', 'Philippine folklore fantasy, Filipino protagonists in traditional rural barrio, capiz windows, tropical island forest, moonlit aswang legend atmosphere, respectful cinematic realism'),

    // ============ 扩展：童话寓言 ============
    expandedStylePreset('enchanted-forest', '魔法森林童话', '发光森林、精灵、蘑菇与秘境', 'enchanted forest fairytale, luminous ancient trees, tiny fairies, oversized mushrooms, fireflies, hidden cottage and emerald-gold magical light', 'modern city, horror gore, text, logo, photorealistic documentary'),
    expandedStylePreset('dark-fairytale', '暗黑童话', '诅咒城堡、荆棘、月夜寓言', 'dark European fairytale, cursed castle, thorn forest, pale moon, mysterious elegant heroine, ominous ravens, painterly storybook gothic atmosphere', 'bright modern city, gore, text, logo, low quality'),
    expandedStylePreset('princess-fairytale', '公主童话', '梦幻城堡、舞会、华丽礼服', 'classic princess fairytale, radiant castle ballroom, elegant fictional adult princess in sparkling gown, glass chandeliers, magical carriage, pastel golden storybook light'),
    expandedStylePreset('animal-fable', '动物寓言', '拟人动物、温暖村庄、寓言故事', 'whimsical animal fable illustration, expressive anthropomorphic fox rabbit and bear in a cozy woodland village, handcrafted clothes, warm picture-book textures', 'real people, horror, text, logo, low quality'),
    expandedStylePreset('ocean-fairytale', '海洋童话', '人鱼、珊瑚王国、海底秘境', 'ocean fairytale, adult merfolk protagonist in luminous coral kingdom, schools of jewel-colored fish, underwater palace, flowing fabric and turquoise caustic light'),
    expandedStylePreset('nordic-fairytale', '北欧冰雪童话', '雪国、极光、冰宫与森林精灵', 'Nordic winter fairytale, snow-covered pine forest, aurora sky, crystalline ice palace, elegant adult traveler and forest spirits, cool luminous storybook painting'),

    // ============ 扩展：战争史诗 ============
    expandedStylePreset('modern-war', '现代战争', '现代战场、战术小队、纪实质感', 'modern warfare drama, multinational tactical squad in realistic combat gear, ruined urban street, smoke, tense documentary handheld cinematography', 'fantasy armor, glamorous fashion, text, logo, cartoon'),
    expandedStylePreset('ww2-war', '二战史诗', '二战军装、历史战场、胶片质感', 'World War II historical drama, period-accurate 1940s uniforms and vehicles, muddy battlefield, smoke and searchlights, desaturated archival film color'),
    expandedStylePreset('ancient-battlefield', '古代战争史诗', '冷兵器军阵、城池攻防、千军万马', 'ancient battlefield epic, disciplined infantry formations, cavalry, banners, siege walls, dust and sunrise, historically grounded armor, monumental wide cinematography'),
    expandedStylePreset('desert-war', '沙漠战争', '沙漠装甲、风暴、极端生存', 'desert war drama, armored convoy and soldiers crossing vast dunes, sandstorm, heat haze, weathered equipment, harsh amber cinematic realism'),
    expandedStylePreset('naval-war', '海战史诗', '舰队、巨浪、炮火与海上救援', 'naval warfare epic, warships in stormy open ocean, towering waves, smoke and naval signals, tense crew on deck, steel-blue cinematic palette'),
    expandedStylePreset('resistance-war', '谍战与抵抗', '地下组织、占领区、秘密行动', 'wartime resistance thriller, covert agents in period civilian coats, occupied old city, coded documents, rain, blackout streets and tense film-noir lighting'),

    // ============ 扩展：科幻 ============
    expandedStylePreset('alien-contact', '外星接触', '首次接触、未知文明、宏大飞船', 'first-contact science fiction, human scientist facing an immense nonhuman spacecraft, strange atmospheric light, alien language-free geometry, awe and scale'),
    expandedStylePreset('hard-sci-fi', '硬核科幻', '真实航天、物理细节、近未来工程', 'hard science fiction, physically plausible orbital station, astronauts in functional pressure suits, realistic spacecraft engineering, Earth limb, crisp natural space lighting'),
    expandedStylePreset('planetary-colony', '异星殖民地', '外星基地、拓荒者、陌生地貌', 'planetary colony drama, modular habitat settlement on an alien world, adult settlers, rovers, unfamiliar rock formations and twin moons, practical near-future realism'),
    expandedStylePreset('robot-society', '机器人社会', '仿生人、机械城市、身份冲突', 'robot society science fiction, diverse humanoid androids in a clean mechanical metropolis, visible synthetic details, social tension, cool architectural cinematography'),
    expandedStylePreset('retro-futurism', '复古未来主义', '六十年代想象、流线机械、原子时代', '1960s retro-futurism, streamlined chrome spacecraft, atomic-age city, bold geometric interiors, elegant adult protagonist, saturated vintage magazine colors'),
    expandedStylePreset('cosmic-horror', '宇宙恐怖', '深空未知、渺小感、诡异天体', 'cosmic horror science fiction, lone adult astronaut before an impossible celestial structure, deep-space darkness, subtle nonhuman geometry, existential scale and restrained dread', 'cute aliens, gore, text, logo, bright comedy'),

    // ============ 扩展：全球民族风俗 ============
    expandedStylePreset('japanese-festival', '日本祭典风俗', '夏祭、浴衣、神社与花火', 'Japanese summer festival drama, adult protagonists in yukata, shrine lanterns, festival stalls, taiko drums and fireworks, warm nostalgic night cinematography'),
    expandedStylePreset('mexican-day-dead', '墨西哥亡灵节', '万寿菊、祭坛、彩绘骷髅文化', 'Mexican Day of the Dead cultural drama, Mexican protagonists, marigold-covered ofrenda, papel picado, candlelight and respectful calavera face art, vivid warm colors'),
    expandedStylePreset('andean-folklore', '安第斯高原风俗', '秘鲁玻利维亚、织物、山地节庆', 'Andean highland folklore, Indigenous Andean protagonists in authentic woven textiles, mountain village festival, panpipes, alpacas and vast high-altitude landscape'),
    expandedStylePreset('slavic-folklore', '斯拉夫民间传说', '东欧森林、刺绣服饰、古老精怪', 'Slavic folklore fantasy, embroidered Eastern European clothing, birch forest village, carved wooden cottage, winter mist and ancient woodland spirits'),

    // ============ 第二批扩展：全球地域、童话、战争与科幻 ============
    expandedStylePreset('ethiopian-highland', '埃塞俄比亚高地史诗', '高原教堂、传统白袍、古老王国', 'Ethiopian highland historical epic, dark-skinned Ethiopian protagonists in white habesha kemis and woven shawls, rock-hewn church, rugged green highlands, ancient royal atmosphere'),
    expandedStylePreset('saharan-tuareg', '撒哈拉图阿雷格', '蓝色面纱、沙漠商队、游牧文化', 'Saharan Tuareg cultural drama, indigo-veiled desert nomads, silver jewelry, camel caravan, wind-carved dunes, blue-hour firelight and authentic North African textiles'),
    expandedStylePreset('levantine-old-city', '黎凡特古城', '石砌街巷、庭院、地中海生活', 'Levantine old-city family drama, Arab protagonists in a historic limestone alley and mosaic courtyard, olive trees, market lanterns, warm Mediterranean afternoon light'),
    expandedStylePreset('ottoman-period', '奥斯曼时代', '帝国宫廷、瓷砖穹顶、历史传奇', 'Ottoman period drama, elegant court attire, Iznik tiled palace halls, domes and Bosphorus view, deep crimson and turquoise palette, historically inspired cinematic grandeur'),
    expandedStylePreset('vietnamese-folklore', '越南民间传说', '奥黛、竹林、水乡与仙灵', 'Vietnamese folklore fantasy, adult Vietnamese protagonist in flowing ao dai, misty bamboo grove, lotus river village, ancient communal house and gentle ancestral spirit light'),
    expandedStylePreset('khmer-mythology', '高棉神话', '吴哥遗迹、那伽、热带神殿', 'Khmer mythology epic, Cambodian protagonists in ornate traditional attire, Angkor-inspired jungle temple, stone naga guardians, monsoon mist and sacred golden light'),
    expandedStylePreset('pacific-island-folklore', '太平洋岛屿传说', '海岛航海、纹样、火山与祖灵', 'Pacific Island folklore adventure, Polynesian-inspired adult wayfinders on an ocean canoe, respectful traditional patterns, volcanic island, turquoise sea and ancestral star navigation'),
    expandedStylePreset('candyland-fairytale', '糖果王国童话', '糖果城堡、马卡龙色、甜蜜冒险', 'candy kingdom fairytale, whimsical adult traveler, gingerbread castle, candy-glass towers, marshmallow clouds, jewel-like sweets and bright pastel storybook lighting', 'dark horror, realistic war, text, logo, watermark'),
    expandedStylePreset('clockwork-fairytale', '发条童话', '钟表城、机械精灵、黄铜魔法', 'clockwork fairytale, intricate brass clock city, mechanical birds and tiny automata, elegant adult inventor, amber lamplight, whimsical illustrated machinery'),
    expandedStylePreset('chinese-fairy-tale', '东方神仙童话', '仙鹤、月宫、祥云与灵兽', 'Chinese celestial fairytale, graceful adult immortal among moon palace terraces, cranes, auspicious clouds, jade trees and luminous spirit animals, refined gongbi storybook art'),
    expandedStylePreset('trench-war', '堑壕战争', '泥泞战壕、历史军装、压迫感', 'historical trench warfare drama, exhausted soldiers in period-accurate uniforms, muddy trenches, barbed wire, cold rain and distant artillery flashes, restrained anti-war cinematography'),
    expandedStylePreset('aerial-war', '空战史诗', '战斗机编队、云海、飞行员', 'aerial warfare epic, fighter aircraft formation above towering clouds, pilot inside detailed cockpit, dramatic contrails and sunrise, high-altitude cinematic realism'),
    expandedStylePreset('samurai-war', '战国武士战争', '日本战国、武士军阵、山城', 'Japanese Sengoku war epic, samurai commander in historically inspired armor, disciplined ashigaru formations, mountain castle, rain and battle banners, austere cinematic realism'),
    expandedStylePreset('neon-space-western', '霓虹太空西部', '边境星球、赏金猎人、酒馆霓虹', 'neon space western, rugged adult bounty hunter on a frontier planet, alien saloon, dusty street, twin suns, worn spacecraft and cyan-magenta signs without readable text'),
    expandedStylePreset('utopian-sci-fi', '理想主义科幻', '洁净未来城、生态建筑、乐观科技', 'optimistic utopian science fiction, diverse adult citizens in a luminous eco-city, elegant white architecture, vertical gardens, clean transit and warm natural sunlight'),
    expandedStylePreset('interstellar-ark', '星际方舟', '世代飞船、生态舱、深空远航', 'interstellar ark science fiction, immense generation ship interior with living forests and habitat rings, adult crew overlooking deep space, monumental engineering and hopeful cinematic scale'),
    expandedStylePreset('korean-folklore', '韩国民间传说', '韩屋、传统韩服、山神与月夜', 'Korean folklore fantasy, adult Korean protagonists in traditional hanbok, moonlit hanok village, mountain guardian spirit, painted screens and subtle lantern light'),
    expandedStylePreset('chinese-ethnic-miao', '苗族银饰风俗', '苗族银冠、刺绣、山寨节庆', 'Miao ethnic cultural drama in southwest China, adult protagonists wearing intricate authentic silver headdresses and embroidered clothing, mountain village festival, lush terraces and torchlight'),
    expandedStylePreset('tibetan-folklore', '藏地民间传说', '高原寺院、经幡、雪山史诗', 'Tibetan plateau folklore, adult Tibetan protagonists in traditional chuba clothing, prayer flags, remote monastery, turquoise lake and snow mountains, reverent high-altitude cinematography'),
    expandedStylePreset('mongolian-steppe', '蒙古草原史诗', '长调、骏马、蒙古包与旷野', 'Mongolian steppe epic, adult nomadic riders in deel clothing, horses beside ger camp, endless grassland, eagle and storm-lit horizon, expansive cinematic composition'),
    expandedStylePreset('central-asian-silk-road', '中亚丝路风情', '商队、蓝色穹顶、织毯与古城', 'Central Asian Silk Road drama, Uzbek and Kazakh inspired adult travelers, blue-tiled caravanserai, patterned carpets, desert trade caravan and golden dusk'),
    expandedStylePreset('celtic-folklore', '凯尔特民间传说', '海岸荒原、石环、德鲁伊秘境', 'Celtic folklore fantasy, windswept Atlantic moor, ancient stone circle, adult heroine in woven cloak, glowing knotwork, mist and mysterious green-gold light'),
    expandedStylePreset('maori-legend', '毛利神话传说', '新西兰山海、传统纹样、祖灵', 'Maori legend inspired drama, respectful adult Maori protagonists, carved meeting house, traditional woven garments and patterns, dramatic Aotearoa coast and ancestral atmosphere'),
    expandedStylePreset('arctic-indigenous', '北极原住民传说', '冰原、极光、雪屋与古老狩猎文化', 'Arctic Indigenous folklore, respectful adult Inuit-inspired protagonists in traditional cold-weather garments, sea ice settlement, sled dogs, aurora and blue polar twilight'),

    // ============ 冒险探索 ============
    expandedStylePreset('jungle-expedition', '热带雨林探险', '密林、遗迹、河谷与探险队', 'cinematic jungle expedition adventure, adult explorers crossing a dense tropical rainforest, vine-covered ruins, rushing river, humid sunbeams and practical field gear'),
    expandedStylePreset('lost-world-adventure', '失落世界冒险', '史前秘境、巨兽、隔绝文明', 'lost world adventure, adult expedition team overlooking a hidden prehistoric valley, giant ferns, distant dinosaurs, waterfalls and monumental misty cliffs'),
    expandedStylePreset('treasure-hunt', '秘境寻宝', '藏宝图、机关、地下宝库', 'classic treasure hunt adventure, adult adventurers with an old map inside a torchlit underground vault, mechanical traps, ancient coins and suspenseful golden shadows'),
    expandedStylePreset('archaeological-adventure', '考古冒险', '古墓、遗址、历史谜团', 'archaeological adventure, adult archaeologist uncovering a sealed ancient chamber, carved reliefs, dust-filled light shafts, field notebooks and historically grounded artifacts'),
    expandedStylePreset('ocean-voyage', '远洋航海冒险', '帆船、风暴、未知海域', 'ocean voyage adventure, adult crew aboard a tall sailing ship entering unknown waters, towering waves, storm clouds, distant uncharted island and dramatic maritime light'),
    expandedStylePreset('polar-expedition', '极地科考探险', '冰川、科考队、极夜远征', 'polar expedition adventure, adult research team crossing fractured sea ice with sleds, towering blue glacier, blowing snow, headlamps and aurora at polar night'),
    expandedStylePreset('desert-expedition', '沙漠遗迹探险', '沙海、古城、风暴与商队', 'desert expedition adventure, adult explorers approaching a half-buried ancient city, camel caravan, windblown dunes, sandstorm wall and harsh amber sunlight'),
    expandedStylePreset('mountain-climbing', '高山攀登冒险', '雪峰、峭壁、绳队与云海', 'high-altitude mountaineering adventure, roped adult climbers ascending an exposed ice ridge, immense summit, cloud sea, windblown snow and realistic technical equipment'),

    // ============ 极境生存 ============
    expandedStylePreset('wilderness-survival', '荒野求生', '森林营地、取火、追踪与自救', 'wilderness survival drama, lone adult survivor building a shelter and fire in a vast temperate forest, handmade tools, rain-soaked clothing and grounded documentary realism'),
    expandedStylePreset('island-survival', '荒岛生存', '孤岛、海滩、庇护所与求救信号', 'desert island survival, adult castaway beside a handmade palm shelter and signal fire, turquoise ocean, storm debris, hunger and determined cinematic realism'),
    expandedStylePreset('jungle-survival', '雨林生存', '暴雨、毒虫、沼泽与密林穿越', 'jungle survival thriller, exhausted adult survivor navigating flooded tropical forest, torrential rain, leeches, tangled roots and a fragile torch'),
    expandedStylePreset('arctic-survival', '冰原生存', '暴雪、冰洞、极寒与孤立无援', 'Arctic survival drama, adult survivor in frost-covered expedition clothing beside an emergency snow shelter, whiteout blizzard, cracked ice and blue twilight'),
    expandedStylePreset('desert-survival', '沙漠生存', '缺水、烈日、沙暴与绿洲', 'desert survival drama, dehydrated adult traveler crossing scorching dunes toward a distant oasis, torn gear, heat haze, sandstorm and unforgiving overhead sun'),
    expandedStylePreset('ocean-survival', '海上漂流生存', '救生筏、巨浪、饥渴与希望', 'open-ocean survival, adult survivor on a damaged life raft under immense storm waves, emergency supplies, distant seabirds and a narrow break of sunrise'),
    expandedStylePreset('disaster-survival', '城市灾后生存', '废墟、断电、搜救与互助', 'urban disaster survival drama, adult civilians navigating a collapsed city block, emergency lights, dust, improvised rescue tools and tense humane realism'),
    expandedStylePreset('primitive-survival', '原始环境生存', '石器、洞穴、狩猎与部落协作', 'primitive survival epic, early human family using stone tools near a cave shelter, controlled fire, dangerous wilderness and respectful paleoanthropological realism'),

    // ============ 动物世界 ============
    expandedEnvironmentStylePreset('african-wildlife', '非洲野生动物', '草原迁徙、狮群、象群与旱季', 'African savanna nature documentary, elephants walking near giraffes and zebras, wildebeest migration, acacia trees and natural golden dawn light', 'people, costumes, text, logo, fantasy animals, low quality'),
    expandedEnvironmentStylePreset('rainforest-wildlife', '雨林动物世界', '猩猩、豹、树冠与热带生态', 'premium rainforest wildlife documentary, orangutan in layered emerald canopy, hidden leopard, tropical birds, mist and shafts of natural light', 'people, cages, text, logo, cartoon, low quality'),
    expandedEnvironmentStylePreset('ocean-wildlife', '蓝色海洋动物', '鲸群、海豚、珊瑚与深海生态', 'premium ocean wildlife documentary, humpback whales and dolphins above a luminous coral reef, schools of fish, clear blue water and sun rays', 'people, aquarium, text, logo, cartoon, low quality'),
    expandedEnvironmentStylePreset('arctic-wildlife', '极地动物世界', '北极熊、企鹅、海豹与冰海', 'premium polar wildlife documentary, polar bear crossing sea ice with seals in distance, immense glacier and cold natural blue light', 'people, zoo, text, logo, cartoon, low quality'),
    expandedEnvironmentStylePreset('prehistoric-animals', '史前动物世界', '恐龙、猛犸、远古生态复原', 'scientifically grounded prehistoric wildlife documentary, feathered dinosaurs in a Cretaceous floodplain, volcanic horizon, cycads and cinematic natural-history realism', 'people, modern objects, text, logo, toy dinosaur'),
    expandedEnvironmentStylePreset('insect-micro-world', '昆虫微观世界', '微距生态、甲虫、蝴蝶与露珠', 'extreme macro nature documentary, jewel-toned beetle and butterfly among moss and giant dew drops, intricate textures, shallow focus and natural morning light', 'people, text, logo, cartoon insects, low detail'),
    expandedEnvironmentStylePreset('bird-migration', '候鸟迁徙', '万鸟长空、湿地、季节远征', 'epic bird migration documentary, thousands of cranes flying over wetlands and mountains at sunrise, sweeping aerial composition and realistic seasonal atmosphere', 'people, airplanes, text, logo, cartoon'),
    expandedEnvironmentStylePreset('animal-family-doc', '动物家族纪实', '亲子、群落、成长与守护', 'intimate animal family documentary, elephant mother protecting a calf beside the herd, emotional natural behavior, soft dusk light and telephoto realism', 'people, costumes, text, logo, anthropomorphic animals'),

    // ============ 宇宙星空 ============
    expandedStylePreset('deep-space-nebula', '深空星云', '绚丽星云、恒星尘埃、宏大宇宙', 'deep-space nebula spectacle, colossal pillars of colorful interstellar gas, newborn stars, cosmic dust and scientifically inspired astronomical scale', 'people, city, text, logo, flat illustration'),
    expandedStylePreset('milky-way-stargazing', '银河观星', '星河拱桥、旷野、天文摄影', 'Milky Way stargazing cinematography, tiny adult observer beside a telescope under an immense galactic arch, dark mountain plateau and realistic long-exposure night sky'),
    expandedStylePreset('black-hole-voyage', '黑洞远航', '事件视界、引力透镜、深空飞船', 'black hole voyage science fiction, small exploration vessel approaching a luminous accretion disk, dramatic gravitational lensing, warped starlight and immense cosmic scale'),
    expandedStylePreset('exoplanet-landscape', '系外行星奇观', '异星地貌、双太阳、陌生天空', 'exoplanet landscape, adult astronaut overlooking crystalline plains, alien mountains, twin suns, ringed planet in the sky and physically plausible cinematic light'),
    expandedStylePreset('solar-system-epic', '太阳系史诗', '行星、太阳风、轨道尺度', 'solar system epic visualization, spacecraft crossing above Jupiter storms with moons aligned, distant Sun, monumental orbital perspective and realistic planetary detail'),
    expandedStylePreset('cosmic-birth', '宇宙诞生', '大爆炸、早期宇宙、星系形成', 'cinematic cosmic birth visualization, primordial light expanding into filaments, first stars and forming galaxies, abstract but scientifically inspired deep-space grandeur', 'people, text, logo, religious symbols, low detail'),
    expandedStylePreset('astronaut-loneliness', '宇航员孤独感', '渺小个体、寂静深空、情绪科幻', 'solitary astronaut drama, lone adult figure tethered outside a silent space station, Earth far below, vast blackness and restrained contemplative cinematography'),
    expandedStylePreset('celestial-fantasy', '星空幻想', '星座神殿、银河海、梦幻天体', 'celestial fantasy, elegant adult traveler sailing across a luminous sea of stars, constellation temples, floating moons and painterly indigo-gold dream atmosphere'),

    // ============ 人类起源 ============
    expandedStylePreset('human-origins', '人类起源', '非洲大地、早期人族、演化黎明', 'human origins paleoanthropology drama, respectful early hominin family on an East African rift valley at dawn, stone flakes, grassland and scientifically grounded reconstruction'),
    expandedStylePreset('stone-age-tribe', '旧石器部落', '狩猎采集、石器、篝火与洞穴', 'Paleolithic tribe historical reconstruction, adult hunter-gatherers preparing stone tools around a cave fire, animal-hide clothing and Ice Age landscape'),
    expandedStylePreset('neolithic-village', '新石器村落', '农耕定居、陶器、谷物与聚落', 'Neolithic village reconstruction, early farming families beside mud-brick houses, pottery, grain fields, domesticated animals and warm sunrise realism'),
    expandedStylePreset('cave-art-era', '洞穴壁画时代', '史前艺术、火把、仪式与野兽图腾', 'prehistoric cave art era, adult artist painting bison forms by flickering torchlight, mineral pigments, hand stencils and deep limestone chamber'),
    expandedStylePreset('ancient-migration', '远古人类迁徙', '跨越荒原、海岸与冰川的族群远征', 'ancient human migration epic, early families carrying tools and children across a vast coastal plain, changing climate, distant glacier and hopeful horizon'),
    expandedStylePreset('first-civilization', '最初文明', '河谷城市、文字、灌溉与神庙', 'dawn of civilization, early Mesopotamian river city with irrigation canals, scribes, mud-brick temple and bustling market, historically grounded bronze sunlight'),
    expandedStylePreset('bronze-age-epic', '青铜时代史诗', '青铜器、城邦、贸易与英雄时代', 'ancient Bronze Age city drama, adult ruler and peaceful merchants at a fortified gate, ceremonial bronze objects, horse chariot, trade goods and warm sunset'),
    expandedStylePreset('evolutionary-journey', '生命演化长卷', '从海洋生命到人类的时间史诗', 'evolutionary journey visualization, layered cinematic panorama from ancient ocean life through dinosaurs and mammals to early humans, coherent natural-history progression', 'text, labels, logo, modern city, low detail'),

    // ============ 灾难奇观 ============
    expandedStylePreset('volcanic-eruption', '火山大喷发', '熔岩、火山灰、撤离与红色天幕', 'volcanic eruption disaster epic, colossal ash plume and lava fountains above a threatened town, adult evacuees, emergency vehicles and apocalyptic red daylight'),
    expandedStylePreset('mega-earthquake', '超级地震', '地裂、建筑摇晃、城市救援', 'mega-earthquake disaster drama, city avenue splitting under violent shaking, damaged buildings, adult rescue teams and dust-filled cinematic realism'),
    expandedStylePreset('tsunami-disaster', '海啸灾难', '巨浪、沿海城市、紧急撤离', 'tsunami disaster epic, immense wall of water approaching a coastal city, adult civilians evacuating uphill, warning lights and terrifying realistic scale'),
    expandedStylePreset('superstorm', '超级风暴', '飓风眼、暴雨、雷电与洪水', 'superstorm disaster, massive rotating hurricane clouds over a flooded city, lightning, extreme rain, adult emergency responders and steel-blue cinematic palette'),
    expandedStylePreset('wildfire-disaster', '山火灾难', '火线、浓烟、森林与撤离行动', 'wildfire disaster drama, towering fire front racing through a dry forest, orange smoke, adult firefighters protecting an evacuation route and intense realistic heat'),
    expandedStylePreset('ice-age-cataclysm', '冰河世纪灾变', '急冻世界、冰川推进、极寒逃亡', 'Ice Age cataclysm, rapidly advancing glacier engulfing a prehistoric valley, human survivors and mammoths crossing snow, blue-white storm and monumental scale'),
    expandedStylePreset('asteroid-impact', '小行星撞击', '天体坠落、冲击波、末日天空', 'asteroid impact disaster spectacle, blazing celestial body entering atmosphere above a distant landscape, colossal shockwave clouds and tiny human silhouettes for scale'),
    expandedStylePreset('global-flood', '全球洪水', '淹没城市、方舟救援、无尽水域', 'global flood disaster drama, submerged modern city with rooftops above endless water, adult rescue boats, storm break and vast reflective horizon'),

    // ============ 漂流与多形态冒险 ============
    expandedStylePreset('river-rafting', '激流漂流冒险', '峡谷急流、橡皮艇、团队协作', 'whitewater rafting adventure, adult team steering an inflatable raft through a roaring canyon rapid, spray, rocks and dynamic natural daylight'),
    expandedStylePreset('castaway-diary', '荒岛漂流记', '海难余生、孤岛日记、长期求生', 'castaway diary adventure, lone adult survivor recording days beside a weathered island shelter, wreckage on beach, handmade calendar and changing tropical weather'),
    expandedStylePreset('raft-drift', '木筏海上漂流', '自制木筏、无尽海面、星夜航向', 'ocean raft drift adventure, adult travelers on a handmade wooden raft under an immense sky, patched sail, provisions, distant storm and hopeful starlight'),
    expandedStylePreset('shipwreck-adventure', '沉船求生冒险', '破船、暗礁、海岛与幸存者', 'shipwreck survival adventure, adult survivors climbing from a broken vessel onto stormy reef rocks, scattered cargo, lighthouse beam and dramatic dawn'),
    expandedStylePreset('cave-expedition', '洞穴探险', '地下河、钟乳石、绳降与黑暗', 'cave expedition adventure, adult speleologists descending beside a vast underground river, crystal formations, ropes, headlamps and deep blue darkness'),
    expandedStylePreset('canyon-adventure', '峡谷穿越', '红岩峡谷、绳索、瀑布与险道', 'canyon traversal adventure, adult explorers rappelling through a narrow red-rock gorge, waterfall spray, rope systems and shafts of desert sunlight'),
    expandedStylePreset('island-treasure', '海岛寻宝冒险', '藏宝岛、洞窟、海盗遗迹', 'island treasure adventure, adult explorers opening a hidden sea cave behind a waterfall, old compass, weathered chest, tropical cliffs and turquoise lagoon'),
    expandedStylePreset('jungle-river-adventure', '丛林河流探险', '独木舟、雨林水道、未知部落遗迹', 'jungle river adventure, adult expedition paddling a canoe through misty rainforest waterways toward vine-covered stone ruins, tropical birds and humid light'),
    expandedStylePreset('hot-air-balloon-adventure', '热气球环球冒险', '高空远行、异域地貌、浪漫探索', 'hot-air-balloon world adventure, adult travelers in a colorful balloon basket above mountains, desert and winding rivers, sunrise clouds and grand exploratory mood'),
    expandedStylePreset('underground-world', '地心世界冒险', '地下森林、发光矿石、远古生态', 'underground world adventure, adult explorers overlooking a colossal subterranean jungle, luminous crystals, waterfalls, giant fungi and distant ancient creatures'),
    expandedStylePreset('pirate-adventure', '海盗航海冒险', '黄金时代帆船、海图、风暴海战', 'golden-age pirate adventure, fictional adult pirate crew on a tall ship, dramatic sails, old sea chart, tropical storm and cinematic swashbuckling energy'),
    expandedStylePreset('deep-sea-expedition', '深海科考冒险', '潜水器、海沟、未知深海生命', 'deep-sea expedition adventure, adult researchers inside a compact submersible descending into a dark ocean trench, bioluminescent life and hydrothermal vents'),
    expandedStylePreset('sky-island-adventure', '天空岛冒险', '浮空岛、飞行船、云海文明', 'sky-island fantasy adventure, adult adventurers aboard a small airship approaching floating islands, waterfalls falling into clouds and ancient aerial ruins'),
    expandedStylePreset('volcano-expedition', '火山科考探险', '活火山、熔岩洞、极限采样', 'volcano expedition adventure, adult scientists in heat-resistant field gear collecting samples beside a glowing lava lake, ash, basalt cliffs and intense orange light'),
    expandedStylePreset('time-expedition', '时空探险', '穿越不同时代、时间裂隙、历史奇观', 'time expedition science adventure, adult travelers standing at a luminous temporal rift connecting ancient city, prehistoric valley and futuristic skyline'),
    expandedStylePreset('micro-world-adventure', '微观世界冒险', '缩小人类、植物森林、昆虫奇观', 'micro-world adventure, tiny fictional adult explorers crossing a moss forest beneath enormous leaves and dew drops, beetles in distance and magical macro scale'),
    expandedStylePreset('robot-companion-adventure', '机器人伙伴冒险', '少年感旅程、机械伙伴、未来荒野', 'family-friendly science-fiction adventure, fictional adult traveler and lovable original robot companion crossing a colorful future wilderness, warm sunset and hopeful tone'),
    expandedStylePreset('family-road-adventure', '家庭公路冒险', '房车、长途旅行、沿途奇遇', 'family road adventure, fictional adult family beside a vintage camper on a spectacular coastal highway, maps, luggage, golden hour and joyful cinematic travel mood'),
    expandedStylePreset('train-cross-continent', '洲际列车冒险', '长途列车、雪山荒漠、旅途群像', 'cross-continent train adventure, adult travelers aboard an elegant long-distance train cutting through snow mountains and desert plains, panoramic windows and cinematic journey scale'),
    expandedStylePreset('ancient-sea-route', '古代海上丝路', '木帆船、季风航线、港口文明', 'ancient maritime Silk Road adventure, adult sailors and merchants on a wooden dhow, monsoon sea, distant historic port, spices and culturally grounded travel epic'),

    // ============ 动物动画与动物王国 ============
    expandedAnimalAnimationStylePreset('savanna-animal-kingdom', '草原动物王国动画', '狮王史诗感、动物族群、成长冒险', 'original hand-painted animated savanna epic, majestic lion family and diverse African animals gathering on a sunlit rock, warm expressive 2D animation, entirely original character designs'),
    expandedAnimalAnimationStylePreset('nostalgic-chinese-animal-cartoon', '怀旧国产动物动画', '90年代电视动画、蓝色小鼠与大脸猫式伙伴喜剧', 'hand-drawn 1990s Chinese television cartoon aesthetic, exactly two original animal friends: one small blue mouse and one large cream-colored round-faced cat, cheerful neighborhood comedy, flat cel colors and thick ink outlines, no lions'),
    expandedAnimalAnimationStylePreset('animal-city-comedy', '动物城市喜剧', '拟人动物都市、职业群像、轻喜剧', 'original animated animal metropolis comedy, diverse anthropomorphic mammals commuting through a lively multi-scale city, expressive faces, polished colorful 3D animation'),
    expandedAnimalAnimationStylePreset('forest-animal-adventure', '森林动物冒险', '狐狸、兔子、熊与森林伙伴', 'original illustrated forest animal adventure, clever fox, brave rabbit and gentle bear crossing a mossy woodland, expressive storybook animation and warm natural colors'),
    expandedAnimalAnimationStylePreset('ocean-animal-animation', '海洋动物动画', '小海豚、鲸鱼、珊瑚伙伴冒险', 'original animated ocean animal adventure, young dolphin, whale and sea turtle exploring a luminous coral kingdom, vivid aquatic 3D animation and no humans'),
    expandedAnimalAnimationStylePreset('dinosaur-family-animation', '恐龙家族动画', '恐龙亲子、史前乐园、成长故事', 'original family dinosaur animation, expressive herbivore dinosaur parents and hatchlings crossing a lush prehistoric valley, colorful cinematic 3D animation'),
    expandedAnimalAnimationStylePreset('pet-adventure', '萌宠冒险', '猫狗伙伴、城市返家、温暖喜剧', 'original animated pet adventure, expressive dog and cat companions navigating a colorful city on a journey home, warm family-film lighting and playful motion'),
    expandedEnvironmentStylePreset('horse-epic', '骏马史诗', '野马群、草原、自由与迁徙', 'cinematic wild horse documentary, powerful stallion leading a herd across open grassland, dust, storm-lit mountains and natural muscular motion', 'people, saddles, text, logo, cartoon, low quality'),
    expandedEnvironmentStylePreset('wolf-pack', '狼群传奇', '雪林狼群、协作狩猎、自然秩序', 'cinematic wolf pack nature documentary, gray wolves moving together through a snowy pine forest at blue hour, breath mist and realistic social behavior', 'people, dogs, text, logo, cartoon, low quality'),
    expandedEnvironmentStylePreset('big-cat-kingdom', '大型猫科王国', '狮虎豹、领地、力量与野性', 'premium big-cat wildlife documentary, lion, tiger and leopard shown across a coherent dramatic natural-history montage, detailed fur and powerful natural presence', 'people, zoo, cages, text, logo, cartoon'),
    expandedEnvironmentStylePreset('primate-tribe', '灵长类家族', '猩猩、黑猩猩、群体社会', 'premium primate wildlife documentary, chimpanzee family and gorillas in a rich rainforest habitat, authentic social behavior and soft natural light', 'people, costumes, cages, text, logo, cartoon'),
    expandedEnvironmentStylePreset('savanna-wildlife-doc', '非洲大草原纪实', '草原全景、水源、捕食与迁徙', 'grand African savanna wildlife documentary, elephants, giraffes, zebras and antelope across an immense golden plain around a watering hole, no humans', 'people, vehicles, text, logo, cartoon, low quality'),

    // ============ 非洲大草原与生态地理 ============
    expandedStylePreset('great-rift-valley', '东非大裂谷', '火山高地、湖泊、草原文明', 'East African Great Rift Valley geographic epic, immense escarpments, volcanic lake, flamingos and distant pastoral communities under dramatic natural light'),
    expandedEnvironmentStylePreset('serengeti-migration', '塞伦盖蒂大迁徙', '角马洪流、渡河、旱雨季循环', 'Serengeti great migration documentary, immense wildebeest and zebra herds crossing a dangerous river, dust clouds and crocodiles in natural habitat', 'people, vehicles, text, logo, cartoon, low quality'),
    expandedStylePreset('okavango-delta', '奥卡万戈三角洲', '湿地水道、象群、独木舟景观', 'Okavango Delta cinematic landscape, winding blue channels through green wetlands, elephants and hippos, traditional mokoro canoe in distance and aerial golden light'),
    expandedStylePreset('kalahari-desert', '卡拉哈里荒漠', '红色沙丘、旱地生命、布须曼文化', 'Kalahari desert cultural and nature drama, red dunes, dry grass, meerkats and respectful San-inspired adult trackers beneath a vast evening sky'),
    expandedStylePreset('congo-basin', '刚果雨林秘境', '世界第二大雨林、河流、密林生态', 'Congo Basin rainforest epic, immense dark-green canopy, broad misty river, forest elephants and distant adult conservation researchers, humid cinematic atmosphere'),
    expandedEnvironmentStylePreset('madagascar-wildlife', '马达加斯加动物岛', '狐猴、猴面包树、孤岛演化', 'Madagascar wildlife documentary, ring-tailed lemurs among iconic baobab trees, chameleons and unique dry forest ecology at sunrise', 'people, text, logo, cartoon, low quality'),
    expandedStylePreset('african-river-kingdom', '非洲大河文明', '尼罗河与赞比西河、瀑布、河岸生活', 'African great-river epic, vast waterfall and river valley, adult riverside communities, fishing boats, wildlife and monumental mist-filled sunrise'),
    expandedStylePreset('baobab-savanna', '猴面包树草原', '巨树、暮色、村落与草原生命', 'baobab savanna drama, monumental ancient baobab trees beside a small African village, grazing animals, adult residents and saturated violet-orange twilight'),
    ...REGIONAL_STORY_PRESETS.map(preset => ({
        ...expandedStylePreset(preset.key, preset.label, preset.hint, regionalVisualDirection(preset), 'text, logo, watermark, inconsistent cultural details, anachronistic props, malformed anatomy, low quality'),
        previewPrompt: buildRegionalPreviewPrompt(preset)
    }))
]

/** Apply the registered beauty-anchor policy to hand-authored and expanded presets alike. */
export const VISUAL_STYLE_PRESETS: VisualStylePreset[] = RAW_VISUAL_STYLE_PRESETS.map(style => ({
    ...style,
    imagePromptPrefix: isLiveActionHumanStyle(style)
        ? style.imagePromptPrefix.replaceAll(BEAUTY_PREFIX, LIVE_ACTION_BEAUTY_PREFIX)
        : style.imagePromptPrefix
}))

export function getVisualStyle(key: string | undefined): VisualStylePreset {
    return VISUAL_STYLE_PRESETS.find(s => s.key === key) ?? VISUAL_STYLE_PRESETS.find(s => s.key === DEFAULT_VISUAL_STYLE_KEY) ?? VISUAL_STYLE_PRESETS[0]
}

/** Resolve a project style from its persisted visual-language snapshot. */
export function getVisualStyleForSetup(setup: Pick<NovelSetup, 'visualStyle' | 'visualStyleProfile'> | null | undefined): VisualStylePreset {
    const style = getVisualStyle(setup?.visualStyle)
    return applyVisualStyleProfile(style, setup?.visualStyleProfile)
}

export function getVisualStyleProfile(setupOrKey: Pick<NovelSetup, 'visualStyle' | 'visualStyleProfile'> | string | null | undefined): VisualStyleProfile {
    if (typeof setupOrKey === 'string' || setupOrKey == null) {
        const style = getVisualStyle(setupOrKey ?? undefined)
        return createVisualStyleProfile(style)
    }
    const style = getVisualStyle(setupOrKey.visualStyle)
    return resolveVisualStyleProfile(style, setupOrKey.visualStyleProfile)
}

export function getVisualStylePreviewSrc(style: VisualStylePreset): string {
    return getStylePreviewSrc(style.key)
}

const EMPTY_NOVEL_SETUP: NovelSetup = {
    targetWordCount: undefined,
    primaryGenre: '',
    videoAspectRatio: '9:16',
    episodeFormat: 'micro',
    perspective: '',
    pace: '',
    tone: '',
    appealTags: [],
    coreSeed: '',
    worldBible: '',
    plotArchitecture: '',
    characterArcs: '',
    styleReferenceImages: [],
    styleReferencePrompt: '',
    mainCharacters: [],
    supportingCharacters: [],
    relationships: '',
    outline: '',
    keyPlots: [],
    episodeStatePlan: [],
    factLedger: [],
    fieldSources: {},
    promptVersions: {},
    visualStyle: DEFAULT_VISUAL_STYLE_KEY,
    visualStyleProfile: createVisualStyleProfile(getVisualStyle(DEFAULT_VISUAL_STYLE_KEY))
}

export function parseNovelSetup(raw: string | null | undefined): NovelSetup {
    if (!raw) return { ...EMPTY_NOVEL_SETUP, visualStyleProfile: getVisualStyleProfile(DEFAULT_VISUAL_STYLE_KEY) }
    try {
        const parsed = JSON.parse(raw) as Partial<NovelSetup>
        const merged = { ...EMPTY_NOVEL_SETUP, ...parsed }
        const style = getVisualStyle(merged.visualStyle)
        return {
            ...merged,
            visualStyle: style.key,
            visualStyleProfile: resolveVisualStyleProfile(style, parsed.visualStyleProfile)
        }
    } catch {
        return { ...EMPTY_NOVEL_SETUP, visualStyleProfile: getVisualStyleProfile(DEFAULT_VISUAL_STYLE_KEY) }
    }
}

export function stringifyNovelSetup(setup: NovelSetup): string {
    return JSON.stringify(setup)
}
