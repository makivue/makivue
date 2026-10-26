import { editorialTranslations } from './creation-editorial-translations'
import type { EditorialEdition } from './creation-editorial-types'
import { toolLocales, toolSlugs, type ToolLocale, type ToolSlug } from './creation-tool-config'

export type CreationTool = {
    title: string
    description: string
    keywords: string[]
    heading: string
    intro: string
    action: '/aiimage' | '/aivideo'
    actionLabel: string
    features: Array<{ heading: string; text: string }>
    steps: Array<{ heading: string; text: string }>
    useCases: Array<{ heading: string; text: string }>
    example: { heading: string; prompt: string; note: string }
    faqs: Array<{ question: string; answer: string }>
    guide: 'image-to-video' | 'consistent-ai-characters' | 'script-to-video'
    feature: 'ai-video-generator' | 'ai-storyboard-generator' | 'ai-short-drama-generator'
    related: ToolSlug[]
}

const baseToolIndexCopy = {
    en: {
        title: 'AI Image & Video Tools: Text, Images and Motion',
        description: 'Explore makivue AI image and video tools: text to image, reference pictures, text to video and image to video. Compare inputs, models and uses for your story.',
        heading: 'Choose how your next image or video begins',
        intro: 'Start from a written prompt, an existing image or a planned story. Compare the inputs, preparation and review steps, then open the image or video workspace that fits your task.',
        label: 'AI image and video creation tools',
        features: 'What this workflow helps you create',
        steps: 'From input to a result you can review',
        useCases: 'Choose a practical starting point',
        example: 'A written prompt to adapt',
        faq: 'Questions before you generate',
        related: 'Explore related workflows',
        action: 'Open the creation workspace',
        pricing: 'Compare model pricing',
        guide: 'Read the practical creation guide',
        videoTool: 'Explore the AI video generator',
        dramaTool: 'Plan a complete AI short drama',
        credits: 'New accounts receive 1,000 signup credits. Generation uses credits according to the selected model and actual usage; the bonus does not guarantee a complete video or series.',
        compare: 'Compare your starting inputs'
    },
    zh: {
        title: 'AI 图片与视频工具：文生图、图生图、文生视频与图生视频',
        description:
            '按创作起点选择 AI 图片生成器、文生图、图生图、文生视频或图片生成视频。了解提示词、参考图和镜头动作的准备方法，进入 makivue 图片或视频工作台。比较不同输入方式、模型选项与使用场景，先明确需求，再制作适合后续分镜和短剧的素材。',
        heading: '从文字、图片到视频，选择适合当前素材的 AI 创作工具',
        intro: '有画面想法，先从文字生成图片；已有角色或场景图，可以用参考图继续创作，或让静态画面生成视频。需要连续剧情时，再把素材接入短剧和分镜工作流。',
        label: 'AI 图片与视频创作工具',
        features: '这个工作流可以帮你完成什么',
        steps: '从准备素材到检查生成结果',
        useCases: '按实际创作场景开始',
        example: '可改写的提示词文字示例',
        faq: '生成前的常见问题',
        related: '继续探索相关工作流',
        action: '打开创作工作台',
        pricing: '查看模型与费用',
        guide: '阅读实用创作指南',
        videoTool: '了解 AI 视频生成器',
        dramaTool: '规划完整 AI 短剧',
        credits: '新账户注册赠送 1000 金币。生成按所选模型和实际用量扣费，赠送金币不保证足够完成一部视频或整部短剧。',
        compare: '比较不同创作起点'
    }
} satisfies Record<'en' | 'zh', Record<string, string>>

// Base editions are merged with the independently maintained translations below.
const baseTools: Record<'en' | 'zh', Record<ToolSlug, CreationTool>> = {
    en: {
        'ai-image-generator': {
            title: 'AI Image Generator for Characters & Scenes',
            description: 'Create character concepts, scenes and story visuals with makivue AI image tools. Use text or reference pictures, compare styles and prepare images for video.',
            keywords: [
                'AI image generator',
                'AI picture generator',
                'AI images for stories',
                'AI character image generator',
                'AI scene generator',
                'AI concept art generator',
                'storyboard image generator'
            ],
            heading: 'An AI image generator for the visual parts of your story',
            intro: 'Create a character, establish a location or explore a cover concept before producing a video. makivue brings text-to-image and reference-image creation into one image workspace, so you can choose a starting point, compare results and carry a selected image into your next production step.',
            action: '/aiimage',
            actionLabel: 'Create an AI image',
            features: [
                {
                    heading: 'Choose text or a reference image',
                    text: 'Describe a new picture when you are exploring an idea. Add a reference image when you already have a character design, composition or visual direction. The selected model determines which reference options are supported.'
                },
                {
                    heading: 'Develop characters and locations separately',
                    text: 'Give each asset a clear job. A character concept should make the face, clothing and silhouette readable; a scene reference should establish layout, light and atmosphere. Review those details before combining them in a storyboard.'
                },
                {
                    heading: 'Prepare images for the next medium',
                    text: 'Choose an aspect ratio for the intended use and inspect the full frame. A cover needs room for later typography, while an image-to-video starting frame needs a clear subject and space for the planned movement. Download the image you want to keep.'
                }
            ],
            steps: [
                {
                    heading: 'Define one visual asset',
                    text: 'Decide whether you need a character concept, location, cover background or storyboard image. State the subject, setting, composition and style instead of asking for several unrelated pictures in one prompt.'
                },
                {
                    heading: 'Choose the generation input',
                    text: 'Use a text prompt for a new concept, or add a suitable reference to guide the result. Select an image model and aspect ratio, and check the available options and pricing before generating.'
                },
                {
                    heading: 'Review and continue',
                    text: 'Compare the face, hands, important props, light and composition. Revise a specific issue in the next prompt, download a selected image, or use it as a reference in a later image or video task.'
                }
            ],
            useCases: [
                {
                    heading: 'Character concept images',
                    text: 'Explore a protagonist’s costume, hairstyle and visual style before committing to multiple story shots. Keep a chosen reference and its defining details for later prompts.'
                },
                {
                    heading: 'Scene and atmosphere references',
                    text: 'Test the layout and lighting of a station, rooftop or room. A stable setting reference helps you describe where characters and props belong when planning the scene.'
                },
                {
                    heading: 'Short drama covers and visual concepts',
                    text: 'Generate a background or key visual with a readable focal point. Check the intended crop and add any final titles or lettering in a suitable design workflow.'
                }
            ],
            example: {
                heading: 'Example: a character concept with a clear purpose',
                prompt: 'A young courier in a mustard-yellow raincoat, short dark hair, a small canvas satchel, standing at the entrance of a quiet rooftop at dusk. Medium full shot, face clearly visible, soft overcast light, restrained blue and yellow palette, cinematic illustrated style, simple background.',
                note: 'This is a written prompt example, not a generated sample. First review the character design; use a separate prompt when you need a wide view of the rooftop or a close-up of a prop.'
            },
            faqs: [
                {
                    question: 'What is the difference between text to image and image to image?',
                    answer: 'Text to image starts with a written description. Image to image also uses an existing picture to guide a new result. Use text for early exploration and a reference when you have a visual direction to develop. Supported reference behavior varies by model.'
                },
                {
                    question: 'Can I generate images for an AI short drama?',
                    answer: 'Yes. You can prepare character concepts, scene references and keyframe ideas, then use suitable images in your storyboard or image-to-video workflow. Check each image for visual errors and continuity before generating clips.'
                },
                {
                    question: 'Will a reference keep a character identical in every image?',
                    answer: 'A reference can help maintain visual direction, but it does not guarantee an identical face, costume or prop placement. Keep descriptions consistent and compare the results across shots. Revise images that drift before producing video.'
                },
                {
                    question: 'Is the AI image generator free to try?',
                    answer: 'New accounts receive 1,000 signup credits. Image generation consumes credits according to the selected model and actual usage. Check pricing before generating; the signup balance is a limited allowance rather than unlimited free generation.'
                }
            ],
            guide: 'consistent-ai-characters',
            feature: 'ai-storyboard-generator',
            related: ['text-to-image', 'image-to-image', 'image-to-video']
        },
        'text-to-image': {
            title: 'Text to Image AI — Prompts to Pictures',
            description: 'Generate AI images from text with makivue. Describe a subject, scene, composition and light, then choose a model and aspect ratio for characters and settings.',
            keywords: [
                'text to image AI',
                'text to image generator',
                'AI image from text',
                'text prompt to image',
                'AI picture from description',
                'character concept prompts',
                'AI scene image prompts'
            ],
            heading: 'Text to image AI: give a written idea a visual starting point',
            intro: 'Turn a description into a picture when you do not have a reference yet. Write what should appear in the frame, choose an image model and aspect ratio, then review a result before refining the idea or moving into video production.',
            action: '/aiimage',
            actionLabel: 'Generate an image from text',
            features: [
                {
                    heading: 'Build the prompt around visible details',
                    text: 'Name the subject, action or pose, setting, framing, lighting and visual style. A concrete description gives you something to assess in the output: where the subject stands, what they hold and which detail the viewer should notice.'
                },
                {
                    heading: 'Explore a scene before preparing references',
                    text: 'Use text-to-image generation to test whether a location or composition suits your story. Once you choose a direction, keep that image and its descriptive details as a reference for later iterations.'
                },
                {
                    heading: 'Match the frame to its intended use',
                    text: 'Choose an aspect ratio for a portrait concept, wide scene or vertical video starting image. Place the important subject inside the usable frame and leave space where later cropping or graphic elements may be needed.'
                }
            ],
            steps: [
                {
                    heading: 'Write a focused image description',
                    text: 'Begin with one subject and one setting. Add the most important pose, costume, prop, framing and light. Separate a visible image idea from story background that cannot be shown in a single frame.'
                },
                {
                    heading: 'Choose a model and aspect ratio',
                    text: 'Open the image workspace, enter the prompt and choose an available image model. Check the selected ratio and pricing. Start without references when your goal is to explore a new visual concept.'
                },
                {
                    heading: 'Refine one decision at a time',
                    text: 'Review the resulting composition and visual details. If the framing works but the light does not, change the lighting description while preserving the rest of the prompt so the next comparison remains useful.'
                }
            ],
            useCases: [
                {
                    heading: 'Turn a story setting into a scene image',
                    text: 'Describe the geography of a rooftop, station or street. Use the resulting concept to make later storyboard descriptions more specific.'
                },
                {
                    heading: 'Explore a new character design',
                    text: 'Compare clothing, silhouette and hairstyle before making a reference-led series. Avoid asking one image to show multiple conflicting outfits or ages.'
                },
                {
                    heading: 'Prepare a video starting frame',
                    text: 'Generate a picture with a clear subject and room for motion. After reviewing it, use a model that supports image references to animate the selected image.'
                }
            ],
            example: {
                heading: 'Example: describe a location through composition and light',
                prompt: 'A quiet train platform at blue hour, an old round station clock above a wooden bench, wet pavement reflecting warm lamps, no people. Wide establishing shot from platform level, the bench on the left and the tracks on the right, natural proportions, cinematic realistic style.',
                note: 'This written example makes the layout inspectable. If you need a person opening an envelope in the same setting, plan that as a separate character shot rather than adding several actions to the establishing image.'
            },
            faqs: [
                {
                    question: 'How do I turn text into an AI image?',
                    answer: 'Open the image workspace, describe the subject and scene, choose a model and aspect ratio, then generate. Review the result and adjust the description to address a specific visual issue. No existing picture is required for a text-only starting point.'
                },
                {
                    question: 'What should I include in a text-to-image prompt?',
                    answer: 'Include the visible subject, setting, pose or action, framing, light and style. Prioritize details that matter to the image. Contradictory camera directions, several locations or a long sequence of actions make a single-frame request harder to evaluate.'
                },
                {
                    question: 'Can I use the generated picture to make a video?',
                    answer: 'Yes. Download a selected image and add it to a compatible image-to-video task. Describe the movement separately, choose a supported duration and inspect the final clip for changes to the face, props and composition.'
                },
                {
                    question: 'Can I generate a character sheet with identical views?',
                    answer: 'You can describe the views you want, but identical features across multiple poses are not guaranteed. Start with one clear character image, review it, then use a suitable reference-image workflow and compare each additional view.'
                }
            ],
            guide: 'consistent-ai-characters',
            feature: 'ai-storyboard-generator',
            related: ['ai-image-generator', 'image-to-image', 'image-to-video']
        },
        'image-to-image': {
            title: 'Image to Image AI: Create with Reference Pictures',
            description: 'Use reference pictures and text prompts to create character, scene and style variations in makivue. Control what changes and check identity before making video.',
            keywords: [
                'image to image AI',
                'image to image generator',
                'AI image generator from image',
                'AI image reference',
                'reference image generation',
                'AI image variations',
                'reference image prompts'
            ],
            heading: 'Image to image AI: develop an existing visual direction',
            intro: 'When you already have a character concept, scene image or preferred composition, use it as a reference for a new image. Describe what should remain recognizable and what you want to change, then compare the generated result with the source before continuing.',
            action: '/aiimage',
            actionLabel: 'Create with a reference image',
            features: [
                {
                    heading: 'Make the purpose of the reference explicit',
                    text: 'A picture may guide a subject, composition or style, but those are different goals. State which details matter to the next result: the character’s coat and hairstyle, the room layout or the palette. Check that your selected model supports the reference input.'
                },
                {
                    heading: 'Separate visual anchors from requested changes',
                    text: 'Keep a short description of the details to preserve, then state one planned change such as framing, pose or time of day. A reference does not lock every pixel, so inspect important faces and props after each generation.'
                },
                {
                    heading: 'Review variations as a sequence',
                    text: 'Compare the source and result before using a new image downstream. If a character or location drifts, revise that image first. Carrying an unchecked change into several video shots makes continuity harder to repair.'
                }
            ],
            steps: [
                {
                    heading: 'Choose a readable source image',
                    text: 'Use an image where the subject and relevant details are clear. Decide which parts should guide the new result. A crowded reference may make it harder to tell which face, object or layout the prompt is describing.'
                },
                {
                    heading: 'Add a precise change request',
                    text: 'Upload the reference in the image workspace and select a model that supports it. Describe both the retained design details and the intended change. Choose the output aspect ratio to fit the new composition.'
                },
                {
                    heading: 'Compare, revise and save',
                    text: 'Check the face, clothing, objects, scene layout and light against the source. Download a selected variation or revise the prompt. Keep a stable approved reference when producing a related set of images.'
                }
            ],
            useCases: [
                {
                    heading: 'Character variations for a story',
                    text: 'Explore a new framing or pose using an approved character image. Reuse the same defining descriptions and inspect the result before treating it as another view of the same person.'
                },
                {
                    heading: 'Scene lighting and mood studies',
                    text: 'Use an existing location concept to explore a different atmosphere. Check that doors, windows and important props still support the planned story geography.'
                },
                {
                    heading: 'Prepare a revised video keyframe',
                    text: 'Improve a still image’s framing or visual direction before animating it. A reference-led image pass lets you review the new composition separately from motion.'
                }
            ],
            example: {
                heading: 'Example: change the framing while preserving design anchors',
                prompt: 'Use the uploaded courier image as the character reference. Keep the short dark hair, mustard-yellow raincoat and small canvas satchel. Show a medium shot as the courier stands beside a rooftop doorway, looking toward a small radio. Soft overcast dusk light, cinematic illustrated style, simple readable background.',
                note: 'This is a written reference prompt, not an editing guarantee. Check that the generated face, costume and satchel remain suitable; reference-image generation can also change details you asked to retain.'
            },
            faqs: [
                {
                    question: 'What does image to image AI do?',
                    answer: 'It uses an existing picture together with a text prompt to guide a newly generated image. The reference can help communicate a character, composition or style. The result is a new generation, so details may change and should be reviewed.'
                },
                {
                    question: 'Can I change the style of a reference image?',
                    answer: 'You can describe a target visual style and use a model that supports reference images. Compare the result for the subject and composition as well as the style. Exact identity, layout or pixel-level preservation is not guaranteed.'
                },
                {
                    question: 'Is image to image the same as image to video?',
                    answer: 'No. Image to image creates another still image. Image to video creates a moving clip from an image and a motion description. Revise a still image first when the design is not ready, then use the approved result in a video task.'
                },
                {
                    question: 'How can I make character references more consistent?',
                    answer: 'Choose a clear approved image, repeat the same defining descriptions and change one major visual decision at a time. Compare the face, costume and props across results. Reference support helps guide consistency but does not guarantee it.'
                }
            ],
            guide: 'consistent-ai-characters',
            feature: 'ai-storyboard-generator',
            related: ['ai-image-generator', 'text-to-image', 'image-to-video']
        },
        'text-to-video': {
            title: 'Text to Video AI: Generate Clips from Prompts',
            description: 'Create AI video clips from text in makivue. Describe the scene, action and camera, choose a model and duration, then review shots for dramas or social video.',
            keywords: ['text to video AI', 'text to video generator', 'AI video from text', 'prompt to video', 'text prompt to video generator', 'AI video motion prompts', 'AI short video clips'],
            heading: 'Text to video AI: describe one scene and its movement',
            intro: 'Start a video clip from words when you do not have a starting image. Describe the visible scene, the subject’s main action and the camera movement, then choose a model and supported duration. For a longer story, plan several clips and check how they connect.',
            action: '/aivideo',
            actionLabel: 'Generate a video from text',
            features: [
                {
                    heading: 'Write motion as well as appearance',
                    text: 'A video prompt needs more than an image description. Establish the setting and subject, then state what changes during the clip. Keep the main action readable and give the camera a clear instruction such as a fixed view or a slow push-in.'
                },
                {
                    heading: 'Choose the model around the shot',
                    text: 'Available models differ in supported duration, references, audio options and pricing. Choose the options that fit the shot instead of assuming every model accepts the same inputs or produces the same clip length.'
                },
                {
                    heading: 'Keep a longer narrative in manageable clips',
                    text: 'A single generation follows the selected model’s clip limits. Split a sequence into an establishing shot, action and reaction when necessary. For recurring characters and dialogue across scenes, use the short drama and storyboard workflow to plan continuity.'
                }
            ],
            steps: [
                {
                    heading: 'Plan one visible action',
                    text: 'Choose a setting and a single main beat. Write the starting state, subject movement and intended end state. Move extra locations or complicated action sequences into additional shots.'
                },
                {
                    heading: 'Enter the prompt and select settings',
                    text: 'Open the video workspace and write the scene and motion description. Select a model, aspect ratio and supported duration. Check the model’s available audio and input options, along with its pricing.'
                },
                {
                    heading: 'Review movement and timing',
                    text: 'Check the subject, hands, props, camera path and ending. If the clip changes direction or rushes the action, simplify the prompt or split the beat. Download a selected result and plan the next clip around its actual ending.'
                }
            ],
            useCases: [
                {
                    heading: 'Atmospheric establishing clips',
                    text: 'Create a quiet street, a windswept rooftop or an empty platform where environmental movement establishes the mood before a character scene.'
                },
                {
                    heading: 'Single-action story moments',
                    text: 'Explore one readable beat, such as a courier turning toward a sound. Use a short test to check whether the action and camera direction support the intended story.'
                },
                {
                    heading: 'Visual concept and motion tests',
                    text: 'Test a movement or atmosphere before producing a full scene. When a specific character design matters, first prepare a reference image and consider image to video.'
                }
            ],
            example: {
                heading: 'Example: a text prompt with one motion goal',
                prompt: 'An empty train platform at blue hour. Warm lamps reflect on wet pavement. A loose paper ticket slides slowly across the foreground in a light breeze. Wide shot at platform level, fixed camera, subtle environmental movement, cinematic realistic style. End with the ticket resting beside a wooden bench.',
                note: 'This is a written prompt example. Choose a duration the selected model supports, then review whether the movement reaches a usable ending. Add dialogue or audio requests only when the chosen model supports the required output.'
            },
            faqs: [
                {
                    question: 'How do I generate a video from text?',
                    answer: 'Open the video workspace, describe a scene and its movement, choose a model, aspect ratio and supported duration, then generate. Review the clip before continuing. No image is needed for a text-only prompt with a compatible model.'
                },
                {
                    question: 'Can a text prompt create an entire short film?',
                    answer: 'A single request creates a clip within the selected model’s limits. A short film usually needs multiple planned shots, character references and an assembly step. Use the short drama workflow when you need scripts, storyboards and connected scenes.'
                },
                {
                    question: 'Should I use text to video or image to video?',
                    answer: 'Use text to video to explore a new scene from a description. Use image to video when a reviewed character, setting or composition is an important starting point. Neither approach guarantees perfect continuity; review the generated clip before reuse.'
                },
                {
                    question: 'Does text to video include sound?',
                    answer: 'Audio support depends on the selected video model and generation options. Check those options before writing a shot that relies on dialogue, music or synchronized sound. Review any generated audio together with the visuals.'
                }
            ],
            guide: 'script-to-video',
            feature: 'ai-video-generator',
            related: ['image-to-video', 'text-to-image', 'ai-image-generator']
        },
        'image-to-video': {
            title: 'Image to Video AI — Animate a Still Picture',
            description: 'Animate a still picture with makivue AI. Describe subject and camera movement, choose a video model and duration, then check the full clip for visual drift.',
            keywords: ['image to video AI', 'AI image to video generator', 'picture to video AI', 'photo to video AI', 'animate image with AI', 'still image animation', 'AI video from illustration'],
            heading: 'Image to video AI: give a still picture a planned movement',
            intro: 'Start with an image you have already reviewed, then describe how its subject, environment and camera should move. makivue lets you add image references in the video workspace and choose a compatible model, aspect ratio and duration for a short clip.',
            action: '/aivideo',
            actionLabel: 'Create a video from an image',
            features: [
                {
                    heading: 'Start with a readable image',
                    text: 'Use a clear character, scene or illustrated frame with visible details. Check faces, hands, props and crop before animating. Existing errors in the image can become harder to inspect once the picture is moving.'
                },
                {
                    heading: 'Describe what moves and what stays stable',
                    text: 'The image supplies visual context; the prompt should explain the motion. Specify one main subject action, any environmental movement and the camera direction. Avoid contradictory requests such as a fixed camera and a fast orbit in the same shot.'
                },
                {
                    heading: 'Match references to the selected model',
                    text: 'Image-reference support, first or last frame options and duration vary between video models. Check the workspace options for your choice. Do not assume that every uploaded reference acts as an exact first frame or that identity will remain unchanged.'
                }
            ],
            steps: [
                {
                    heading: 'Prepare the source picture',
                    text: 'Choose a reviewed image with a clear subject and enough room for the planned movement. If the composition or design needs work, revise the still image before starting video generation.'
                },
                {
                    heading: 'Add the image and a motion prompt',
                    text: 'Open the video workspace, upload the picture and choose a model that accepts the reference. Describe the action and camera direction, then select a supported aspect ratio and duration.'
                },
                {
                    heading: 'Check the full clip and its ending',
                    text: 'Watch for facial changes, distorted hands, drifting props and unintended camera movement. A useful first frame does not ensure a useful final frame. Simplify the action or revise the source image when the result does not hold together.'
                }
            ],
            useCases: [
                {
                    heading: 'Bring an illustrated story frame into motion',
                    text: 'Animate a character’s small reaction, a turn of the head or a change in posture. Keep the action limited enough to inspect the original design throughout the clip.'
                },
                {
                    heading: 'Add movement to a scene concept',
                    text: 'Use a location image for a gentle camera push or environmental motion, such as rain or moving curtains. Review whether the scene geometry remains believable.'
                },
                {
                    heading: 'Create short drama shots from approved keyframes',
                    text: 'Start a shot from a reviewed character and scene composition, then generate its main action. Use storyboards to plan how separate clips connect into a longer episode.'
                }
            ],
            example: {
                heading: 'Example: animate a character image with one small action',
                prompt: 'Use the uploaded image as the visual reference. The courier slowly turns her head toward the rooftop doorway, then holds still. Her yellow raincoat moves slightly in the breeze. Keep the camera fixed and the background stable. Preserve the existing dusk lighting; no scene change.',
                note: 'This is a written motion-prompt example. Reference behavior depends on the chosen model. Check the face, costume and doorway throughout the generated clip rather than judging only its opening frame.'
            },
            faqs: [
                {
                    question: 'How do I turn a picture into an AI video?',
                    answer: 'Add the picture to the video workspace, choose a model that supports image references and describe the movement you want. Select a supported duration and aspect ratio, generate, then review the full clip for changes to the subject and scene.'
                },
                {
                    question: 'Can I animate a photo or an AI-generated image?',
                    answer: 'You can use a suitable photo, illustration or AI-generated image as a reference with a compatible model. Choose a clear source and a motion that fits its composition. The result may alter facial features, objects or background details and should be reviewed.'
                },
                {
                    question: 'Is the uploaded picture always the exact first frame?',
                    answer: 'No. How an image is used depends on the model and reference mode. Some options support a starting or ending frame, while others use images as general visual references. Check the selected model’s options before planning a precise transition.'
                },
                {
                    question: 'Can one image become a long video?',
                    answer: 'Each generation is limited by the selected model’s supported clip duration. A longer story needs several shots and continuity checks. Plan the motion in small beats, review endings and use a storyboard when connecting clips.'
                }
            ],
            guide: 'image-to-video',
            feature: 'ai-video-generator',
            related: ['text-to-video', 'image-to-image', 'ai-image-generator']
        }
    },
    zh: {
        'ai-image-generator': {
            title: 'AI 图片生成器：创作角色、场景与短剧视觉素材',
            description:
                '用文字或参考图片生成 AI 图片，创作角色设定图、场景参考图和短剧封面视觉。了解文生图与图生图的选择方法，再把确认后的画面用于分镜和视频制作。按用途比较模型、画面比例与视觉风格，先检查角色外貌和场景构图，再下载选定素材。',
            keywords: ['AI 图片生成器', 'AI 图片生成', 'AI 绘画工具', 'AI 角色生成器', 'AI 场景生成', '短剧视觉素材', 'AI概念设计图', 'AI分镜图片生成'],
            heading: 'AI 图片生成器：先把角色、场景和故事画面做清楚',
            intro: '一部短剧需要的不只是视频，还需要可辨认的角色、稳定的场景和明确的镜头画面。makivue 图片工作台支持从文字开始探索，也可以加入参考图延续已有的视觉方向，逐步准备角色设定、场景参考和故事视觉素材。',
            action: '/aiimage',
            actionLabel: '开始生成 AI 图片',
            features: [
                {
                    heading: '按素材情况选择文生图或图生图',
                    text: '只有想法时，用文字描述新画面；已有角色、构图或风格方向时，用参考图片辅助生成。不同模型的参考图能力不同，生成前需要检查当前模型支持的输入方式。'
                },
                {
                    heading: '分别确认角色设计与场景空间',
                    text: '角色图优先检查面部、服装和轮廓，场景图优先检查布局、光线和氛围。每张图片先承担一个明确任务，再把确认后的视觉信息组合到分镜中，便于发现并修改具体问题。'
                },
                {
                    heading: '为封面、分镜和视频准备合适画面',
                    text: '根据用途选择画面比例并检查裁切。封面背景需要为后续排字留出空间，图生视频起始画面需要主体清晰、运动空间合理。确认后下载图片，再用于后续制作。'
                }
            ],
            steps: [
                { heading: '确定这次要制作的素材', text: '先选择角色设定、场景参考、封面背景或分镜画面，再描述主体、环境、构图与风格。避免让一个提示词同时承担多张互不相关图片的任务。' },
                { heading: '选择文字或参考图输入', text: '在图片工作台填写提示词，需要延续已有视觉时添加合适的参考图。选择图片模型与画面比例，并在生成前查看可用选项和费用。' },
                { heading: '检查结果并进入下一步', text: '检查脸部、手部、关键道具、光线和构图。下一次只针对具体问题调整提示词，下载确认后的图片，或将其用于后续图片与视频任务的参考。' }
            ],
            useCases: [
                { heading: '短剧角色设定图', text: '在制作多个镜头之前，先探索主角服装、发型和画风。选定后保留参考图及其关键描述，用于后续角色画面。' },
                { heading: '场景与氛围参考图', text: '测试车站、天台或房间的空间布局和光线。明确场景中人物与道具的位置，能让后续镜头描述更具体。' },
                { heading: '短剧封面与故事概念图', text: '制作具有清晰视觉中心的背景或主视觉，检查目标比例下的构图，再在适合的设计流程中添加最终标题和文字。' }
            ],
            example: {
                heading: '文字示例：先做一张用途明确的角色概念图',
                prompt: '一位年轻信使，穿芥末黄色雨衣，短黑发，背小号帆布挎包，站在黄昏时分安静的天台入口。中全景，面部清晰可见，柔和阴天光，克制的蓝黄配色，电影感插画风格，背景简洁。',
                note: '这是可改写的提示词文字示例，并非生成效果展示。先确认角色设计；需要天台全景或道具特写时，另写对应画面的提示词。'
            },
            faqs: [
                {
                    question: 'AI 文生图和图生图有什么区别？',
                    answer: '文生图从文字描述开始，图生图还使用已有图片引导新结果。前期探索可以先用文字，已有角色或构图方向时可以加入参考图。参考图的具体作用与所选模型有关。'
                },
                {
                    question: '可以用 AI 图片为短剧准备素材吗？',
                    answer: '可以。先制作角色概念图、场景参考图和关键帧思路，再把合适的图片用于分镜或图生视频。进入视频生成之前，需要逐张检查画面错误和跨镜头的一致性。'
                },
                {
                    question: '参考图能让每张图片中的角色完全一致吗？',
                    answer: '参考图可以帮助延续视觉方向，但不保证脸部、服装和道具位置完全一致。需要保持关键描述统一，并把多个结果放在一起检查；发现漂移时先修正图片，再制作视频。'
                },
                { question: 'AI 图片生成器可以免费试用吗？', answer: '新账户注册赠送 1000 金币。图片生成按所选模型和实际用量扣费，请在生成前查看费用。赠送额度有限，不代表无限免费生成。' }
            ],
            guide: 'consistent-ai-characters',
            feature: 'ai-storyboard-generator',
            related: ['text-to-image', 'image-to-image', 'image-to-video']
        },
        'text-to-image': {
            title: 'AI 文生图：用文字描述生成图片与故事画面',
            description:
                '使用 AI 将文字生成图片，按主体、场景、构图、光线与风格编写提示词。创作角色概念图、短剧场景和视觉灵感，再把选定画面用于后续视频制作。了解如何避免多个主体和互相冲突的描述，结合文字示例准备清晰的单幅画面需求。',
            keywords: ['AI 文生图', '文字生成图片', '文生图工具', '文字转图片 AI', 'AI 绘画提示词', '文字生成角色图', '文生图构图提示词', 'AI场景图片提示词'],
            heading: 'AI 文生图：把文字想法变成可检查的画面',
            intro: '还没有参考图片时，可以先从文字描述建立视觉方向。写清画面中有什么、主体位于哪里、光线与风格怎样，选择图片模型和比例，生成后再逐步调整，用于角色探索、场景设计或视频起始画面。',
            action: '/aiimage',
            actionLabel: '用文字生成图片',
            features: [
                {
                    heading: '围绕看得见的细节组织提示词',
                    text: '按主体、动作或姿态、环境、景别、光线和风格描述画面。把“她心情复杂”改为能看见的表情或动作，生成后才能具体检查站位、道具和观众应该注意的重点。'
                },
                { heading: '先探索，再建立参考方向', text: '用文生图测试某个场景或构图是否适合故事。选定方向后，保留图片和关键描述，再进入参考图辅助的迭代，而不是每次从完全不同的提示词重新开始。' },
                { heading: '让画面比例服务于实际用途', text: '角色概念、横向场景和竖屏视频起始画面需要不同构图。选择适合用途的比例，检查主体是否处于有效区域，并为后续裁切或图文设计留出空间。' }
            ],
            steps: [
                { heading: '写一个聚焦的画面描述', text: '从一个主体和一个环境开始，补充最重要的姿态、服装、道具、景别与光线。将无法在单张图片中表现的背景故事和多步骤剧情移出当前提示词。' },
                { heading: '选择图片模型与比例', text: '打开图片工作台，填写文字提示词，选择可用图片模型和输出比例，并查看费用。探索全新概念时，可以先不添加参考图。' },
                { heading: '一次调整一个关键问题', text: '检查构图和视觉细节。如果构图合适但光线不对，保留其他描述，只修改光线条件，让下一次结果更容易比较。' }
            ],
            useCases: [
                { heading: '把故事地点变成场景概念图', text: '描述天台、车站或街道的空间关系，用场景图帮助后续分镜明确人物站位和镜头方向。' },
                { heading: '探索新的短剧角色设计', text: '在建立系列角色参考前，比较服装、轮廓与发型。避免要求单张画面同时展示互相矛盾的服装、年龄或造型。' },
                { heading: '准备图生视频的起始画面', text: '先生成主体清晰、具有运动空间的静态图片，确认后再选择支持参考图的视频模型，让选定画面进入动态制作。' }
            ],
            example: {
                heading: '文字示例：通过构图和光线明确场景',
                prompt: '蓝调时刻的安静火车站台，木质长椅上方有一只老式圆形站钟，潮湿地面映出暖色站灯，没有人物。站台高度的广角建立镜头，长椅位于左侧，铁轨位于右侧，自然比例，电影写实风格。',
                note: '这个文字示例把空间布局写成了可检查的信息。如果下一镜需要人物在同一地点打开信封，应单独规划人物镜头，不必把多个动作塞进建立场景的图片。'
            },
            faqs: [
                { question: '如何用文字生成 AI 图片？', answer: '在图片工作台描述主体与场景，选择模型和画面比例后生成。查看结果，再针对具体视觉问题调整描述。纯文生图不需要先准备已有图片。' },
                {
                    question: '文生图提示词应该怎么写？',
                    answer: '写清可见的主体、环境、姿态或动作、景别、光线与风格，并优先保留真正重要的信息。互相矛盾的机位、多个地点和连续复杂动作，会让单张图片的目标难以确认。'
                },
                {
                    question: '文字生成的图片能继续做视频吗？',
                    answer: '可以。下载确认后的图片，在支持参考图的图生视频任务中使用，再单独描述运动并选择模型支持的时长。视频完成后仍需检查人物、道具与构图是否发生变化。'
                },
                {
                    question: '可以一次生成完全一致的角色三视图吗？',
                    answer: '可以描述希望展示的视角，但不能保证不同姿态中的角色特征完全一致。建议先确认一张清晰角色图，再使用支持参考图的工作流生成其他视角，并逐张比较。'
                }
            ],
            guide: 'consistent-ai-characters',
            feature: 'ai-storyboard-generator',
            related: ['ai-image-generator', 'image-to-image', 'image-to-video']
        },
        'image-to-image': {
            title: 'AI 图生图：用参考图片创作角色与场景变体',
            description:
                '上传参考图片并描述希望保留和改变的内容，用 AI 图生图延续角色、构图与风格方向。检查人物与场景变化，再将合适图片用于分镜和视频关键帧。使用文字示例明确保留项与修改项，了解参考方式随模型变化，避免把参考图当作结果保证。',
            keywords: ['AI 图生图', '参考图生成图片', '图片生成图片 AI', 'AI 图片二次创作', 'AI 角色参考图', '参考图片生成', 'AI图片变体', '图生图提示词'],
            heading: 'AI 图生图：沿着已有图片继续创作',
            intro: '已有角色设计、场景图或喜欢的构图时，不必只靠文字重新描述全部视觉信息。把图片作为参考，说明哪些特征需要保持、这次希望改变什么，再对照原图检查新结果，逐步完善角色与场景素材。',
            action: '/aiimage',
            actionLabel: '用参考图生成新图片',
            features: [
                {
                    heading: '先明确参考图承担的作用',
                    text: '同一张图片可以提供主体、构图或风格方向，但这些目标并不相同。写清要参考的是人物雨衣和发型、房间布局，还是配色，并确认所选模型支持当前参考输入。'
                },
                { heading: '把保留项与变化项分别写清楚', text: '先列出关键设计特征，再提出景别、姿态或时间氛围等一项主要变化。参考图不等于锁定每个像素，生成后仍要检查脸部、服装和重要道具。' },
                {
                    heading: '对照检查，避免把偏差带入后续镜头',
                    text: '在下游使用新图片之前，先与原图比较。如果角色或场景发生明显漂移，优先修正当前图片；未经检查的变化进入多个视频镜头后，连续性更难恢复。'
                }
            ],
            steps: [
                { heading: '选一张细节清楚的原图', text: '确认主体和需要参考的特征清晰可见。画面过于拥挤时，可能难以确定提示词指向哪个人物、物体或空间关系。' },
                { heading: '上传参考图并说明修改方向', text: '在图片工作台上传参考图，选择支持该输入的模型，描述保留的设计信息和希望发生的变化，并按新构图选择画面比例。' },
                { heading: '比较结果并保存合适版本', text: '对照检查面部、服装、道具、场景布局和光线。下载满意版本，或继续调整提示词。制作一组相关图片时，尽量保留稳定且已确认的参考方向。' }
            ],
            useCases: [
                { heading: '制作角色不同姿态与景别', text: '以确认后的角色图探索新姿态或景别，重复关键特征描述，检查结果后再作为同一人物的其他画面使用。' },
                { heading: '探索场景光线与氛围', text: '在已有地点概念上尝试另一种时间和气氛，同时检查门窗与关键道具是否仍然符合故事空间关系。' },
                { heading: '调整视频关键帧', text: '在生成动态片段之前，先完善静态图的构图和视觉方向，把画面修正与运动生成分开检查。' }
            ],
            example: {
                heading: '文字示例：保留角色特征，调整景别',
                prompt: '以上传的信使图片作为角色参考，保留短黑发、芥末黄色雨衣和小号帆布挎包。改为中景，信使站在天台门口旁，看向一台小收音机。柔和阴天黄昏光，电影感插画风格，背景简洁且空间关系清晰。',
                note: '这是参考图提示词的文字示例，不代表精确编辑保证。需要检查生成后的脸部、服装和挎包；参考图生成也可能改变要求保留的细节。'
            },
            faqs: [
                { question: 'AI 图生图是什么意思？', answer: '图生图将已有图片与文字提示词共同用于引导一张新图片，可以参考角色、构图或风格。输出是一次新的生成，细节可能变化，需要对照检查。' },
                { question: '可以根据原图改变画风吗？', answer: '可以在支持参考图的模型中描述目标视觉风格，并比较结果中的主体、构图和风格是否符合需求。不能保证身份、布局或像素级细节完全保留。' },
                {
                    question: '图生图和图生视频有什么不同？',
                    answer: '图生图生成另一张静态图片，图生视频根据图片和运动描述生成动态片段。如果原图的设计还不合适，建议先修改静态画面，确认后再进入视频制作。'
                },
                {
                    question: '怎样让图生图中的角色更一致？',
                    answer: '选择清晰且已确认的角色参考图，统一关键特征描述，每次尽量只调整一个主要视觉决策。将生成结果放在一起比较脸部、服装和道具。参考图有助于引导一致性，但不能保证完全相同。'
                }
            ],
            guide: 'consistent-ai-characters',
            feature: 'ai-storyboard-generator',
            related: ['ai-image-generator', 'text-to-image', 'image-to-video']
        },
        'text-to-video': {
            title: 'AI 文生视频：用文字提示词生成视频片段',
            description:
                '输入场景、人物动作与镜头运动，用 AI 将文字生成视频。选择模型、比例和支持的时长，检查动作与衔接，再把多个片段规划为短剧或故事视频。从单一动作开始规划视频片段，了解不同模型的时长与参考限制，检查人物、道具和结尾画面。',
            keywords: ['AI 文生视频', '文字生成视频', '文生视频工具', '文字转视频 AI', '提示词生成视频', 'AI 视频片段生成', '文生视频动作提示词', 'AI短视频片段'],
            heading: 'AI 文生视频：把一个场景和动作写成可生成的镜头',
            intro: '没有起始图片时，也可以直接从文字生成视频片段。写清场景、主体的主要动作和镜头运动，再选择模型与支持的时长。需要完整故事时，把连续情节拆成多个镜头，并检查片段之间的角色与空间衔接。',
            action: '/aivideo',
            actionLabel: '用文字生成视频',
            features: [
                { heading: '不仅写画面，还要写清运动', text: '视频提示词需要说明片段中发生什么变化。先建立场景与主体，再写一个清楚的主要动作，并给镜头明确指令，例如固定机位或缓慢推进。' },
                { heading: '按镜头需求选择模型', text: '不同模型支持的时长、参考素材、声音选项和费用存在差异。按当前镜头需要选择，不要默认所有模型都接受相同输入或生成相同长度的视频。' },
                { heading: '用多个片段组织较长叙事', text: '单次生成受所选模型的片段时长限制。必要时拆成建立场景、动作和反应镜头；涉及连续角色与对白时，用短剧和分镜工作流提前规划衔接。' }
            ],
            steps: [
                { heading: '规划一个可以看见的动作', text: '确定环境与一个主要情节节拍，写清起始状态、主体运动和结束状态。多地点切换或复杂连续动作应拆成其他镜头。' },
                { heading: '填写文字并选择生成设置', text: '在视频工作台输入场景与运动描述，选择模型、画面比例和支持的时长。检查模型当前可用的声音、输入选项和费用。' },
                { heading: '检查运动过程与节奏', text: '检查人物、手部、道具、镜头轨迹和结束画面。如果动作方向不对或节奏太赶，简化提示词或继续拆镜。下载选定结果，再根据实际结尾规划下一段。' }
            ],
            useCases: [
                { heading: '故事开场与环境氛围片段', text: '用安静街道、风中的天台或空站台建立气氛，让环境运动为后续人物场景提供情绪与空间背景。' },
                { heading: '单一动作的短剧情节', text: '先测试一个清楚的节拍，例如信使听到声音后转头，检查动作和运镜是否能够表达预期剧情。' },
                { heading: '运动与视觉方向测试', text: '制作完整场景前先试验运动或气氛。如果特定角色造型十分重要，可以先准备参考图片，再考虑图生视频。' }
            ],
            example: {
                heading: '文字示例：给一个镜头设定明确的运动目标',
                prompt: '蓝调时刻的空火车站台，暖色站灯映在潮湿地面上。一张松散的纸质车票被微风缓慢吹过前景。站台高度的广角镜头，固定机位，环境运动细微，电影写实风格。结尾车票停在木质长椅旁。',
                note: '这是提示词文字示例。选择模型支持的时长，并检查动作是否到达可用的结束状态。只有所选模型支持需要的声音输出时，再加入对白或音效要求。'
            },
            faqs: [
                { question: '如何用文字生成 AI 视频？', answer: '打开视频工作台，描述场景及其运动，选择模型、画面比例和支持的时长后生成，再检查片段。在兼容模型的纯文字任务中，不需要先上传图片。' },
                {
                    question: '一段文字能直接生成完整短片吗？',
                    answer: '单次任务生成所选模型时长范围内的视频片段。完整短片通常需要多个镜头、角色参考与合成步骤。需要剧本、分镜和连续场景时，更适合使用短剧工作流。'
                },
                {
                    question: '应该选文生视频还是图生视频？',
                    answer: '想从描述探索一个新场景时，可以先用文生视频；已有确认的角色、环境或构图，需要延续视觉起点时，可以用图生视频。两种方式都需要检查生成结果，不能保证完全一致。'
                },
                { question: '文生视频可以生成声音吗？', answer: '声音能力取决于所选视频模型和生成选项。依赖对白、音乐或同步音效的镜头，需要先确认模型支持，再将生成声音与画面一起检查。' }
            ],
            guide: 'script-to-video',
            feature: 'ai-video-generator',
            related: ['image-to-video', 'text-to-image', 'ai-image-generator']
        },
        'image-to-video': {
            title: 'AI 图生视频：把图片生成视频与动态镜头',
            description:
                '上传照片、插画或 AI 图片，描述人物动作和镜头运动，用 AI 将图片生成视频。选择兼容模型与时长，检查角色、道具和结尾，再制作故事镜头。了解首帧、尾帧和整体参考的区别，结合运动提示词示例准备素材，避免一次镜头安排过多动作。',
            keywords: ['AI 图生视频', '图片生成视频', '图片转视频 AI', '照片生成视频', '静态图片动起来', 'AI 图片生成视频工具', '静态插画动画化', '图生视频运镜提示词'],
            heading: 'AI 图生视频：让静态图片按照镜头目标动起来',
            intro: '从已经检查过的角色图、场景图或插画开始，描述主体、环境和镜头如何运动。在 makivue 视频工作台添加图片参考，选择兼容模型、比例和时长，先制作一个可检查的动态片段，再规划下一镜。',
            action: '/aivideo',
            actionLabel: '用图片生成视频',
            features: [
                { heading: '从清晰且已确认的图片开始', text: '检查角色、场景与插画中的脸部、手部、道具和裁切。静态图已经存在的错误，进入动态之后往往更难判断，建议在生成前先确认原图。' },
                {
                    heading: '分别描述运动与稳定部分',
                    text: '图片提供视觉信息，提示词重点说明如何动。写清一个主要人物动作、必要的环境运动与运镜方向，避免同一镜头同时要求固定机位和快速环绕等矛盾指令。'
                },
                {
                    heading: '按模型能力使用参考图与首尾帧',
                    text: '不同模型的参考图、首帧、尾帧和时长支持不同，需要查看当前选项。不能默认每张上传图片都会成为精确首帧，也不能假设人物身份与所有细节都会保持不变。'
                }
            ],
            steps: [
                { heading: '准备要生成视频的图片', text: '选择主体清楚、具备合理运动空间的图片。如果构图或角色设计仍需调整，先完成静态图修改，再进行视频生成。' },
                { heading: '添加图片与运动提示词', text: '在视频工作台上传图片，选择支持该参考方式的模型，描述人物动作和运镜，再选择支持的画面比例与时长。' },
                { heading: '检查整个片段及结束画面', text: '观察面部变化、手部变形、道具漂移和意外运镜。开头画面合适不代表结尾可用；结果不稳定时，简化动作或修正原图后再尝试。' }
            ],
            useCases: [
                { heading: '让插画与角色画面产生细小动作', text: '制作一次转头、轻微反应或姿态变化。保持动作范围清楚，便于检查整个片段中的原始角色设计是否合理延续。' },
                { heading: '为场景概念图增加运动', text: '基于地点图片尝试轻微推镜、下雨或窗帘摆动等环境变化，同时检查场景结构是否保持可信。' },
                { heading: '从关键帧制作短剧镜头', text: '以确认的角色和场景构图作为视觉起点，生成当前镜头的主要动作，再用分镜规划多个视频片段如何接成一集。' }
            ],
            example: {
                heading: '文字示例：让角色图片完成一个小动作',
                prompt: '以上传图片作为视觉参考。信使缓慢转头看向天台门口，然后保持静止。黄色雨衣被微风轻轻吹动。固定机位，背景稳定，延续原图的黄昏光线，不切换场景。',
                note: '这是运动提示词的文字示例。参考图具体作用取决于模型，需要检查整个片段中的面部、服装和门口位置，而不只看第一帧。'
            },
            faqs: [
                {
                    question: '如何把一张图片生成 AI 视频？',
                    answer: '在视频工作台添加图片，选择支持参考图的模型，再描述希望发生的运动。选择支持的时长和比例后生成，最后检查整个片段中人物与场景的变化。'
                },
                {
                    question: '照片、插画和 AI 图片都能做图生视频吗？',
                    answer: '可以在兼容模型中使用合适的照片、插画或 AI 图片作为参考。原图应清晰，运动要符合构图条件。结果可能改变面部、物体或背景细节，需要完成后检查。'
                },
                {
                    question: '上传的图片一定会成为视频的精确首帧吗？',
                    answer: '不一定，取决于模型和参考方式。有的选项支持起始帧或结束帧，有的把图片用作整体视觉参考。需要精确规划转场时，应先确认所选模型的选项。'
                },
                { question: '一张图片可以直接生成长视频吗？', answer: '每次生成受所选模型支持的片段时长限制。较长故事需要多个镜头与连续性检查，建议把动作拆成小节拍，检查结尾，并用分镜规划片段衔接。' }
            ],
            guide: 'image-to-video',
            feature: 'ai-video-generator',
            related: ['text-to-video', 'image-to-image', 'ai-image-generator']
        }
    }
}

const localizedToolIndexCopy: Record<ToolLocale, typeof baseToolIndexCopy.en> = {
    ...baseToolIndexCopy,
    fr: editorialTranslations.fr.toolIndex,
    ar: editorialTranslations.ar.toolIndex,
    id: editorialTranslations.id.toolIndex,
    hi: editorialTranslations.hi.toolIndex,
    fil: editorialTranslations.fil.toolIndex,
    ja: editorialTranslations.ja.toolIndex,
    ko: editorialTranslations.ko.toolIndex
}

function localizeToolEdition(edition: EditorialEdition): Record<ToolSlug, CreationTool> {
    return Object.fromEntries(Object.entries(edition.tools).map(([slug, content]) => [slug, { ...baseTools.en[slug as ToolSlug], ...content }])) as Record<ToolSlug, CreationTool>
}

export const creationTools: Record<ToolLocale, Record<ToolSlug, CreationTool>> = {
    ...baseTools,
    fr: localizeToolEdition(editorialTranslations.fr),
    ar: localizeToolEdition(editorialTranslations.ar),
    id: localizeToolEdition(editorialTranslations.id),
    hi: localizeToolEdition(editorialTranslations.hi),
    fil: localizeToolEdition(editorialTranslations.fil),
    ja: localizeToolEdition(editorialTranslations.ja),
    ko: localizeToolEdition(editorialTranslations.ko)
}

export const toolIndexCopy = Object.fromEntries(
    toolLocales.map(locale => [
        locale,
        {
            ...localizedToolIndexCopy[locale],
            keywords: [...toolSlugs.map(slug => creationTools[locale][slug].keywords[0]), ...toolSlugs.slice(0, 2).map(slug => creationTools[locale][slug].keywords.at(-1)!)]
        }
    ])
) as Record<ToolLocale, typeof baseToolIndexCopy.en & { keywords: string[] }>
