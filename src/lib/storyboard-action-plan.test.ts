import { describe, expect, it } from 'vitest'
import { hasStructuredPerformanceDetails, normalizeStoryboardActionPlan, parseLegacyStoryboardActionPlan, serializeStoryboardActionPlan } from './storyboard-action-plan'

describe('storyboard action plan', () => {
    it('converts legacy labeled action text into stable structured states', () => {
        const plan = parseLegacyStoryboardActionPlan('Opening state: 阿青站在门边; Middle state 1: 阿青抬手; Ending state: 门已经打开')
        expect(plan).toEqual({ version: 1, opening: '阿青站在门边', middles: [{ index: 1, state: '阿青抬手' }], ending: '门已经打开' })
        expect(serializeStoryboardActionPlan(plan!)).toContain('Middle state 1: 阿青抬手')
    })

    it('normalizes explicit performance fields and detects executable detail', () => {
        const plan = normalizeStoryboardActionPlan({
            opening: { state: '阿青低头' },
            middles: [
                {
                    state: '阿青抬眼',
                    trigger: '门铃响起',
                    gazeTarget: '门口',
                    facialPerformance: '屏住呼吸，嘴唇微张',
                    bodyPerformance: '肩背挺直，重心前移'
                }
            ],
            ending: { state: '阿青看向门口' }
        })
        expect(plan?.middles[0].index).toBe(1)
        expect(hasStructuredPerformanceDetails(plan!, 1)).toBe(true)
        expect(serializeStoryboardActionPlan(plan!)).toContain('视线目标：门口')
    })
})
