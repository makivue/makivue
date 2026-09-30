import { prisma } from '@/lib/prisma'
import { getProductionWorkflow, type WorkflowStageSpec } from './workflow'

type PipelineStage = 'setup' | 'outline' | 'chapter' | 'script' | 'extract' | 'reference' | 'storyboard' | 'frame' | 'video' | 'merge' | 'settings'

type PipelineSeverity = 'blocker' | 'warning' | 'info'

interface PipelineIssue {
    stage: PipelineStage
    severity: PipelineSeverity
    message: string
    episodeNumber?: number
    storyboardOrder?: number
    action?: string
}

interface PipelineStageSummary {
    stage: PipelineStage
    label: string
    status: 'ok' | 'warning' | 'blocked'
    blockers: number
    warnings: number
}

interface PipelineNextAction {
    key: string
    label: string
    stage: PipelineStage
    kind: 'navigate' | 'run'
    priority: 'blocker' | 'warning' | 'info'
    episodeNumber?: number
    storyboardOrder?: number
    targetTab?: 'workflow' | 'novel' | 'episodes' | 'characters' | 'scenes'
    novelStage?: 'setup' | 'outlined' | 'drafting' | 'finalized'
    message: string
}

export interface PipelineReport {
    projectId: bigint
    title: string
    workflow: WorkflowStageSpec[]
    nextActions: PipelineNextAction[]
    issues: PipelineIssue[]
    stages: PipelineStageSummary[]
    ready: {
        outline: boolean
        chapterDraft: boolean
        script: boolean
        extract: boolean
        storyboard: boolean
        frame: boolean
        video: boolean
        merge: boolean
    }
}

const STAGE_LABEL: Record<PipelineStage, string> = {
    setup: '小说架构',
    outline: '大纲',
    chapter: '章节正文',
    script: '拆剧本',
    extract: '角色/场景提取',
    reference: '参考图',
    storyboard: '分镜',
    frame: '首尾帧',
    video: '镜头视频',
    merge: '整集合并',
    settings: '模型配置'
}

const STAGE_ORDER: PipelineStage[] = ['settings', 'setup', 'outline', 'chapter', 'script', 'extract', 'reference', 'storyboard', 'frame', 'video', 'merge']
const STAGE_RANK = new Map(STAGE_ORDER.map((stage, index) => [stage, index]))

function stageRank(stage: PipelineStage): number {
    return STAGE_RANK.get(stage) ?? STAGE_ORDER.length
}

function pushIssue(issues: PipelineIssue[], issue: PipelineIssue) {
    issues.push(issue)
}

function actionForIssue(issue: PipelineIssue): PipelineNextAction | null {
    const priority = issue.severity === 'blocker' ? 'blocker' : issue.severity === 'warning' ? 'warning' : 'info'
    const base = {
        stage: issue.stage,
        priority,
        episodeNumber: issue.episodeNumber,
        storyboardOrder: issue.storyboardOrder,
        message: issue.message
    } satisfies Pick<PipelineNextAction, 'stage' | 'priority' | 'episodeNumber' | 'storyboardOrder' | 'message'>

    if (issue.stage === 'settings') return null
    if (issue.stage === 'setup') return { ...base, key: 'open-setup', label: '完善小说架构', kind: 'navigate', targetTab: 'novel', novelStage: 'setup' }
    if (issue.stage === 'outline') return { ...base, key: 'open-outline', label: '处理大纲', kind: 'navigate', targetTab: 'novel', novelStage: 'outlined' }
    if (issue.stage === 'chapter') return { ...base, key: 'open-chapter', label: '生成章节正文', kind: 'navigate', targetTab: 'novel', novelStage: 'drafting' }
    if (issue.stage === 'script') return { ...base, key: 'open-script', label: '拆剧本', kind: 'navigate', targetTab: 'novel', novelStage: 'finalized' }
    if (issue.stage === 'extract') return { ...base, key: 'open-extract', label: '提取角色/场景', kind: 'navigate', targetTab: 'novel', novelStage: 'finalized' }
    if (issue.stage === 'reference') {
        const isScene = issue.message.includes('场景')
        return {
            ...base,
            key: isScene ? 'open-scenes' : 'open-characters',
            label: isScene ? '处理场景参考图' : '处理角色参考图',
            kind: 'navigate',
            targetTab: isScene ? 'scenes' : 'characters'
        }
    }
    if (['storyboard', 'frame', 'video', 'merge'].includes(issue.stage)) {
        return {
            ...base,
            key: `open-episode-${issue.episodeNumber ?? 'first'}`,
            label: issue.stage === 'storyboard' ? '处理分镜' : '处理镜头生产',
            kind: 'navigate',
            targetTab: 'episodes'
        }
    }
    return null
}

function buildNextActions(issues: PipelineIssue[]): PipelineNextAction[] {
    const seen = new Set<string>()
    const sorted = issues.slice().sort((a, b) => {
        const score = (s: PipelineSeverity) => (s === 'blocker' ? 0 : s === 'warning' ? 1 : 2)
        return score(a.severity) - score(b.severity) || stageRank(a.stage) - stageRank(b.stage) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
    })
    const actions: PipelineNextAction[] = []
    for (const issue of sorted) {
        const action = actionForIssue(issue)
        if (!action) continue
        const dedupeKey = `${action.key}:${action.episodeNumber ?? ''}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        actions.push(action)
        if (actions.length >= 8) break
    }
    return actions
}

function getActionableIssues(issues: PipelineIssue[]): PipelineIssue[] {
    const blockers = issues.filter(issue => issue.severity === 'blocker').sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))

    const firstBlocker = blockers[0]
    if (firstBlocker) {
        const blockerRank = stageRank(firstBlocker.stage)
        return issues.filter(issue => {
            const rank = stageRank(issue.stage)
            if (issue.severity === 'blocker') return rank === blockerRank
            return rank <= blockerRank
        })
    }

    const firstWarning = issues.filter(issue => issue.severity === 'warning').sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0]

    if (!firstWarning) return []
    const warningRank = stageRank(firstWarning.stage)
    return issues.filter(issue => stageRank(issue.stage) === warningRank)
}

export async function getProjectPipelineReport(projectId: bigint): Promise<PipelineReport> {
    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        include: {
            episodes: {
                where: { deletedAt: null },
                orderBy: { episodeNumber: 'asc' },
                include: {
                    storyboards: {
                        where: { deletedAt: null },
                        orderBy: { order: 'asc' },
                        include: {
                            scene: true,
                            characters: { include: { character: true } },
                            generations: { where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 3 }
                        }
                    },
                    merges: { orderBy: { createdAt: 'desc' }, take: 1 }
                }
            },
            characters: { where: { deletedAt: null } },
            scenes: { where: { deletedAt: null } }
        }
    })
    if (!project) throw new Error('Project not found')

    const issues: PipelineIssue[] = []

    if (!project.novelSetup) {
        pushIssue(issues, { stage: 'setup', severity: 'warning', message: '缺少小说架构，生成类型、角色和长线剧情约束会不稳定', action: '完善小说架构并保存' })
    }
    const totalEpisodes = project.totalEpisodes ?? 1
    if (project.episodes.length !== totalEpisodes) {
        pushIssue(issues, {
            stage: 'outline',
            severity: 'blocker',
            message: `章节数量不一致：项目设定 ${totalEpisodes} 章，实际 ${project.episodes.length} 章`,
            action: '重新生成或补齐大纲'
        })
    }

    for (const ep of project.episodes) {
        if (!ep.title || !ep.synopsis) {
            pushIssue(issues, { stage: 'outline', severity: 'blocker', episodeNumber: ep.episodeNumber, message: '缺少标题或章节梗概', action: '补齐大纲' })
        }

        if (!ep.chapterContent?.trim()) {
            pushIssue(issues, { stage: 'chapter', severity: 'blocker', episodeNumber: ep.episodeNumber, message: '缺少章节正文', action: '生成或手动补齐章节正文' })
        }
        if (!ep.script?.trim()) {
            pushIssue(issues, { stage: 'script', severity: 'blocker', episodeNumber: ep.episodeNumber, message: '缺少短剧剧本', action: '拆剧本' })
        }

        if (ep.script && ep.storyboards.length === 0) {
            pushIssue(issues, { stage: 'storyboard', severity: 'blocker', episodeNumber: ep.episodeNumber, message: '剧本已存在但未生成分镜', action: '生成分镜' })
        }

        for (const sb of ep.storyboards) {
            const tag = { episodeNumber: ep.episodeNumber, storyboardOrder: sb.order }
            if (!sb.imagePrompt?.trim()) {
                pushIssue(issues, { stage: 'storyboard', severity: 'blocker', ...tag, message: '分镜缺少 imagePrompt', action: '重新生成或编辑分镜' })
            }
            if (!sb.firstFrameUrl) {
                pushIssue(issues, { stage: 'frame', severity: 'blocker', ...tag, message: '缺少主插图', action: '生成主插图' })
            }
            if (!sb.videoUrl) {
                pushIssue(issues, { stage: 'video', severity: 'blocker', ...tag, message: '缺少镜头视频', action: '生成视频' })
            }
            for (const g of sb.generations) {
                if (!g.errorMsg || !['video', 'first_frame', 'middle_frame', 'last_frame', 'illustrations'].includes(g.type)) continue
                pushIssue(issues, { stage: g.type === 'video' ? 'video' : 'frame', severity: 'warning', ...tag, message: `最近生成失败：${g.errorMsg}` })
            }
        }

        const latestMerge = ep.merges[0]
        if (ep.storyboards.length > 0 && ep.storyboards.every(sb => sb.videoUrl) && !ep.videoUrl && latestMerge?.status !== 'processing') {
            pushIssue(issues, { stage: 'merge', severity: 'warning', episodeNumber: ep.episodeNumber, message: '所有原声镜头已生成，但尚未合并整集', action: '合并整集' })
        }
    }

    if (project.characters.length === 0) {
        pushIssue(issues, { stage: 'extract', severity: 'blocker', message: '还没有角色卡', action: '从剧本提取角色/场景' })
    }
    if (project.scenes.length === 0) {
        pushIssue(issues, { stage: 'extract', severity: 'warning', message: '还没有场景库，分镜会更难保持环境一致', action: '从剧本提取角色/场景' })
    }
    for (const ch of project.characters) {
        if (!ch.appearancePrompt?.trim()) {
            pushIssue(issues, { stage: 'extract', severity: 'blocker', message: `角色「${ch.name}」缺少外貌描述`, action: '补齐角色卡' })
        }
        if (!ch.referenceImageUrl) {
            pushIssue(issues, { stage: 'reference', severity: 'warning', message: `角色「${ch.name}」缺少参考图`, action: '生成角色参考图' })
        }
    }
    for (const scene of project.scenes) {
        if (!scene.locationPrompt?.trim()) {
            pushIssue(issues, { stage: 'extract', severity: 'warning', message: `场景「${scene.name}」缺少英文环境描述`, action: '补齐场景描述' })
        }
        if (!scene.referenceImageUrl) {
            pushIssue(issues, { stage: 'reference', severity: 'warning', message: `场景「${scene.name}」缺少参考图`, action: '生成场景参考图' })
        }
    }

    const actionableIssues = getActionableIssues(issues)
    const stages = STAGE_ORDER.map(stage => {
        const stageIssues = actionableIssues.filter(i => i.stage === stage)
        const blockers = stageIssues.filter(i => i.severity === 'blocker').length
        const warnings = stageIssues.filter(i => i.severity === 'warning').length
        return {
            stage,
            label: STAGE_LABEL[stage],
            status: blockers > 0 ? 'blocked' : warnings > 0 ? 'warning' : 'ok',
            blockers,
            warnings
        } satisfies PipelineStageSummary
    })

    const hasBlocker = (stage: PipelineStage) => issues.some(i => i.stage === stage && i.severity === 'blocker')

    return {
        projectId,
        title: project.title,
        workflow: getProductionWorkflow(),
        nextActions: buildNextActions(actionableIssues),
        issues: actionableIssues,
        stages,
        ready: {
            outline: !hasBlocker('settings') && !hasBlocker('setup'),
            chapterDraft: !hasBlocker('outline'),
            script: !hasBlocker('chapter'),
            extract: !hasBlocker('script'),
            storyboard: !hasBlocker('script') && !hasBlocker('extract'),
            frame: !hasBlocker('storyboard') && !hasBlocker('reference'),
            video: !hasBlocker('frame'),
            merge: !hasBlocker('video')
        }
    }
}
