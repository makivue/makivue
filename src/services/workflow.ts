export type WorkflowStageKey = 'settings' | 'setup' | 'outline' | 'chapter' | 'script' | 'extract' | 'reference' | 'storyboard' | 'frame' | 'video' | 'merge'

export interface WorkflowStageSpec {
    key: WorkflowStageKey
    label: string
    goal: string
    skillIds: string[]
    inputs: string[]
    outputs: string[]
    failurePolicy: string
    inspiration: string
}

const PRODUCTION_WORKFLOW: WorkflowStageSpec[] = [
    {
        key: 'settings',
        label: '模型与上传配置',
        goal: '先保证文本、图片、视频、本地存储 和 ffmpeg 链路可用。',
        skillIds: ['pipeline-orchestrator'],
        inputs: ['AI service config', 'local data directory', 'provider keys'],
        outputs: ['可调用模型', '本地素材路径', '本地合成能力'],
        failurePolicy: '阻断后续生成，先修配置。',
        inspiration: 'ClawHub 工具型 skills 通常先声明依赖和运行前检查。'
    },
    {
        key: 'setup',
        label: '故事圣经',
        goal: '建立不可违背的世界观、人物弧光、主类型和长线卖点。',
        skillIds: ['pipeline-orchestrator', 'novel-outline-architect'],
        inputs: ['项目标题', '主类型', '简介', '用户补充设定'],
        outputs: ['coreSeed', 'worldBible', 'plotArchitecture', 'characterArcs', 'primaryGenre'],
        failurePolicy: '请手动补充设定后继续。',
        inspiration: '长篇小说 skills 普遍先建 bible / memory。'
    },
    {
        key: 'outline',
        label: '全剧大纲',
        goal: '基于完整小说素材或故事圣经，规划每章剧情、强度曲线、首尾视觉状态和伏笔回收。',
        skillIds: ['pipeline-orchestrator', 'novel-outline-architect'],
        inputs: ['故事圣经', '完整小说/原始素材', '章节数'],
        outputs: ['章节标题', '章节梗概', 'intensity', 'episodeStatePlan'],
        failurePolicy: '阻断正文生成，必须先补齐大纲。',
        inspiration: 'open-novel-writing 的章节 spec / 状态前后变化模式。'
    },
    {
        key: 'chapter',
        label: '连续小说正文',
        goal: '逐章生成正文，全文前文优先，保证叙事、伏笔、人物关系和结尾画面连续。',
        skillIds: ['pipeline-orchestrator', 'continuous-chapter-writer'],
        inputs: ['全剧大纲', '故事圣经', '全部前文正文', '全前文剧情账本'],
        outputs: ['chapterContent'],
        failurePolicy: '单章自动重试 3 次；最终失败则暂停后续章节。',
        inspiration: 'novel-continuation 类 skills 的“通读全文再续写”原则。'
    },
    {
        key: 'script',
        label: '短剧剧本',
        goal: '把正文改编成可直接进入分镜的可拍剧本，写清场景、人物状态、动作、表情与对白表演，同时保留全部前文关系和跨集首尾状态。',
        skillIds: ['pipeline-orchestrator', 'screenplay-adapter'],
        inputs: ['当前章节正文', '全部前文剧本/正文', '角色白名单', 'episodeStatePlan'],
        outputs: ['episode.script', '本集标题/简介', '结构化场景/人物状态/动作/表情'],
        failurePolicy: '批量时失败暂停，避免后续剧本建立在断裂状态上。',
        inspiration: 'screenplay / director workflow：先锁角色、状态和场景，再写对白。'
    },
    {
        key: 'extract',
        label: '角色/场景提取',
        goal: '从全剧本批量提取并去重整理角色卡和场景库，建立视觉一致性的实体白名单。',
        skillIds: ['pipeline-orchestrator', 'entity-bible-extractor'],
        inputs: ['全部已生成剧本', '已有角色/场景'],
        outputs: ['Character', 'Scene'],
        failurePolicy: '分批重试；失败时保留已确认实体，阻断参考图和分镜白名单。',
        inspiration: 'character-design-sheet / scene bible 类 skills 的实体卡模式。'
    },
    {
        key: 'reference',
        label: '参考图',
        goal: '生成单张全身角色参考图或场景参考图，保存在本地。',
        skillIds: ['pipeline-orchestrator', 'reference-image-director'],
        inputs: ['角色卡', '场景卡', '视觉风格'],
        outputs: ['referenceImageUrl'],
        failurePolicy: '可重试；缺少参考图时允许继续但标记一致性风险。',
        inspiration: 'character consistency / design sheet workflows。'
    },
    {
        key: 'storyboard',
        label: '分镜',
        goal: '把剧本拆成稳定、可生成、可剪辑的镜头，每镜只承载一个动作或情绪变化。',
        skillIds: ['pipeline-orchestrator', 'storyboard-orchestrator'],
        inputs: ['剧本', '角色/场景列表', '视觉风格'],
        outputs: ['Storyboard[]'],
        failurePolicy: '失败可重试；若缺角色/场景白名单则阻断。',
        inspiration: 'seedance-story-orchestrator 的 checkpoint / shot spec 思路。'
    },
    {
        key: 'frame',
        label: '主插图/镜内插图',
        goal: '使用分镜描述和角色参考图生成主插图，额外插图由用户按需生成。',
        skillIds: ['pipeline-orchestrator', 'frame-video-generator'],
        inputs: ['Storyboard', '角色参考图'],
        outputs: ['firstFrameUrl', 'middleFrame generations'],
        failurePolicy: '图片失败可重试；主插图缺失时阻断本镜视频，但不影响其他镜头。',
        inspiration: 'image prompt / reference consistency workflows。'
    },
    {
        key: 'video',
        label: '图生视频',
        goal: '基于本镜描述和素材，使用用户选定的模型生成视频。',
        skillIds: ['pipeline-orchestrator', 'frame-video-generator'],
        inputs: ['firstFrameUrl', '可选原生首尾帧', 'video prompt'],
        outputs: ['带原声的 videoUrl'],
        failurePolicy: '限流自动退避；视频失败时阻断整集合并。',
        inspiration: '模型原生视频输入能力。'
    },
    {
        key: 'merge',
        label: '整集合并',
        goal: '按分镜顺序拼接整集，输出最终 episode video。',
        skillIds: ['pipeline-orchestrator', 'video-postproduction'],
        inputs: ['videoUrl[]'],
        outputs: ['episode.videoUrl'],
        failurePolicy: '缺任一镜头时阻断；失败可重试。',
        inspiration: 'video-merger / ffmpeg concat 工作流。'
    }
]

export function getProductionWorkflow() {
    return PRODUCTION_WORKFLOW
}
