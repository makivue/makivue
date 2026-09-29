import { extractStoryboardBoundaryStates } from './storyboard-state'
import { analyzeVideoShotConstraints } from './video-production-plan'
import type { ProductionVideoProvider } from './provider-capabilities'

export interface ReadinessShot {
    id: string | bigint
    order: number
    duration: number | null
    shotType?: string | null
    actionDesc?: string | null
    imagePrompt?: string | null
    dialogue?: string | null
    continuityMode?: string | null
    scene?: { id: string | bigint } | null
    firstFrameUrl?: string | null
    frameStatus?: string | null
    videoUrl?: string | null
    videoStatus?: string | null
    latestVideoRequest?: { status: string; provider?: string | null } | null
}

export interface ShotReadinessIssue {
    code: string
    message: string
    suggestion: string
}

export function isShotFrameReady(shot: ReadinessShot): boolean {
    return !!shot.firstFrameUrl && shot.frameStatus === 'completed'
}

export function isShotVideoReady(shot: ReadinessShot): boolean {
    return !!shot.videoUrl && shot.videoStatus === 'completed' && (!shot.latestVideoRequest || shot.latestVideoRequest.status === 'completed')
}

/** Editorial preflight, not a claim that generated pixels have been inspected. */
export function reviewShotReadiness(shot: ReadinessShot, previous?: ReadinessShot, provider?: ProductionVideoProvider): ShotReadinessIssue[] {
    const issues: ShotReadinessIssue[] = []
    if (!shot.imagePrompt?.trim()) issues.push({ code: 'missing_image_prompt', message: '缺少画面描述', suggestion: '先写清主体、构图与场景光线，再生成插图。' })
    const states = extractStoryboardBoundaryStates(shot.actionDesc)
    if (!states.openingState || !states.endingState) {
        issues.push({ code: 'missing_boundary', message: '镜头首尾状态不完整', suggestion: '补齐开场与结束时的动作、视线、道具和人物位置。' })
    }
    if (typeof shot.duration !== 'number' || !Number.isFinite(shot.duration) || shot.duration <= 0) {
        issues.push({ code: 'invalid_duration', message: '镜头时长无效', suggestion: '设置足够完成本镜动作与对白的时长。' })
    } else {
        const constraints = analyzeVideoShotConstraints({ ...shot, provider })
        if (constraints.dialogueHandling === 'split') issues.push({ code: 'dialogue_overflow', message: '对白超出镜头时长', suggestion: '按自然停顿拆分对白，或在模型支持范围内延长镜头。' })
        else if (constraints.estimatedDialogueSeconds > shot.duration * 1.12)
            issues.push({ code: 'dialogue_timing', message: '对白可能超出当前时长', suggestion: '检查完整台词的自然语速与停顿，延长本镜或拆镜后再生成。' })
        if (constraints.actionHandling === 'split') issues.push({ code: 'action_overload', message: '动作阶段过于密集', suggestion: '将连续复杂动作拆成起因、接触与结果相接的镜头。' })
    }
    if (previous && ['stateful', 'continuous', 'seamless'].includes(shot.continuityMode ?? '')) {
        if (shot.scene?.id != null && previous.scene?.id != null && String(shot.scene.id) !== String(previous.scene.id)) {
            issues.push({ code: 'continuity_scene_change', message: '连续镜头切换了场景', suggestion: '确认是否转场；若地点确实改变，交代空间过渡并使用独立镜头。' })
        } else if (!extractStoryboardBoundaryStates(previous.actionDesc).endingState) {
            issues.push({ code: 'missing_previous_ending', message: '上一镜缺少结束状态', suggestion: '先补齐上一镜结束画面，明确本镜从哪里接入。' })
        }
    }
    return issues
}
