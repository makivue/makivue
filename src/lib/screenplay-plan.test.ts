import { describe, expect, it } from 'vitest'
import { validateEpisodeScenePlan } from './screenplay-plan'

describe('episode scene plan', () => {
    it('requires every scene to contain goal, conflict, turn, hook and a realistic duration', () => {
        const issues = validateEpisodeScenePlan(
            [
                {
                    sceneNumber: 1,
                    slugline: '办公室/日/内',
                    purpose: '交代危机',
                    protagonistGoal: '',
                    conflict: '门外有人逼近',
                    turn: '证据失踪',
                    exitHook: '门被推开',
                    estimatedSeconds: 20,
                    requiredEvents: ['   ']
                }
            ],
            { min: 60, max: 120 },
            ['主角拿到账本']
        )
        expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['weak_scene_plan', 'missing_scene_events', 'scene_plan_duration', 'uncovered_required_events']))
    })
})
