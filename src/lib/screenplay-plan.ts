import type { ContractIssue } from './content-contracts'

export type EpisodeScenePlan = {
    sceneNumber: number
    slugline: string
    purpose: string
    protagonistGoal: string
    conflict: string
    turn: string
    exitHook: string
    estimatedSeconds: number
    requiredEvents: string[]
}

function normalizedEvent(value: string) {
    return value
        .normalize('NFKC')
        .replace(/[\s\p{P}]/gu, '')
        .toLowerCase()
}

export function validateEpisodeScenePlan(plan: EpisodeScenePlan[] | null | undefined, requiredEvents: string[] = []): ContractIssue[] {
    const issues: ContractIssue[] = []
    if (!Array.isArray(plan) || plan.length === 0) return [{ path: 'scenePlan', code: 'empty_scene_plan', message: '缺少剧本场景规划' }]
    for (const [index, scene] of plan.entries()) {
        const path = `scenePlan[${index}]`
        if (scene.sceneNumber !== index + 1) issues.push({ path: `${path}.sceneNumber`, code: 'scene_order', message: '场景编号必须连续' })
        for (const key of ['slugline', 'purpose', 'protagonistGoal', 'conflict', 'turn', 'exitHook'] as const) {
            if (typeof scene[key] !== 'string' || scene[key].trim().length < 4) issues.push({ path: `${path}.${key}`, code: 'weak_scene_plan', message: `场景 ${index + 1} 的 ${key} 不具体` })
        }
        if (!Number.isFinite(scene.estimatedSeconds) || scene.estimatedSeconds < 5)
            issues.push({ path: `${path}.estimatedSeconds`, code: 'invalid_scene_duration', message: `场景 ${index + 1} 缺少合理时长` })
        if (!Array.isArray(scene.requiredEvents) || scene.requiredEvents.length === 0 || scene.requiredEvents.some(event => typeof event !== 'string' || !event.trim()))
            issues.push({ path: `${path}.requiredEvents`, code: 'missing_scene_events', message: `场景 ${index + 1} 没有关联必保事件` })
    }
    const coveredEvents = new Set(
        plan
            .flatMap(scene => scene.requiredEvents ?? [])
            .filter(event => typeof event === 'string')
            .map(normalizedEvent)
    )
    const missingEvents = requiredEvents.filter(event => typeof event === 'string' && event.trim() && !coveredEvents.has(normalizedEvent(event)))
    if (missingEvents.length > 0) {
        issues.push({ path: 'scenePlan.requiredEvents', code: 'uncovered_required_events', message: `场景计划遗漏必保事件：${missingEvents.join('；')}` })
    }
    return issues
}
