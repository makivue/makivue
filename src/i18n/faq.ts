import type { Locale } from './config'
import { translateMessage } from './catalog'

type FaqItem = { question: string; answer: string }
type FaqCategory = { title: string; items: FaqItem[] }

export type FaqPageCopy = {
    heading: string
    intro: string
    homeLink: string
    browseAll: string
    quickBrowse: string
    cta: string
    shortDramaLink: string
    categories: FaqCategory[]
}

const zh: FaqPageCopy = {
    heading: '常见问题',
    intro: '查找创作、模型和导出的常见解答。',
    homeLink: '首页',
    browseAll: '浏览全部问题',
    quickBrowse: '快速浏览',
    cta: '免费开始创作',
    shortDramaLink: 'AI 短剧生成器',
    categories: [
        {
            title: '开始使用',
            items: [
                {
                    question: 'Local Drama Studio 是什么？',
                    answer: 'Local Drama Studio 是一站式 AI 故事视频工作室，可以把一个想法或剧本逐步变成角色、场景、分镜、视频和字幕，适合制作 AI 短剧、短片、动画故事和系列剧集。'
                },
                { question: '没有完整剧本也能开始吗？', answer: '可以。你可以从一句话、一个人物设定或一段经历开始，AI 会帮助你整理故事方向、生成剧本和分集内容；已有小说或脚本也可以导入后继续制作。' },
                {
                    question: '需要填写谁的模型密钥？',
                    answer: '请填写你自己在对应供应商申请的 Token 或 API Key。本项目不提供共享密钥，未配置的供应商无法生成。'
                },
                { question: '需要安装软件才能使用吗？', answer: '需要先按 README 安装并启动本地服务，再通过浏览器访问。模型请求由你的本地服务发出，项目与生成素材保存在本机。' },
                { question: '界面和内容支持哪些语言？', answer: '界面提供中文、英语、法语、阿拉伯语、印尼语、印地语、菲律宾语、日语和韩语。项目内容语言可以在创作设置中按作品需要选择。' }
            ]
        },
        {
            title: '创作功能',
            items: [
                {
                    question: '如何把故事创意变成 AI 短剧？',
                    answer: '创建项目后输入故事主题或导入剧本，先确认故事结构和角色，再生成场景与 AI 分镜，最后按镜头生成画面和视频并合成整集。每一步都可以先检查，再进入下一步。'
                },
                {
                    question: 'AI 分镜生成器会输出哪些内容？',
                    answer: '分镜会把剧本拆成可执行镜头，包含景别、构图、机位、运镜、动作、对白、声音、时长、首帧和尾帧提示，方便后续进行文生视频或图生视频。'
                },
                { question: '可以保持角色和场景的一致性吗？', answer: '可以。项目会保存角色参考图、场景信息、视觉风格和镜头上下文，并在生成后续画面时继续引用这些资产，减少角色外观和场景风格漂移。' },
                { question: '可以只重做一个镜头吗？', answer: '可以。剧本、角色、场景、首帧、尾帧和视频都支持分阶段修改；单个镜头失败或不满意时，可以单独重试，不需要重新生成整部短剧。' },
                {
                    question: '支持对白、原声和字幕吗？',
                    answer: '支持的模型可以在视频中生成对白和环境声，项目也支持字幕工作流与多语言字幕。不同模型的原声能力和适合的对白长度会有所不同，生成前可以查看模型说明。'
                },
                { question: '参考图应该准备什么内容？', answer: '建议使用主体清晰、光线稳定、没有大面积遮挡的图片。角色参考图适合突出脸部、发型和服装，场景参考图适合展示空间结构、材质和主要色彩。' },
                { question: '生成后的分镜可以手动修改吗？', answer: '可以。镜头描述、动作、对白、图片提示和视频提示都可以单独编辑，保存后只重新生成受影响的阶段，已经确认的其他内容会保留。' }
            ]
        },
        {
            title: '生成、模型与费用',
            items: [
                {
                    question: '支持文生视频和图生视频吗？',
                    answer: '支持。你可以使用文字描述生成镜头，也可以用首帧、尾帧、角色参考图或场景参考图约束图生视频。不同视频模型适合的时长、动作复杂度和原声能力不同。'
                },
                { question: '模型调用如何收费？', answer: '模型供应商按你自己的账号与实际用量计费。本地应用不销售金币，也不处理充值或支付。' },
                {
                    question: '生成失败会产生费用吗？',
                    answer: '是否收费以对应模型供应商的计费规则为准。重试可能产生新的模型请求与费用，请先查看任务错误。'
                },
                { question: 'AI 视频生成需要等待多久？', answer: '等待时间取决于模型、镜头时长、当前队列和参考素材。长任务会在后台运行，页面刷新后仍可继续查看状态，不需要一直保持当前页面。' },
                {
                    question: '为什么要设置自己的模型账号？',
                    answer: '生成请求直接使用你填写的供应商凭证。本地工作区不分配共享额度，也不会代替你向供应商购买用量。'
                },
                { question: '生成过程中可以切换模型吗？', answer: '可以修改后续任务使用的模型。已经提交或正在运行的任务会继续使用提交时的配置，新的模型会从下一次生成开始生效。' }
            ]
        },
        {
            title: '导出与发布',
            items: [
                {
                    question: '可以制作哪些类型的作品？',
                    answer: '可以制作竖屏短剧、AI 短片、漫画和动画故事、品牌故事、广告片段、个人经历影像化以及多语言社交媒体视频。地域题材和视觉风格可以在创建项目时选择。'
                },
                {
                    question: '作品可以用于商业项目吗？',
                    answer: '平台提供创作和导出工具，但你仍需要确认所使用的模型、参考素材、音乐、字体和人物肖像的授权范围。发布前请根据目标平台和所在地区检查相应权利。'
                },
                { question: '在哪里查看模型费用和生成记录？', answer: '实际费用请到对应模型供应商的控制台查看；任务进度与生成结果可以在本地项目和素材页面查看。' },
                { question: '如何下载生成的图片或视频？', answer: '打开项目或“我的作品”中的对应素材，使用预览区域的查看或下载入口即可保存文件。视频封面也可以单独设置和更新。' },
                { question: '可以重新合成整集视频吗？', answer: '可以。各镜头视频准备完成后，可以在分集页面重新合成整集；重新合成会使用当前已确认的镜头顺序和可用视频，不会自动重做插图。' }
            ]
        },
        {
            title: '账户与设置',
            items: [
                { question: '如何切换界面语言？', answer: '使用页面顶部的语言切换入口即可切换界面语言。切换后会保留当前页面位置，并按所选语言显示导航、设置和帮助内容。' },
                { question: '如何修改默认图片和视频模型？', answer: '在项目或分镜页面打开生成设置即可修改默认模型。默认设置会用于之后的新任务，已经提交的任务不会被追溯修改。' },
                { question: '项目和素材保存在哪里？', answer: '项目记录保存到本地数据目录，素材保存在其中的 media 子目录。无需在线登录，请定期备份这些文件。' }
            ]
        },
        {
            title: '问题排查',
            items: [
                { question: '任务一直排队，应该怎么办？', answer: '排队通常表示当前模型的并发名额已满。请先等待队列推进，不要连续重复提交；如果长时间没有变化，可以刷新项目页查看最新状态后再重试。' },
                { question: '刷新页面后，正在生成的任务会消失吗？', answer: '不会。生成任务在服务端运行，刷新页面只会重新加载状态。回到对应项目或分集页面即可继续查看进度和结果。' },
                { question: '参考素材上传失败怎么办？', answer: '先确认文件格式、大小和视频时长符合上传区提示，再检查网络并重新上传。若当前模型不支持该类型参考素材，可以删除素材或更换支持的模型。' },
                { question: '模型账号额度不足怎么办？', answer: '请到你使用的模型供应商控制台查看账号额度，或切换到另一个已配置个人密钥的供应商。' }
            ]
        }
    ]
}

const en: FaqPageCopy = {
    heading: 'Frequently asked questions',
    intro: 'Find answers about creation, models, and exports.',
    homeLink: 'Home',
    browseAll: 'Browse all questions',
    quickBrowse: 'Quick browse',
    cta: 'Start creating for free',
    shortDramaLink: 'AI short drama generator',
    categories: [
        {
            title: 'Getting started',
            items: [
                {
                    question: 'What is Local Drama Studio?',
                    answer: 'Local Drama Studio is an AI story video studio that turns an idea or script into characters, scenes, storyboards, video shots, and subtitles. It is built for AI short dramas, short films, animated stories, and series.'
                },
                {
                    question: 'Can I start without a complete script?',
                    answer: 'Yes. Start with a sentence, a character idea, or a personal experience. AI can help shape the story, write the script, and split it into episodes. You can also import an existing novel or screenplay.'
                },
                {
                    question: 'Whose model key should I use?',
                    answer: 'Use your own Token or API key from each selected supplier. The project provides no shared credentials. Unconfigured suppliers cannot generate content.'
                },
                {
                    question: 'Do I need to install software?',
                    answer: 'Install and start the local service using the README, then open it in your browser. Your local service sends model requests and saves projects and generated media on your computer.'
                },
                {
                    question: 'Which languages are supported?',
                    answer: 'The interface supports Chinese, English, French, Arabic, Indonesian, Hindi, Filipino, Japanese, and Korean. You can choose the content language for each creative project.'
                }
            ]
        },
        {
            title: 'Creative features',
            items: [
                {
                    question: 'How do I turn a story idea into an AI short drama?',
                    answer: 'Create a project, enter an idea or import a script, confirm the story and characters, generate scenes and an AI storyboard, then generate video shots and assemble the episode. Each stage can be reviewed before the next one.'
                },
                {
                    question: 'What does the AI storyboard generator create?',
                    answer: 'It turns a script into production-ready shots with framing, camera position, movement, actions, dialogue, sound, duration, and first- and last-frame prompts for text-to-video or image-to-video work.'
                },
                {
                    question: 'Can I keep characters and locations consistent?',
                    answer: 'Yes. Projects preserve character references, scene information, visual style, and shot context, then reuse those assets for later images and videos to reduce visual drift.'
                },
                {
                    question: 'Can I regenerate only one shot?',
                    answer: 'Yes. Scripts, characters, scenes, keyframes, and videos can be revised in stages. A failed or unsatisfying shot can be retried on its own without regenerating the whole drama.'
                },
                {
                    question: 'Does it support dialogue, native audio, and subtitles?',
                    answer: 'Supported models can generate dialogue and ambient sound in the video. The project also includes subtitle workflows and multilingual subtitles. Native-audio capability and dialogue length depend on the selected model.'
                },
                {
                    question: 'What makes a good reference image?',
                    answer: 'Use a clear image with stable lighting and minimal obstruction. Character references work best when the face, hair, and clothing are visible; location references should show the space, materials, and key colors.'
                },
                {
                    question: 'Can I edit a generated storyboard?',
                    answer: 'Yes. Edit the shot description, action, dialogue, image prompt, or video prompt independently, then regenerate only the affected stage while keeping confirmed work.'
                }
            ]
        },
        {
            title: 'Generation, models, and pricing',
            items: [
                {
                    question: 'Does it support text-to-video and image-to-video?',
                    answer: 'Yes. Use a written description to generate a shot, or guide image-to-video with first frames, last frames, character references, and scene references. Models differ in duration, motion complexity, and native audio support.'
                },
                {
                    question: 'How are model calls charged?',
                    answer: 'The model supplier bills your own account for usage. The local application does not sell credits or process top-ups or payments.'
                },
                {
                    question: 'Can failed generations incur charges?',
                    answer: 'Charges depend on the selected supplier’s rules. Retrying may create another billable model request; inspect the task error first.'
                },
                {
                    question: 'How long does AI video generation take?',
                    answer: 'Timing depends on the model, shot duration, queue, and reference assets. Long jobs run in the background, and you can return later to see their status.'
                },
                {
                    question: 'Why do I need my own model account?',
                    answer: 'Generation requests use the supplier credentials you provide. The local workspace provides no shared allowance and does not purchase supplier usage for you.'
                },
                {
                    question: 'Can I switch models while a project is running?',
                    answer: 'You can change the model for future jobs. Submitted or running jobs keep the configuration they were created with; the new model applies to the next generation.'
                }
            ]
        },
        {
            title: 'Export and publishing',
            items: [
                {
                    question: 'What kinds of projects can I make?',
                    answer: 'Create vertical short dramas, AI short films, comics and animated stories, brand stories, ad clips, personal story videos, and multilingual social videos. Regional themes and visual styles can be selected when creating a project.'
                },
                {
                    question: 'Can I use the output for commercial projects?',
                    answer: 'The platform provides creation and export tools, but you must confirm the rights for models, reference assets, music, fonts, and likenesses. Check the rules of your target platform and region before publishing.'
                },
                {
                    question: 'Where can I view model costs and generation history?',
                    answer: 'Check actual charges in your model supplier’s console. Task progress and generated results are available in local project and asset pages.'
                },
                {
                    question: 'How do I download an image or video?',
                    answer: 'Open the asset in your project or My Works and use the preview area’s view or download action. Video covers can also be set and updated separately.'
                },
                {
                    question: 'Can I reassemble a full episode?',
                    answer: 'Yes. Once the shot videos are ready, reassemble the episode from the episode page. The current confirmed order and available videos are used without regenerating the images.'
                }
            ]
        },
        {
            title: 'Account and settings',
            items: [
                {
                    question: 'How do I change the interface language?',
                    answer: 'Use the language switcher in the page header. The selected language is kept for later visits and applies to navigation, settings, and help content.'
                },
                {
                    question: 'How do I change the default image or video model?',
                    answer: 'Open generation settings in a project or episode and choose a new default model. It applies to future jobs and does not change tasks that were already submitted.'
                },
                {
                    question: 'Where are projects and assets saved?',
                    answer: 'Project records are saved in the local data directory, with media in its media subdirectory. No online sign-in is required. Back up these files regularly.'
                }
            ]
        },
        {
            title: 'Troubleshooting',
            items: [
                {
                    question: 'What should I do if a job stays queued?',
                    answer: 'A queue usually means the selected model has reached its concurrency limit. Wait for the queue to move instead of submitting duplicates; if it remains unchanged for a long time, refresh the project and retry.'
                },
                {
                    question: 'Will refreshing the page cancel a running job?',
                    answer: 'No. Generation runs on the server, and refreshing only reloads the latest state. Return to the project or episode page to keep checking progress.'
                },
                {
                    question: 'What if reference media fails to upload?',
                    answer: 'Check the format, file size, and video duration shown in the upload area, then retry. If the selected model does not support that reference type, remove it or choose a compatible model.'
                },
                {
                    question: 'What if my model account runs out of quota?',
                    answer: 'Check your account quota in the selected supplier’s console, or choose another supplier configured with your own key.'
                }
            ]
        }
    ]
}

const localizedCopies: Partial<Record<Locale, FaqPageCopy>> = { en, zh }
const translatedCopies = new Map<Locale, FaqPageCopy>()

export function faqCopy(locale: Locale): FaqPageCopy {
    const localized = localizedCopies[locale]
    if (localized) return localized
    const cached = translatedCopies.get(locale)
    if (cached) return cached
    const translate = (value: string) => translateMessage(locale, value)
    const copy: FaqPageCopy = {
        heading: translate(zh.heading),
        intro: translate(zh.intro),
        homeLink: translate(zh.homeLink),
        browseAll: translate(zh.browseAll),
        quickBrowse: translate(zh.quickBrowse),
        cta: translate(zh.cta),
        shortDramaLink: translate(zh.shortDramaLink),
        categories: zh.categories.map(category => ({
            title: translate(category.title),
            items: category.items.map(item => ({ question: translate(item.question), answer: translate(item.answer) }))
        }))
    }
    translatedCopies.set(locale, copy)
    return copy
}

export const FAQ_SEO_LOCALE: Record<Locale, { title: string; description: string; keywords: string[] }> = {
    en: {
        title: 'AI Video FAQ — Short Drama, Storyboards & Credits',
        description: 'Help with local AI drama creation, personal model accounts, project storage and exports.',
        keywords: [
            'AI video generator FAQ',
            'AI short drama generator',
            'AI storyboard generator',
            'text to video',
            'image to video',
            'AI script generator',
            'AI video maker',
            'AI series creator',
            'video generation credits'
        ]
    },
    zh: {
        title: '常见问题 FAQ — AI 短剧、视频生成与 3000 金币',
        description: '关于本地 AI 短剧创作、个人模型账号、项目存储和导出的常见问题。',
        keywords: ['AI短剧生成器', 'AI视频生成器', 'AI分镜生成器', '故事转视频', '文生视频', '图生视频', 'AI短片制作', 'AI剧本生成器', 'AI连续剧生成器', 'AI视频制作']
    },
    fr: {
        title: 'FAQ du générateur vidéo IA — mini-séries, storyboard et crédits',
        description: 'Aide sur la création locale de mini-séries IA, les comptes de modèles personnels, le stockage et les exports.',
        keywords: ['FAQ générateur vidéo IA', 'générateur de mini-séries IA', 'storyboard IA', 'texte en vidéo', 'image en vidéo', 'script IA']
    },
    ar: {
        title: 'الأسئلة الشائعة حول مولّد الفيديو بالذكاء الاصطناعي',
        description: 'مساعدة حول إنشاء الدراما بالذكاء الاصطناعي محليًا وحسابات النماذج الشخصية وتخزين المشاريع وتصديرها.',
        keywords: ['الأسئلة الشائعة مولد فيديو بالذكاء الاصطناعي', 'مولد دراما قصيرة', 'لوحة مشاهد بالذكاء الاصطناعي', 'تحويل النص إلى فيديو', 'تحويل الصورة إلى فيديو']
    },
    id: {
        title: 'FAQ Generator Video AI — Drama Pendek, Storyboard, dan Kredit',
        description: 'Bantuan untuk pembuatan drama AI lokal, akun model pribadi, penyimpanan proyek, dan ekspor.',
        keywords: ['FAQ generator video AI', 'generator drama pendek AI', 'storyboard AI', 'teks ke video', 'gambar ke video', 'generator naskah AI']
    },
    hi: {
        title: 'AI वीडियो जनरेटर FAQ — शॉर्ट ड्रामा, स्टोरीबोर्ड और क्रेडिट',
        description: 'स्थानीय AI ड्रामा निर्माण, निजी मॉडल खातों, प्रोजेक्ट संग्रहण और निर्यात की सहायता।',
        keywords: ['AI वीडियो जनरेटर FAQ', 'AI शॉर्ट ड्रामा जनरेटर', 'AI स्टोरीबोर्ड जनरेटर', 'टेक्स्ट से वीडियो', 'इमेज से वीडियो']
    },
    fil: {
        title: 'FAQ ng AI Video Generator — Short Drama, Storyboard, at Credits',
        description: 'Tulong sa lokal na paggawa ng AI drama, personal na model account, pag-save ng proyekto at pag-export.',
        keywords: ['AI video generator FAQ', 'AI short drama generator', 'AI storyboard generator', 'text to video', 'image to video', 'AI script generator']
    },
    ja: {
        title: 'AI動画生成 FAQ — ショートドラマ・絵コンテ・クレジット',
        description: 'ローカルでのAIドラマ制作、個人のモデルアカウント、プロジェクトの保存と書き出しについて。',
        keywords: ['AI動画生成 FAQ', 'AIショートドラマ生成', 'AI絵コンテ生成', 'テキストから動画', '画像から動画']
    },
    ko: {
        title: 'AI 영상 생성기 FAQ — 숏드라마, 스토리보드, 크레딧',
        description: '로컬 AI 드라마 제작, 개인 모델 계정, 프로젝트 저장 및 내보내기 도움말.',
        keywords: ['AI 영상 생성기 FAQ', 'AI 숏드라마 생성기', 'AI 스토리보드 생성기', '텍스트를 영상으로', '이미지를 영상으로']
    }
}
