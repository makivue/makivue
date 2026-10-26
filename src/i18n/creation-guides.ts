import { editorialTranslations } from './creation-editorial-translations'
import type { EditorialEdition } from './creation-editorial-types'
import type { SeoPageSlug } from '@/lib/seo-pages'
import { guideLocales, guideSlugs, type GuideLocale, type GuideSlug } from './creation-guide-config'

export { guideLocales, guideSlugs, isGuideLocale, isGuideSlug, type GuideLocale, type GuideSlug } from './creation-guide-config'
export const guidesUpdated = '2026-10-23'

type GuideSection = { id: string; heading: string; paragraphs: string[]; checklist?: string[]; example?: string }
export type CreationGuide = {
    title: string
    description: string
    keywords: string[]
    heading: string
    intro: string
    sections: GuideSection[]
    faqs: Array<{ question: string; answer: string }>
    feature: SeoPageSlug
    action: '/' | '/aivideo'
}

const baseGuideIndexCopy = {
    en: {
        title: 'AI Video Guides: Scripts, Shots & Characters',
        description: 'Learn script to video AI, manga storyboards, consistent characters and anime production with makivue guides, written examples and production checklists.',
        heading: 'Make your next AI story, one clear step at a time',
        intro: 'Choose the task you are working on. Each guide includes a workflow, a written example and checks to complete before spending credits on video.',
        label: 'AI creation guides',
        contents: 'In this guide',
        example: 'Written example to adapt',
        faq: 'Questions about this workflow',
        related: 'Continue your production',
        feature: 'Explore the related creation tool',
        action: 'Start creating',
        pricing: 'Check model pricing',
        walkthrough: 'Read the full studio walkthrough',
        credits: 'New accounts receive 1,000 signup credits. Generation uses credits according to the model and usage; the bonus does not guarantee a complete video or series.',
        updated: 'Updated',
        byline: 'makivue editorial team'
    },
    zh: {
        title: 'AI 视频创作指南：剧本转视频、漫画分镜与角色一致性',
        description:
            '学习小说剧本转视频、AI 漫画分镜、跨镜头角色一致性、图生视频提示词与 AI 漫剧制作。包含操作步骤、文字示例和生成前检查，连接 makivue 创作工具。每篇提供可改写示例、常见问题与检查清单，帮助规划返工和生成预算。',
        heading: '从具体问题开始，完成你的下一段 AI 故事',
        intro: '选择你正在制作的环节，查看对应工作流、可改写的文字示例和生成前检查，先确认内容，再投入视频生成费用。',
        label: 'AI 创作专题指南',
        contents: '本篇目录',
        example: '可改写的文字示例',
        faq: '这个工作流的常见问题',
        related: '继续完成作品',
        feature: '了解相关创作工具',
        action: '开始创作',
        pricing: '查看模型与费用',
        walkthrough: '查看完整工作室使用教程',
        credits: '新账户注册赠送 1000 金币。生成按所选模型和实际用量扣费，赠送金币不保证足够完成一部视频或整部短剧。',
        updated: '更新日期',
        byline: 'makivue 编辑团队'
    }
} satisfies Record<'en' | 'zh', Record<string, string>>

// Editorial content is maintained per published language, independently of UI messages.
const baseGuides: Record<'en' | 'zh', Record<GuideSlug, CreationGuide>> = {
    en: {
        'script-to-video': {
            title: 'Script to Video AI Tutorial — Story to Short Drama',
            description: 'Turn a script or novel into an AI short drama with makivue. Plan scenes, characters, storyboards and video, then review an example before making an episode.',
            keywords: ['script to video ai', 'story to video ai', 'novel to video', 'turn a script into a video', 'AI short film from script', 'script to video tutorial', 'novel adaptation workflow'],
            heading: 'Script to video AI: from a written scene to an episode',
            intro: 'A script-to-video workflow turns dialogue and story beats into shots you can review. In makivue, start with an idea, novel excerpt or script, then build an episode through characters, scenes, storyboards and generated clips.',
            feature: 'ai-short-drama-generator',
            action: '/',
            sections: [
                {
                    id: 'prepare-script',
                    heading: 'Prepare a script or adapt a novel excerpt',
                    paragraphs: [
                        'Choose one scene with a clear location, a small cast and a visible turning point. When adapting prose, convert internal thoughts into observable actions or short spoken lines. A scene that can be understood visually is easier to turn into usable shots.',
                        'On the home creation form, enter your idea or source text and choose the content language, visual style and episode count. Review the generated outline and episode script before making images. For a novel, start with one excerpt and check the adaptation before expanding the series.'
                    ],
                    checklist: ['Name the characters and location consistently.', 'Give each scene a goal, obstacle and change.', 'Keep spoken dialogue separate from action descriptions.']
                },
                {
                    id: 'example',
                    heading: 'Worked example: story to video in three shots',
                    paragraphs: [
                        'Use the following original scene to plan a short test. The three beats establish the setting, reveal new information and show a reaction. This is a written planning example, with the final timing chosen to fit the selected video model.'
                    ],
                    example:
                        'Scene: a quiet station at dusk. Lina wears a blue coat and carries a red envelope.\nShot 1 — Wide: Lina waits alone beside the station clock. The camera stays still.\nShot 2 — Close-up: her hand opens the red envelope. Inside is a ticket dated tomorrow.\nShot 3 — Medium: Lina looks toward the empty platform and says, “Then I still have time.”'
                },
                {
                    id: 'references',
                    heading: 'Build references before generating the episode',
                    paragraphs: [
                        'Create a character reference for Lina and a scene reference for the station. Reuse the same coat, envelope and lighting descriptions in the storyboards. Check the close-up and wider shots together: the envelope should keep its color, and the station clock should remain in a consistent position.',
                        'Generate storyboard keyframes first. If a single shot asks the character to open the envelope, read a letter, run across the platform and speak, split it into smaller shots before generating video.'
                    ]
                },
                {
                    id: 'assemble',
                    heading: 'Generate clips, then assemble the short drama',
                    paragraphs: [
                        'Choose a video model for each shot using its supported references, duration and audio options. Review the face, action and dialogue in each result, regenerate only the shots that need changes, then assemble the episode in the project.',
                        'Check subtitle timing and scene transitions in the final video. A longer short film needs multiple generated clips; a single request remains subject to the selected model’s clip limits. Compare the pricing options before producing a full series.'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'Can I turn a novel into a video with AI?',
                    answer: 'Yes. Use an excerpt or script as the starting text, review the episode outline and turn narration into visible actions. Build character references and storyboards, then generate clips and assemble the episode. Check the adaptation scene by scene.'
                },
                {
                    question: 'What is the difference between text to video and script to video?',
                    answer: 'Text to video usually creates a clip from a prompt. A script-to-video workflow also plans scenes, dialogue, character references and shot order so multiple clips can form a continuous story.'
                },
                {
                    question: 'Can I try script to video AI for free?',
                    answer: 'New accounts receive 1,000 signup credits. Text, image and video generation consume credits according to the model and actual usage. The allowance may cover experiments, but does not guarantee a completed short film.'
                }
            ]
        },
        'manga-storyboard': {
            title: 'AI Manga Storyboard Tutorial — Plot to Panels',
            description: 'Plan an AI manga storyboard from a plot: break down actions, framing and dialogue, then create keyframes. Follow a five-panel example and shot review checklist.',
            keywords: [
                'ai manga storyboard generator from plot',
                'manga ai storyboard generator plot to panels',
                'AI manga storyboard',
                'plot to storyboard',
                'manga panel planning',
                'manga storyboard tutorial',
                'manga shot composition'
            ],
            heading: 'AI manga storyboards: turn a plot into a clear panel sequence',
            intro: 'Start with a plot beat, decide what the reader or viewer must see, and break it into distinct panels or shots. makivue connects structured storyboards to character and scene references for an animated drama workflow.',
            feature: 'ai-storyboard-generator',
            action: '/',
            sections: [
                {
                    id: 'plot',
                    heading: 'Reduce the plot to visible beats',
                    paragraphs: [
                        'A plot summary describes what happens; a storyboard decides when the audience sees each detail. Write down the character’s goal, the new information and the reaction. Assign one main storytelling job to each panel before writing image prompts.',
                        'For a manga-inspired short, choose a visual style in the project and prepare the characters and location. Review the episode script, then generate a storyboard. Treat a panel as a planning unit; video duration and camera movement are additional decisions.'
                    ]
                },
                {
                    id: 'panels',
                    heading: 'Example: plot to panels for a rooftop reveal',
                    paragraphs: [
                        'The plot is simple: a courier discovers that the rooftop signal comes from her missing brother. This planning example uses five panels so the reveal does not compete with the establishing action.'
                    ],
                    example:
                        'Panel 1 — Wide: a courier in a yellow jacket steps onto a rainy rooftop.\nPanel 2 — Detail: a small radio flashes beside a puddle.\nPanel 3 — Medium: she picks up the radio; her hand trembles.\nPanel 4 — Close-up: her brother’s familiar keychain hangs from the radio.\nPanel 5 — Reaction: she turns toward the staircase. Dialogue: “You were here.”'
                },
                {
                    id: 'continuity',
                    heading: 'Keep panel direction and character design coherent',
                    paragraphs: [
                        'Reuse the courier’s reference image and keep the jacket, hairstyle and keychain unchanged. Decide which side of the rooftop contains the staircase, then check that reactions and eyelines preserve that geography. A detail panel should reveal an object already established in the scene.',
                        'Generate keyframes and review them as a sequence. If a pose or prop changes unexpectedly, revise the affected frame before generating motion. For manga-style images, keep line treatment, shading and palette consistent across prompts.'
                    ],
                    checklist: [
                        'One main action or revelation per panel.',
                        'A clear wide shot before detail-heavy coverage.',
                        'Short dialogue that fits the intended shot duration.',
                        'Consistent object positions and screen direction.'
                    ]
                },
                {
                    id: 'video',
                    heading: 'Move from manga panels to animated shots',
                    paragraphs: [
                        'Translate each panel into a motion instruction: a step forward, a flashing light, a hand lifting the radio or a restrained head turn. Select supported video durations and reference modes, then review motion before assembling the sequence.',
                        'makivue’s storyboard workflow is aimed at generated video and episodes. This guide describes panel planning and keyframes; check your separate page-layout requirements if the deliverable is a print comic or a formatted manga page.'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'Can AI create a manga storyboard from a plot?',
                    answer: 'AI can help expand a plot into scenes and structured shots. Review the action, framing and dialogue, connect character and scene references, and generate keyframes. Human review is still needed for panel rhythm and continuity.'
                },
                {
                    question: 'How many actions should a manga panel contain?',
                    answer: 'Start with one main action or revelation. Split a panel when it needs several successive gestures or a long exchange. For video, also check whether the action and dialogue fit the model’s supported duration.'
                },
                {
                    question: 'Does this export a finished manga page?',
                    answer: 'The workflow described here prepares storyboards and keyframe images for video. It does not promise a finished comic-page layout, speech-bubble typesetting or print export.'
                }
            ]
        },
        'consistent-ai-characters': {
            title: 'Consistent AI Characters — References & Face Drift',
            description: 'Keep AI characters consistent with reference images, stable descriptions and storyboard checks. Troubleshoot face drift and review drama shots with makivue.',
            keywords: [
                'consistent character ai',
                'consistent AI characters across images',
                'same character in different scenes AI',
                'AI video character consistency',
                'character reference image',
                'AI character consistency guide',
                'fix AI character face drift'
            ],
            heading: 'How to keep AI characters consistent across scenes',
            intro: 'Character consistency starts before video generation. Establish a reference, reuse recognizable details, and review each shot against that reference. makivue projects keep character assets connected to the storyboard workflow.',
            feature: 'ai-storyboard-generator',
            action: '/',
            sections: [
                {
                    id: 'reference',
                    heading: 'Choose a clear character reference image',
                    paragraphs: [
                        'Create a readable reference with an unobstructed face and a recognizable hairstyle and outfit. Check its proportions before using it across the project. A heavily shadowed face or tiny figure gives later shots less reliable visual information.',
                        'Keep the approved character image in the project and associate the correct character with each storyboard. When the selected model supports reference images, use the approved reference rather than generating each shot independently from a new description.'
                    ]
                },
                {
                    id: 'description',
                    heading: 'Separate identity details from shot instructions',
                    paragraphs: [
                        'Keep age range, facial features, hairstyle, clothing and distinctive accessories stable. Change the pose, expression and framing to suit the scene. Replacing the whole description for a new angle can accidentally change the character’s identity.',
                        'For a costume change, describe it as a deliberate story event and update the relevant shots together. For a sequence that happens in one location and time, avoid changing wardrobe or the style preset halfway through.'
                    ],
                    example:
                        'Stable identity — Lina, an adult woman with a short black bob, a blue coat and a red shoulder bag.\nShot A — Medium profile at the station window, waiting quietly.\nShot B — Close-up of the same Lina turning toward the clock. Keep the hairstyle, coat and bag unchanged.'
                },
                {
                    id: 'check',
                    heading: 'Compare keyframes before animating',
                    paragraphs: [
                        'Review neighboring storyboard images together, especially when moving between a wide shot and a close-up. Compare facial structure, hairline, outfit colors and props. Fix the source image when those details already drift in the keyframe.',
                        'For two-character scenes, confirm which reference belongs to each person and make their positions unambiguous. Similar outfits and crowded compositions can make identity errors harder to notice until video has already been generated.'
                    ],
                    checklist: [
                        'Same facial features and hair in adjacent shots.',
                        'Stable outfit colors and accessory placement.',
                        'Correct character references for each shot.',
                        'Consistent visual style and scene lighting.'
                    ]
                },
                {
                    id: 'repair',
                    heading: 'Repair the first point where identity drifts',
                    paragraphs: [
                        'If the keyframe is wrong, correct it before generating another clip. If the keyframe is correct but the face changes during motion, try a simpler action or a shorter supported duration, and compare another suitable model if needed.',
                        'Reference images improve control but cannot guarantee identical results in every frame. Review the actual video and regenerate affected shots. Reusing a project reference is a production aid, with results still dependent on the model and requested motion.'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'Can I generate the same AI character in different scenes?',
                    answer: 'Use the same approved character reference and stable identity description across the project. Change the location and action while retaining the recognizable features. Review each keyframe and clip because model output can still vary.'
                },
                {
                    question: 'Why does an AI character change during a video?',
                    answer: 'Fast movement, occlusion, extreme angles and ambiguous references can increase drift. Check whether the starting image is already inconsistent, simplify the action and regenerate only the affected shot.'
                },
                {
                    question: 'Does a character reference guarantee perfect consistency?',
                    answer: 'No. References and consistent descriptions guide generation, but the video model can still change features or clothing. Inspect neighboring frames and the generated motion before assembling an episode.'
                }
            ]
        },
        'image-to-video': {
            title: 'Image to Video AI Guide — Prompts & Keyframes',
            description: 'Animate a reference image with AI. Learn image to video prompts, first and last frames, camera motion and clip checks with a makivue production example.',
            keywords: [
                'image to video ai',
                'ai image to video generator',
                'animate a picture with AI',
                'image to video prompt',
                'first and last frame AI video',
                'image to video tutorial',
                'AI camera motion prompts'
            ],
            heading: 'Image to video AI: give a still image a clear motion plan',
            intro: 'Use an image as a visual starting point, then describe what should move, how the camera behaves and where the shot ends. Start in makivue’s AI video tool for one clip, or use storyboard keyframes inside a short-drama project.',
            feature: 'ai-video-generator',
            action: '/aivideo',
            sections: [
                {
                    id: 'image',
                    heading: 'Prepare a reference that supports the motion',
                    paragraphs: [
                        'Choose a clear image with the subject visible and enough space for the planned movement. Check faces, hands and object shapes before animating. If the subject needs to walk to the right, a tight crop against the right edge leaves little visual context for that action.',
                        'Open the AI video tool and select a model that supports your image-reference mode. Available aspect ratios, durations, audio options and first/last frame inputs depend on that model. Match the image framing to the intended output when possible.'
                    ]
                },
                {
                    id: 'prompt',
                    heading: 'Write an image-to-video prompt about change',
                    paragraphs: [
                        'The reference already describes much of the appearance. Use the prompt to describe a visible action, its pace and one camera instruction. Keep stable details explicit when they matter, and avoid asking for several scene changes inside a short clip.',
                        'A slow head turn or drifting steam is easier to inspect than a character running, turning, speaking and handing over an object in the same shot. Test the simplest version first, then increase complexity after reviewing the result.'
                    ],
                    example:
                        'Use the supplied station image as the starting composition. Lina slowly turns her head toward the clock. Her blue coat and red shoulder bag remain unchanged. The camera stays at eye level with a gentle push-in. Keep the station layout and dusk lighting stable.'
                },
                {
                    id: 'keyframes',
                    heading: 'When to use a first frame and a last frame',
                    paragraphs: [
                        'A first frame establishes the shot’s starting image. A last frame can describe the desired endpoint when the selected model supports both inputs. Keep the two images compatible in character identity, location and camera direction.',
                        'A close-up of a face followed by an unrelated aerial city view asks for a large transition. For a continuous drama scene, choose an endpoint that follows naturally from the initial pose, or split the transition into separate shots.'
                    ]
                },
                {
                    id: 'review',
                    heading: 'Review motion and cost before scaling up',
                    paragraphs: [
                        'Play the clip from beginning to end and check for face changes, extra fingers, unintended camera motion and objects appearing or disappearing. If the first image is wrong, repair that image; if only the motion is wrong, revise the movement instruction.',
                        'For a full episode, generate individual shots from approved storyboards and assemble them in the project. New accounts receive 1,000 signup credits; usage is charged by model and generation amount. Compare pricing before repeating several video attempts.'
                    ],
                    checklist: [
                        'The action follows the supplied image.',
                        'The subject keeps recognizable details.',
                        'Camera movement matches the prompt.',
                        'The final frame can connect to the next shot.'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'How do I animate a picture with AI?',
                    answer: 'Choose an image-capable video model, supply the picture and describe one main movement. Select supported duration and aspect-ratio settings, generate the clip and review the entire motion before downloading or assembling it.'
                },
                {
                    question: 'Can I control the first and last frame?',
                    answer: 'Some models support both starting and ending images. Check the selected model’s controls and use images with compatible characters and composition. Endpoint references guide generation but do not guarantee every intermediate frame.'
                },
                {
                    question: 'Is image to video AI free to try?',
                    answer: 'New makivue accounts receive 1,000 credits. Video generation uses those credits according to the chosen model and usage. Additional attempts require enough account balance; this is not unlimited free generation.'
                }
            ]
        },
        'ai-anime-video': {
            title: 'AI Anime Video Tutorial — Story to Animated Short',
            description: 'Make an AI anime short with makivue: plan a script, consistent characters, style references and keyframes, then review animated shots, audio and editing.',
            keywords: [
                'AI anime video generator',
                'text to anime video',
                'AI anime short film',
                'anime story to video',
                'AI animated story maker',
                'AI anime video tutorial',
                'anime character references'
            ],
            heading: 'Make an AI anime video from an original story',
            intro: 'An anime short needs more than a single stylized image. Plan a story, establish the character design and use a coherent sequence of shots to turn that artwork into an animated scene.',
            feature: 'ai-short-drama-generator',
            action: '/',
            sections: [
                {
                    id: 'story',
                    heading: 'Start text-to-anime video with a small scene',
                    paragraphs: [
                        'Choose a short conflict that can be shown in one location with one or two characters. Enter the premise in the creation form, choose an anime-oriented visual style and review the generated story and episode script.',
                        'For the first test, aim for a readable beginning, a reveal and a reaction. A simple scene helps you judge the art direction and character performance before committing to many episodes.'
                    ]
                },
                {
                    id: 'style',
                    heading: 'Define the anime style and character design together',
                    paragraphs: [
                        'Use the style library to choose a direction such as anime, animation-film or manga-inspired visuals. Keep the palette, shading and character proportions stable across the character, scene and storyboard images.',
                        'Approve a reference for each character. Reuse hairstyle, outfit and distinguishing details rather than rewriting the design for every shot. Preview the character against the chosen environment to catch mismatched styles early.'
                    ],
                    example:
                        'Original scene — An apprentice astronomer finds a glowing map on an observatory desk.\nStyle — Clean linework, restrained cel shading, deep-blue night palette and warm desk light.\nShot plan — Establish the observatory; show the map beginning to glow; hold on the apprentice’s surprised reaction.'
                },
                {
                    id: 'shots',
                    heading: 'Animate one story beat per shot',
                    paragraphs: [
                        'Generate the storyboard images and check their sequence before adding motion. For the observatory scene, separate the establishing view, the glowing map and the reaction. Keep complicated hand movements or long dialogue out of an already busy shot.',
                        'Choose a video model based on supported reference images, duration and audio needs. Describe the main movement and camera behavior clearly. An anime-style reference guides the look, but the generated motion still needs review for face drift and unstable linework.'
                    ],
                    checklist: [
                        'The character design matches across all keyframes.',
                        'The scene palette stays coherent.',
                        'Each shot contains one readable story beat.',
                        'Dialogue and action fit the chosen clip duration.'
                    ]
                },
                {
                    id: 'finish',
                    heading: 'Assemble and check the animated short',
                    paragraphs: [
                        'Review generated clips individually, replace weak shots and assemble the episode. Check the cut from the desk detail to the reaction: the light direction and character eyeline should connect. Verify any generated dialogue and subtitles in the final sequence.',
                        'A single anime image can be made with the image tool; a single moving clip can be made with the video tool. Use the drama project for a continuous anime story with shared characters and multiple shots. Costs depend on the models and the amount of generation.'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'Can I make anime videos from text?',
                    answer: 'Start with text to develop the story and episode script, choose an anime visual style, create character and scene references, then generate storyboard images and clips. Assemble the approved shots into an episode.'
                },
                {
                    question: 'Is an AI anime image generator enough for a short film?',
                    answer: 'It can create the artwork, but a short film also needs shot planning, motion, scene continuity and final assembly. Use image references to guide video generation and review the animated result.'
                },
                {
                    question: 'Can I make an anime series with the same characters?',
                    answer: 'A project can keep character and scene references for multiple episodes. Reuse those assets and review every storyboard and clip for consistency. References help continuity, while results still depend on the selected models.'
                }
            ]
        }
    },
    zh: {
        'script-to-video': {
            title: 'AI 剧本转视频教程：把小说故事做成短剧',
            description:
                '从小说片段或已有剧本开始，学习 AI 剧本转视频的分集改编、角色设计、分镜生成与短剧合成。包含三镜头示例，帮助你先验证片段再制作整集。了解小说改编、镜头拆分和声音衔接的准备方法，确认角色与场景后再投入整集制作。',
            keywords: ['AI剧本转视频', '小说转视频', '小说转短剧', '故事生成视频', '文字生成短剧', 'AI短片制作教程', '剧本生成短剧教程', '小说改编AI短剧'],
            heading: 'AI 剧本转视频：从文字场景到可观看的一集短剧',
            intro: '剧本转视频需要把文字里的动作、对白和转折落实为可检查的镜头。在 makivue 中，从故事创意、小说片段或已有剧本开始，依次确认角色、场景、分镜与视频，再合成为单集。',
            feature: 'ai-short-drama-generator',
            action: '/',
            sections: [
                {
                    id: 'prepare-script',
                    heading: '先整理适合视频表达的小说或剧本片段',
                    paragraphs: [
                        '选择地点明确、人物较少、有一个清晰转折的场景。小说中的心理活动可以改写成可见动作或简短对白，例如把“她开始犹豫”改成“她握住门把手，又慢慢松开”。画面能表达的内容越明确，后续拆镜越容易。',
                        '在首页创作表单输入故事或原文，选择内容语言、画风和集数。先检查故事大纲与分集剧本，再生成图片。改编长篇小说时，建议先验证一个片段的节奏和人物表现，再扩展成连续剧。'
                    ],
                    checklist: ['统一人物称呼与场景名称。', '让每场戏包含目标、阻碍和变化。', '把对白与动作分开描述，避免大量抽象旁白。']
                },
                {
                    id: 'example',
                    heading: '三镜头示例：把故事转成视频计划',
                    paragraphs: ['下面的原创场景依次交代环境、展示新信息、给出人物反应。它是可改写的文字规划示例，实际时长需要根据所选视频模型调整。'],
                    example:
                        '场景：黄昏的安静车站。林娜穿蓝色外套，拿着红色信封。\n镜头一——全景：林娜独自站在车站时钟旁等待，镜头固定。\n镜头二——特写：她打开红色信封，里面是一张日期写着明天的车票。\n镜头三——中景：她望向空站台，说：“那我还来得及。”'
                },
                {
                    id: 'references',
                    heading: '先固定角色和场景，再进入 AI 分镜生成',
                    paragraphs: [
                        '为林娜建立角色参考图，为车站准备场景参考。分镜中沿用外套、信封和光线描述，把近景与全景放在一起检查：信封颜色应一致，时钟的位置也应符合空间关系。',
                        '先生成分镜关键帧。如果一个镜头同时要求人物拆信、阅读、奔跑和长段说话，应先拆成多个镜头。关键帧阶段修正角色与构图，通常比视频生成后才发现问题更容易控制返工。'
                    ]
                },
                {
                    id: 'assemble',
                    heading: '逐镜生成视频，检查后合成短剧',
                    paragraphs: [
                        '根据参考方式、时长和原声需求选择视频模型。逐个检查人物、动作和对白，对不满意的镜头单独重做，再在项目中按顺序合成单集。',
                        '最后检查字幕时间、声音和镜头衔接。较长短片需要多个视频片段，一次生成仍受模型时长限制。制作整部连续剧前，先查看模型与费用，用小样片判断画风和预算是否合适。'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'AI 可以把小说自动生成视频吗？',
                    answer: '可以从小说片段开始生成故事和分集，再把旁白改成可见动作，建立角色、场景与分镜参考，逐镜生成视频后合成。需要检查改编结果，尤其是人物关系、剧情转折和对白。'
                },
                { question: '文生视频和剧本转视频有什么区别？', answer: '文生视频通常根据一段提示生成一个片段；剧本转视频还要规划场景、对白、角色参考和镜头顺序，让多个片段构成连贯故事。' },
                {
                    question: 'AI 剧本转视频可以免费体验吗？',
                    answer: '新账户注册赠送 1000 金币，文本、图片和视频按模型及实际用量扣费。赠送额度可用于尝试，不保证足够生成完整短片，继续生成需要有足够余额。'
                }
            ]
        },
        'manga-storyboard': {
            title: 'AI 漫画分镜教程：从故事大纲到镜头画面',
            description:
                '把故事大纲拆成 AI 漫画分镜，规划景别、动作、对白与关键帧。通过五格文字示例学习漫剧镜头衔接、角色一致性及后续动画生成。进一步学习机位、角色视线与动作节拍，先检查画面顺序，再进入首尾帧和视频制作。',
            keywords: ['AI漫画分镜生成器', '故事大纲生成分镜', '漫画分镜脚本', 'AI漫剧分镜', '小说自动拆分镜', '漫画分镜教程', '漫画分镜构图', 'AI分镜拆镜教程'],
            heading: 'AI 漫画分镜：把故事大纲拆成观众看得懂的画面',
            intro: '先确定每个剧情信息应该在哪一格出现，再逐格规划人物、景别和动作。makivue 的结构化分镜可以关联角色与场景参考，为后续漫剧关键帧和视频制作提供依据。',
            feature: 'ai-storyboard-generator',
            action: '/',
            sections: [
                {
                    id: 'plot',
                    heading: '把故事大纲还原为可见的剧情节点',
                    paragraphs: [
                        '大纲说明发生了什么，分镜决定观众什么时候看到关键信息。先写出人物目标、新发现和反应，再给每格分配一个主要任务。不要把几次连续动作、人物内心和长对白挤在一格里。',
                        '制作漫画风格短剧时，先选择画风，准备角色和场景，确认分集剧本后生成分镜。漫画格可以作为画面规划单位；转成视频时，还要单独决定时长和运镜。'
                    ]
                },
                {
                    id: 'panels',
                    heading: '五格示例：天台上的失踪线索',
                    paragraphs: ['剧情是“快递员发现天台信号来自失踪的哥哥”。拆成五格后，环境、线索、动作、确认和反应各有位置，观众能跟上信息出现的顺序。'],
                    example:
                        '第一格——全景：穿黄色外套的快递员走上雨中的天台。\n第二格——细节：水洼旁，一台小收音机闪着灯。\n第三格——中景：她拿起收音机，手微微发抖。\n第四格——特写：收音机上挂着哥哥常用的钥匙扣。\n第五格——反应：她回头望向楼梯口，说：“你来过这里。”'
                },
                {
                    id: 'continuity',
                    heading: '检查漫画分镜的方向、人物和道具',
                    paragraphs: [
                        '沿用同一角色参考，固定发型、黄色外套与钥匙扣。先确定楼梯口在天台哪一侧，再检查人物转头方向和视线是否保持空间关系。特写展示的道具，应当能在前面的场景中找到来源。',
                        '关键帧生成后，把相邻画面一起看。如果姿势或道具突然变化，应先改关键帧，再投入视频生成。漫画画面还需要固定线条、阴影和色板，避免镜头之间画风跳变。'
                    ],
                    checklist: ['每格只承担一个主要动作或信息。', '先交代环境，再进入细节特写。', '对白长度与后续视频时长匹配。', '道具位置、视线与运动方向连续。']
                },
                {
                    id: 'video',
                    heading: '从漫画格过渡到动画镜头',
                    paragraphs: [
                        '为每格补上明确的动作说明，例如迈步、指示灯闪烁、拿起收音机、轻微转头。根据所选模型设置时长和参考方式，先检查每个片段的动作，再连接成完整场景。',
                        '这里的工作流面向分镜图片与视频制作。如果最终交付物是印刷漫画或排版漫画页，还需要另行确认页面布局、气泡文字和印刷导出的要求。'
                    ]
                }
            ],
            faqs: [
                {
                    question: 'AI 能从故事大纲自动生成漫画分镜吗？',
                    answer: 'AI 可以帮助把大纲展开为场景和结构化镜头。确认动作、景别和对白后，关联角色与场景参考并生成关键帧，仍需人工检查节奏和连续性。'
                },
                {
                    question: '一格漫画分镜适合放几个动作？',
                    answer: '建议先安排一个主要动作或信息。如果包含连续手势、复杂交接或长对白，应拆成更多格；后续制作视频时，再核对动作是否能在模型支持的时长内完成。'
                },
                { question: '可以直接导出排好版的漫画页吗？', answer: '本教程介绍的是用于视频制作的分镜与关键帧，不承诺漫画页排版、对白气泡排字或印刷格式导出。' }
            ]
        },
        'consistent-ai-characters': {
            title: 'AI 角色一致性教程：跨场景保持同一个人物',
            description:
                '学习用角色参考图、固定外貌描述与分镜检查改善 AI 人物一致性。覆盖同一角色多场景生成、视频变脸排查和局部重做。从发型、服装、道具和光线建立连续性检查，识别人物漂移原因，再针对问题镜头调整参考与提示词。',
            keywords: ['AI角色一致性', 'AI人物一致性', '同一角色不同场景', 'AI视频人物变脸', '角色参考图', 'AI短剧角色一致性', 'AI人物变脸解决方法', '角色多角度参考图'],
            heading: '如何让 AI 角色在不同场景和镜头中保持一致',
            intro: '角色一致性需要从视频生成前开始建立。先确认参考图，固定能识别人物的细节，再逐镜比对。makivue 项目将角色资产连接到分镜流程，便于连续制作时复用。',
            feature: 'ai-storyboard-generator',
            action: '/',
            sections: [
                {
                    id: 'reference',
                    heading: '选择外貌清晰的角色参考图',
                    paragraphs: [
                        '参考图应能看清脸部、发型与服装，人物比例也要先确认。面部被大面积阴影遮住、人物过小或配饰混乱，会让后续镜头缺少可靠的视觉依据。',
                        '把确认的角色图保存在项目中，并在分镜里关联正确人物。所选模型支持图片参考时，沿用已确认素材，避免每个镜头都从一段全新外貌描述独立生成。'
                    ]
                },
                {
                    id: 'description',
                    heading: '把人物身份细节与镜头动作分开',
                    paragraphs: [
                        '年龄段、五官、发型、衣服和标志性配饰应保持稳定；姿势、表情与景别则随剧情变化。换一个机位就重写整段外貌，很容易让模型把角色当成另一个人。',
                        '需要换装时，把它视为明确的剧情变化，并同步修改相关镜头。同一地点、同一时间的连续场景，不宜无意更换衣服、发色或画风预设。'
                    ],
                    example: '固定身份——林娜，成年女性，黑色短发，蓝色外套，红色单肩包。\n镜头 A——车站窗边的侧面中景，安静等待。\n镜头 B——同一个林娜转头望向时钟的近景，保持发型、外套和包不变。'
                },
                {
                    id: 'check',
                    heading: '先对比分镜关键帧，再生成动作',
                    paragraphs: [
                        '把相邻分镜放在一起看，尤其检查全景切近景时的脸型、发际线、衣服颜色和手中道具。关键帧中已经出现的差异，应先修正源图。',
                        '双人场景要确认每张参考图对应谁，并明确左右站位。相似服装和过于拥挤的构图，会让身份混淆更难及时发现。'
                    ],
                    checklist: ['相邻镜头的五官与发型相符。', '衣服颜色和配饰位置稳定。', '每个分镜绑定了正确的角色。', '画风与场景光线保持连贯。']
                },
                {
                    id: 'repair',
                    heading: '从最早发生漂移的环节修正',
                    paragraphs: [
                        '关键帧错误时，先修图；关键帧正确但运动中变脸时，尝试更简单的动作或更短的受支持时长，必要时对比其他适合的模型。只重做受影响镜头，减少连续试错的费用。',
                        '参考图能改善控制，但不能保证每帧完全相同。视频模型、遮挡、极端角度和运动幅度都会影响结果，合成前仍要检查实际画面。'
                    ]
                }
            ],
            faqs: [
                {
                    question: '如何让 AI 生成同一个人物的不同场景？',
                    answer: '沿用确认的角色参考和固定外貌描述，只调整地点、动作和构图。逐一检查关键帧与视频，模型结果仍可能有差异，需要对不一致的镜头局部重做。'
                },
                { question: 'AI 视频里人物为什么会突然变脸？', answer: '快速运动、遮挡、极端机位或含糊参考都可能增加漂移。先判断起始图是否已经不一致，再简化动作并重做受影响镜头。' },
                { question: '使用角色参考图就能保证完全一致吗？', answer: '不能保证。参考图和稳定描述提供视觉约束，但模型仍可能改变五官或服装。需要检查相邻画面与实际运动，再合成单集。' }
            ]
        },
        'image-to-video': {
            title: 'AI 图生视频教程：提示词、首尾帧与运镜',
            description:
                '学习把图片生成视频：准备参考图、编写动作提示词、设置首尾帧和运镜，再检查人物与画面稳定性。适合单段素材和 AI 短剧镜头制作。结合文字示例拆解主体运动与镜头运动，了解参考方式的模型差异，减少复杂动作带来的画面漂移。',
            keywords: ['AI图生视频', '图片生成视频', '让图片动起来', '图生视频提示词', '首尾帧生成视频', 'AI视频运镜', '图生视频教程', 'AI视频运动提示词'],
            heading: 'AI 图生视频：让静态图片按照明确的动作计划变化',
            intro: '先用图片确定视觉起点，再用提示词说明谁在动、怎么动、相机如何移动以及镜头在哪里结束。单个片段可在 makivue 视频工具制作，连续短剧则可以从项目分镜关键帧开始。',
            feature: 'ai-video-generator',
            action: '/aivideo',
            sections: [
                {
                    id: 'image',
                    heading: '准备能支撑目标动作的参考图片',
                    paragraphs: [
                        '选择主体清晰、运动空间充足的图片，先检查脸、手和物体形状。人物准备向右行走时，如果起始图已经紧贴右边缘，就缺少动作展开的空间和环境信息。',
                        '打开 AI 视频工具，选择支持目标参考方式的模型。画幅、时长、原声和首尾帧选项取决于模型能力，尽量让图片构图与输出画幅接近。'
                    ]
                },
                {
                    id: 'prompt',
                    heading: '图生视频提示词重点描述变化',
                    paragraphs: [
                        '参考图已经给出了大部分外观信息。提示词可以集中写一个主要动作、动作速度和一条运镜说明，必要时强调要保持不变的细节，避免在短片段里要求多次转场。',
                        '轻微转头或蒸汽飘动比奔跑、回头、说话再递物的组合更容易检查。先测试简单动作，再根据结果逐步增加复杂度。'
                    ],
                    example: '以提供的车站图片作为起始构图。林娜缓慢转头望向时钟，蓝色外套和红色单肩包保持不变。相机保持平视，轻微向前推进。保留车站布局与黄昏光线。'
                },
                {
                    id: 'keyframes',
                    heading: '什么时候使用首帧和尾帧生成视频',
                    paragraphs: [
                        '首帧说明镜头从哪里开始，尾帧在模型支持时说明期望的终点。两张图的人物、地点和镜头方向应当兼容，动作也需要能自然衔接。',
                        '从人物面部特写直接接到无关城市航拍，实际上要求很大的转场。连续短剧可以选择从当前姿态自然变化的尾帧，或把大跨度转场拆为不同镜头。'
                    ]
                },
                {
                    id: 'review',
                    heading: '先检查动作与费用，再批量生成',
                    paragraphs: [
                        '完整播放片段，检查变脸、手指异常、意外运镜和道具消失。如果源图本身错误，先修图；如果只是动作不合适，就调整动作提示词。',
                        '制作整集时，从确认的分镜逐镜生成再合成。新账户注册赠送 1000 金币，视频按模型和用量扣费；多次尝试前先查看费用，判断是否需要减少动作或缩短受支持时长。'
                    ],
                    checklist: ['动作符合起始图和空间关系。', '人物保留原有辨识特征。', '运镜与提示一致。', '结尾画面能够接到下个镜头。']
                }
            ],
            faqs: [
                { question: '如何用 AI 让一张图片动起来？', answer: '选择支持图片参考的视频模型，上传图片并描述一个主要动作，设置支持的时长和画幅，生成后完整检查运动，再下载或用于项目合成。' },
                { question: 'AI 视频能同时控制首帧和尾帧吗？', answer: '部分模型支持。需要确认所选模型的输入选项，并使用人物和构图相互兼容的首尾图。参考可以引导终点，但不保证中间每帧完全符合预期。' },
                { question: 'AI 图生视频可以免费试用吗？', answer: 'makivue 新账户有 1000 注册金币，按模型与用量扣除。继续尝试需要有足够余额，不是无限次免费生成。' }
            ]
        },
        'ai-anime-video': {
            title: 'AI 动漫视频制作教程：从故事到动画短片',
            description:
                '学习 AI 漫剧与动漫视频制作：从文字故事确定画风、角色参考与分镜，逐镜生成动画片段并合成短片，包含原创示例和连续性检查。区分单张动漫图、短片段生成与多镜头动画制作，核对角色服装、场景色板、声音和字幕衔接。',
            keywords: ['AI动漫视频生成', 'AI漫剧制作教程', '文字生成动漫视频', 'AI动画短片制作', 'AI动漫故事生成', 'AI二次元视频', '动漫角色参考图', 'AI动漫视频工作流'],
            heading: '从原创故事开始，制作你的 AI 动漫视频',
            intro: '动漫短片需要把角色设计、故事节奏和镜头串起来。先确定故事，再统一画风和人物参考，通过连续分镜把静态画面逐步变成可观看的动画场景。',
            feature: 'ai-short-drama-generator',
            action: '/',
            sections: [
                {
                    id: 'story',
                    heading: '文字生成动漫视频，先从一场小戏开始',
                    paragraphs: [
                        '选择一个地点、一到两名人物和一个明确冲突，在创作表单输入故事方向，选择动漫画风，再检查生成的大纲与分集剧本。',
                        '初次测试可以只做环境交代、信息揭示和人物反应。这样能先判断角色表现和画风是否合适，再投入多集制作。'
                    ]
                },
                {
                    id: 'style',
                    heading: '同时确定动漫画风与角色设计',
                    paragraphs: [
                        '在风格库中选择日系动漫、动画电影感或漫画分镜等方向。角色、场景和分镜使用相近的色板、阴影方式和人物比例，避免同一个场景里混合差异很大的视觉设定。',
                        '每个角色先确认参考图，固定发型、服装和标志性细节。把角色与场景放在一起检查，可以在视频生成前发现人物与环境不协调的问题。'
                    ],
                    example: '原创场景——天文学徒在观测站桌上发现一张发光星图。\n画风——干净线条、克制赛璐璐阴影、深蓝夜色与暖色台灯。\n镜头计划——先交代观测站，再展示星图亮起，最后停在学徒惊讶的反应。'
                },
                {
                    id: 'shots',
                    heading: '让每个动画镜头只承担一个主要剧情节点',
                    paragraphs: [
                        '先生成分镜图片并检查顺序。观测站示例可以拆成环境、星图和反应三个镜头，复杂手部动作或长对白应避免和多个事件挤在同一段里。',
                        '根据图片参考、时长和原声需求选择视频模型，写清主要动作与运镜。动漫参考图能引导画风，但运动中的变脸、线条抖动和服装漂移仍要逐镜检查。'
                    ],
                    checklist: ['关键帧之间角色设计相符。', '场景色板和光线连续。', '每个镜头有一个清晰剧情节点。', '对白与动作能在支持的时长内完成。']
                },
                {
                    id: 'finish',
                    heading: '合成动画短片，检查声音与镜头衔接',
                    paragraphs: [
                        '先检查单独片段，替换不满意镜头后再合成。桌面特写切到人物反应时，要核对光线方向和视线关系，并在成片里检查原声和字幕。',
                        '只需要一张动漫图时可用图片工具，只需要一段运动素材时可用视频工具。需要共享角色和多镜头连续剧情时，使用短剧项目管理。生成费用取决于模型和实际用量。'
                    ]
                }
            ],
            faqs: [
                {
                    question: '可以只输入文字就制作 AI 动漫视频吗？',
                    answer: '可以从文字展开故事和分集剧本，再选择动漫画风、建立角色场景参考、生成分镜与视频，最后合成为单集。过程需要检查和调整，不能把一次短片段生成等同于完整动画制作。'
                },
                { question: 'AI 动漫图片生成器能直接完成动画短片吗？', answer: '图片工具负责画面素材，动画短片还需要分镜、运动、连续性与合成。可以把生成的图片作为视频参考，再检查实际动画结果。' },
                { question: '能用同一批角色持续制作 AI 漫剧吗？', answer: '项目可以保留角色和场景参考用于后续集数。复用素材并逐镜检查有助于连续性，但结果仍受模型和动作要求影响。' }
            ]
        }
    }
}

const localizedGuideIndexCopy: Record<GuideLocale, typeof baseGuideIndexCopy.en> = {
    ...baseGuideIndexCopy,
    fr: editorialTranslations.fr.guideIndex,
    ar: editorialTranslations.ar.guideIndex,
    id: editorialTranslations.id.guideIndex,
    hi: editorialTranslations.hi.guideIndex,
    fil: editorialTranslations.fil.guideIndex,
    ja: editorialTranslations.ja.guideIndex,
    ko: editorialTranslations.ko.guideIndex
}

function localizeGuideEdition(edition: EditorialEdition): Record<GuideSlug, CreationGuide> {
    return Object.fromEntries(Object.entries(edition.guides).map(([slug, content]) => [slug, { ...baseGuides.en[slug as GuideSlug], ...content }])) as Record<GuideSlug, CreationGuide>
}

export const creationGuides: Record<GuideLocale, Record<GuideSlug, CreationGuide>> = {
    ...baseGuides,
    fr: localizeGuideEdition(editorialTranslations.fr),
    ar: localizeGuideEdition(editorialTranslations.ar),
    id: localizeGuideEdition(editorialTranslations.id),
    hi: localizeGuideEdition(editorialTranslations.hi),
    fil: localizeGuideEdition(editorialTranslations.fil),
    ja: localizeGuideEdition(editorialTranslations.ja),
    ko: localizeGuideEdition(editorialTranslations.ko)
}

export const guideIndexCopy = Object.fromEntries(
    guideLocales.map(locale => [
        locale,
        {
            ...localizedGuideIndexCopy[locale],
            keywords: [...guideSlugs.map(slug => creationGuides[locale][slug].keywords[0]), ...guideSlugs.slice(0, 2).map(slug => creationGuides[locale][slug].keywords.at(-1)!)]
        }
    ])
) as Record<GuideLocale, typeof baseGuideIndexCopy.en & { keywords: string[] }>
