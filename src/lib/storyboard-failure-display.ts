export const VIDEO_FAILURE_WITHOUT_DETAIL = '视频生成未完成，但旧任务没有记录具体原因。已完成的插图仍会保留，请重新生成当前视频。'
export const SWITCHED_VIDEO_FAILURE = '当前视频切换备用通道后未能完成保存。已完成的插图仍会保留，请重新生成当前视频。'

export function resolveVideoFailureDisplay(input: {
    videoUrl: string | null
    videoStatus: string | null
    batchVideoFailed: boolean
    batchError?: string
    persistedError?: string
    providerSwitched?: boolean
}) {
    const failed = !input.videoUrl && (input.batchVideoFailed || input.videoStatus === 'failed')
    if (!failed) return { failed: false as const, message: undefined }

    return {
        failed: true as const,
        message: input.providerSwitched ? SWITCHED_VIDEO_FAILURE : input.batchError?.trim() || input.persistedError?.trim() || VIDEO_FAILURE_WITHOUT_DETAIL
    }
}
