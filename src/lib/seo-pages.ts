export const seoPageSlugs = ['ai-short-drama-generator', 'ai-storyboard-generator', 'ai-video-generator'] as const
export type SeoPageSlug = (typeof seoPageSlugs)[number]

type SeoPageContent = {
    title: string
    description: string
    eyebrow: string
    heading: string
    intro: string
    benefits: Array<{ title: string; description: string }>
    steps: Array<{ title: string; description: string }>
    useCases: string[]
    faqs: Array<{ question: string; answer: string }>
}

export const seoPages: Record<SeoPageSlug, SeoPageContent> = {
    'ai-short-drama-generator': {
        title: 'AI 短剧生成器：从故事创意到完整成片',
        description: '在线使用 AI 生成短剧剧本、角色、分镜、画面、带原声视频和多语言字幕，在一个工作流中完成可发布的短剧。',
        eyebrow: 'AI 短剧生成器',
        heading: '把一个故事创意变成完整 AI 短剧',
        intro: '无需在多个模型和剪辑工具之间来回切换。输入剧名、简介或个人经历，系统会逐步生成故事结构、分集剧本、角色和场景资产，再完成分镜、带原声视频、字幕与成片合成。',
        benefits: [
            { title: '完整创作链路', description: '从故事方向到最终视频都保存在同一个项目中，随时继续或局部重做。' },
            { title: '角色与场景一致', description: '通过参考图、视觉风格和镜头上下文，减少角色长相与场景风格漂移。' },
            { title: '适合全球发布', description: '支持多语言页面、原声对白与字幕工作流，让同一个故事触达不同地区的观众。' }
        ],
        steps: [
            { title: '输入故事', description: '填写一个想法、剧名、简介，或从自己的经历开始。' },
            { title: '确认剧本和资产', description: '查看并调整故事结构、角色、场景、风格和分镜。' },
            { title: '生成并导出', description: '按镜头生成画面、视频和声音，检查后合成为完整短剧。' }
        ],
        useCases: ['竖屏连续短剧', '漫画与动画短剧', '个人故事影像化', '品牌故事和社交媒体视频'],
        faqs: [
            { question: '没有写作经验也能生成短剧吗？', answer: '可以。你只需要提供一个简单想法，AI 会通过故事方向、结构和分集步骤帮助你逐步完成内容。' },
            { question: '生成失败后需要整部重新制作吗？', answer: '不需要。项目支持按剧本、分镜、图片或视频阶段局部调整和重新生成。' },
            { question: '生成短剧如何收费？', answer: '账户采用预付余额，文本、图片和视频按照所选模型与实际生成量扣费，生成前会进行余额检查。' }
        ]
    },
    'ai-storyboard-generator': {
        title: 'AI 分镜生成器：自动生成镜头脚本和首尾帧',
        description: '把小说或剧本自动拆解成可执行的 AI 分镜，生成景别、机位、动作、对白、画面提示词和首尾帧参考。',
        eyebrow: 'AI 分镜生成器',
        heading: '把剧本转换成可直接生成视频的分镜',
        intro: 'AI 会识别每场戏的角色、地点、动作和对白，把连续剧情拆成明确的镜头单元。每个分镜都包含时长、景别、运镜、画面描述、视频动作和声音信息，方便检查与局部修改。',
        benefits: [
            { title: '镜头信息结构化', description: '景别、构图、运镜、动作、对白和时长不再混在一段提示词里。' },
            { title: '连接角色与场景资产', description: '每个镜头引用项目内已确认的角色和场景，提升跨镜头一致性。' },
            { title: '支持首帧、尾帧和中间帧', description: '用关键帧约束动作过程和镜头衔接，减少视频模型自由漂移。' }
        ],
        steps: [
            { title: '导入剧本', description: '使用 AI 生成的剧本，或导入已有小说和脚本。' },
            { title: '自动拆镜', description: '系统按场景、动作和对白拆分镜头，并匹配角色与场景。' },
            { title: '确认关键帧', description: '编辑提示词并生成首尾帧，满意后再进入高成本视频生成。' }
        ],
        useCases: ['短剧预演', '动画分镜', '广告镜头规划', 'AI 视频提示词准备'],
        faqs: [
            { question: 'AI 分镜和普通提示词有什么区别？', answer: '分镜把镜头时长、角色、场景、构图、动作和声音拆成结构化字段，更适合连续视频生产和局部修正。' },
            { question: '可以手动修改 AI 生成的分镜吗？', answer: '可以。每个分镜都可以独立调整，修改后只需重新生成受影响的画面或视频。' },
            { question: '为什么要先确认关键帧再生成视频？', answer: '视频费用通常高于图片。先确认角色、场景和构图，可以明显减少昂贵的视频返工。' }
        ]
    },
    'ai-video-generator': {
        title: 'AI 视频生成器：多模型镜头生成与短剧合成',
        description: '针对每个分镜选择合适的视频模型，以首帧、尾帧、参考图和动作描述控制生成。长任务异步执行，失败镜头可以单独重试，无需因为一个镜头重新生成整集。',
        eyebrow: 'AI 视频生成器',
        heading: '从关键帧生成连续镜头并合成为短剧',
        intro: '针对每个分镜选择合适的视频模型，以首帧、尾帧、参考图和动作描述控制生成。长任务异步执行，失败镜头可以单独重试，无需因为一个镜头重新生成整集。',
        benefits: [
            { title: '多模型选择', description: '根据画面风格、动作复杂度、时长和预算选择不同视频服务。' },
            { title: '任务可恢复', description: '生成状态、错误类型和结果都保存在项目中，页面刷新后仍可继续处理。' },
            { title: '原声与合成', description: '视频模型直接生成镜头原声，随后完成字幕、镜头检查和整集导出。' }
        ],
        steps: [
            { title: '准备关键帧', description: '确认角色、场景、首帧、尾帧和动作方向。' },
            { title: '选择模型生成', description: '设置视频模型、参考方式和时长，然后异步生成镜头。' },
            { title: '检查并合成', description: '只重做有问题的镜头，完成字幕后导出整集。' }
        ],
        useCases: ['AI 短剧镜头', '图生视频', '动画片段', '多语言社交视频'],
        faqs: [
            { question: 'AI 视频生成需要等待多久？', answer: '时间取决于模型、时长和当前服务队列。任务会在后台运行，页面通过渐进轮询更新状态，不需要持续保持请求连接。' },
            { question: '遇到 429 或超时会怎样？', answer: '系统会限制并发，对可安全重试的查询使用退避策略，并保留失败状态供单镜头重新生成。' },
            { question: '可以控制每次生成的费用吗？', answer: '可以。系统按照模型和视频时长估算费用，启用计费后会在生成前检查余额，并在成功后幂等扣费。' }
        ]
    }
}

export function isSeoPageSlug(value: string): value is SeoPageSlug {
    return seoPageSlugs.includes(value as SeoPageSlug)
}
