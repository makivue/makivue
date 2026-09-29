export type EpisodeBatchPhase = 'running' | 'split_required' | 'done' | 'error' | 'cancelled'
export type EpisodeBatchShotStatus = 'pending' | 'frame_running' | 'frame_done' | 'video_running' | 'video_done' | 'failed' | 'skipped'
export type EpisodeBatchFailureStage = 'frame' | 'video'

export type EpisodeBatchShot = {
    storyboardId: string
    order: number
    status: EpisodeBatchShotStatus
    errorMsg?: string
    failedStage?: EpisodeBatchFailureStage
}

export function resolveEpisodeBatchFailureStage(shot: Pick<EpisodeBatchShot, 'status' | 'errorMsg' | 'failedStage'>): EpisodeBatchFailureStage | undefined {
    if (shot.status !== 'failed') return undefined
    if (shot.failedStage) return shot.failedStage
    const message = shot.errorMsg ?? ''
    if (/seedance|veo|wanx|wan\s*3|happy\s*horse|video|视频|InputImageSensitiveContent|submit.*task|poll.*task/i.test(message)) return 'video'
    if (/banana|qwen|gpt\s*image|seedream|image|图片|插图|首图|主图|参考图/i.test(message)) return 'frame'
    return undefined
}

const EPISODE_BATCH_EXECUTOR_INTERRUPTED = /任务租约过期|自动回收|实例心跳中断|服务实例.*中断|发布.*重启/i

export function isEpisodeBatchExecutorInterrupted(snapshot: { phase: EpisodeBatchPhase; shots: EpisodeBatchShot[]; errorMsg?: string }) {
    if (snapshot.phase !== 'error') return false
    return EPISODE_BATCH_EXECUTOR_INTERRUPTED.test([snapshot.errorMsg, ...snapshot.shots.map(shot => shot.errorMsg)].filter(Boolean).join('\n'))
}

export function normalizeTerminalBatchShots(shots: EpisodeBatchShot[], phase: EpisodeBatchPhase): EpisodeBatchShot[] {
    if (phase === 'running' || phase === 'split_required') return shots
    return shots.map(shot => {
        if (shot.status !== 'pending' && shot.status !== 'frame_running' && shot.status !== 'frame_done' && shot.status !== 'video_running') return shot
        return {
            ...shot,
            status: 'skipped',
            errorMsg: shot.errorMsg ?? (phase === 'cancelled' ? '任务已暂停，该镜头尚未完成' : '批量任务已结束，但该镜头未完成；可再次一键生成继续')
        }
    })
}

export function summarizeEpisodeBatchShots(shots: EpisodeBatchShot[]) {
    return {
        completed: shots.filter(shot => shot.status === 'video_done').length,
        failed: shots.filter(shot => shot.status === 'failed').length,
        skipped: shots.filter(shot => shot.status === 'skipped').length,
        running: shots.filter(shot => shot.status === 'frame_running' || shot.status === 'video_running').length
    }
}
