export type StoryboardGenerationFeedbackStage = 'frame' | 'video'

export type StoryboardGenerationFeedbackError = {
    errorMsg: string
    provider?: string | null
    createdAt?: string | null
}

export type StoryboardGenerationFeedbackItem = {
    id: string
    order: number
    frameStatus?: string | null
    videoStatus?: string | null
    latestErrors?: Record<string, StoryboardGenerationFeedbackError | undefined>
}

type StoryboardGenerationFailureNotice = {
    failureKey: string
    watchKey: string
    message: string
}

const FEEDBACK_STAGES: StoryboardGenerationFeedbackStage[] = ['frame', 'video']

export function generationFeedbackStageForRequest(type: string): StoryboardGenerationFeedbackStage | null {
    if (type === 'illustrations' || type === 'first_frame' || type === 'last_frame') return 'frame'
    if (type === 'video') return type
    return null
}

export function generationFeedbackWatchKey(storyboardId: string, stage: StoryboardGenerationFeedbackStage) {
    return `${storyboardId}:${stage}`
}

function stageStatus(storyboard: StoryboardGenerationFeedbackItem, stage: StoryboardGenerationFeedbackStage) {
    return stage === 'frame' ? storyboard.frameStatus : storyboard.videoStatus
}

function stageError(storyboard: StoryboardGenerationFeedbackItem, stage: StoryboardGenerationFeedbackStage): StoryboardGenerationFeedbackError | undefined {
    if (stage === 'frame') {
        return storyboard.latestErrors?.first_frame ?? storyboard.latestErrors?.middle_frame ?? storyboard.latestErrors?.last_frame ?? storyboard.latestErrors?.illustrations
    }
    return storyboard.latestErrors?.[stage]
}

function failureKey(storyboard: StoryboardGenerationFeedbackItem, stage: StoryboardGenerationFeedbackStage, error: StoryboardGenerationFeedbackError) {
    return [storyboard.id, stage, error.createdAt ?? '', error.provider ?? '', error.errorMsg].join(':')
}

function stageLabel(stage: StoryboardGenerationFeedbackStage) {
    return stage === 'frame' ? '插图' : '视频'
}

/**
 * Detect failures that completed while this page was watching them. Historical
 * failures are ignored, while a newly persisted error for a request submitted
 * by this page is still reported even when it fails before the first poll.
 */
export function collectStoryboardGenerationFailureNotices(params: {
    previous: StoryboardGenerationFeedbackItem[]
    current: StoryboardGenerationFeedbackItem[]
    watchedKeys: ReadonlySet<string>
    shownFailureKeys: ReadonlySet<string>
}) {
    const previousById = new Map(params.previous.map(storyboard => [storyboard.id, storyboard]))
    const notices: StoryboardGenerationFailureNotice[] = []
    const resolvedWatchKeys = new Set<string>()

    for (const storyboard of params.current) {
        const previous = previousById.get(storyboard.id)
        for (const stage of FEEDBACK_STAGES) {
            const watchKey = generationFeedbackWatchKey(storyboard.id, stage)
            const currentStatus = stageStatus(storyboard, stage)
            const previousStatus = previous ? stageStatus(previous, stage) : undefined

            if (currentStatus === 'completed') {
                if (params.watchedKeys.has(watchKey)) resolvedWatchKeys.add(watchKey)
                continue
            }
            if (currentStatus !== 'failed') continue

            const error = stageError(storyboard, stage) ?? { errorMsg: `${stageLabel(stage)}生成失败` }
            const currentFailureKey = failureKey(storyboard, stage, error)
            const previousError = previous ? stageError(previous, stage) : undefined
            const isNewPersistedFailure = !previousError || failureKey(storyboard, stage, previousError) !== currentFailureKey
            const becameFailed = previousStatus === 'generating'
            const watchedNewFailure = params.watchedKeys.has(watchKey) && isNewPersistedFailure

            if ((becameFailed || watchedNewFailure) && !params.shownFailureKeys.has(currentFailureKey)) {
                notices.push({
                    failureKey: currentFailureKey,
                    watchKey,
                    message: `分镜 ${storyboard.order} ${stageLabel(stage)}生成失败：${error.errorMsg}`
                })
            }
            if (params.watchedKeys.has(watchKey)) resolvedWatchKeys.add(watchKey)
        }
    }

    return { notices, resolvedWatchKeys }
}
