export const STORY_DIRECTIONS_STALE_MS = 4 * 60 * 1000
export const STORY_DIRECTIONS_INTERRUPTED_ERROR = '故事方向任务已中断，请重新生成'

export function isStoryDirectionsJobStale(updatedAt: number, now = Date.now()): boolean {
    return now - updatedAt >= STORY_DIRECTIONS_STALE_MS
}
