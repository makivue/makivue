// Shared by visible homepage content and structured data.
export const CREATION_MODELS = [
    {
        category: 'AI 视频模型',
        id: 'seedance',
        actionModel: 'Seedance',
        names: ['Seedance 2.5', 'Seedance 2.0'],
        description:
            '在 Local Drama Studio 使用 Seedance 2.5 和 Seedance 2.0 制作 AI 短剧镜头与视频片段。2.5 支持多模态参考，2.0 支持首尾帧引导，两者均支持同步原声，可用于有对白、动作和镜头衔接需求的创作。',
        product: 'video'
    },
    {
        category: 'AI 视频模型',
        id: 'wan',
        actionModel: 'Wan',
        names: ['Wan 3.0', 'Wan 3.0 Prime'],
        description:
            'Local Drama Studio 的 AI 视频工具提供 Wan 3.0 与 Wan 3.0 Prime。Wan 3.0 支持多模态参考与最长 30 秒的视频生成，Prime 提供 1080p 输出，可用于制作人物表演、动态场景和较长的剧情片段。',
        product: 'video'
    },
    {
        category: 'AI 视频模型',
        id: 'minimax-h3',
        actionModel: 'MiniMax H3',
        names: ['MiniMax H3'],
        description: '通过 Local Drama Studio 使用 MiniMax H3 生成多镜头视频，支持多模态参考与原生音频，最高 2K、最长 15 秒。适合尝试景别变化、人物动作和环境声音，再根据生成结果调整提示与参考素材。',
        product: 'video'
    },
    {
        category: 'AI 图片模型',
        id: 'nano-banana',
        actionModel: 'Nano Banana',
        names: ['Nano Banana', 'Gemini 3.1 Flash Image'],
        description:
            '在 Local Drama Studio 使用 Nano Banana 和 Gemini 3.1 Flash Image 生成角色图、场景图与分镜图片。通过文字和参考图片引导外观、构图与风格，在生成视频前检查服装和环境细节，为短剧制作准备视觉素材。',
        product: 'image'
    },
    {
        category: 'AI 图片模型',
        id: 'qwen-seedream',
        actionModel: 'Qwen / Seedream',
        names: ['Qwen-Image-3.0-Pro', 'Seedream 5.0 Lite'],
        description: 'Local Drama Studio 的 AI 图片工具支持 Qwen-Image-3.0-Pro 文生图与参考图创作，可用于角色、场景和分镜素材。也可以选择 Seedream 5.0 Lite，通过 2K 文生图探索构图和视觉风格。',
        product: 'image'
    },
    {
        category: 'AI 剧本模型',
        id: 'gemini',
        actionModel: 'Gemini',
        names: ['Gemini 3.7 Flash'],
        description: '在 Local Drama Studio 使用 Gemini 3.7 Flash 辅助生成剧情大纲、分集剧本与分镜描述。检查人物关系、剧情节奏和对白，将确认后的剧本继续用于角色设计、场景生成与 AI 短剧制作。',
        product: 'drama'
    }
] as const
