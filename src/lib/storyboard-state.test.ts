import { describe, expect, it } from 'vitest'
import { buildStoryboardContinuityState, extractStoryboardBoundaryStates } from './storyboard-state'

describe('storyboard continuity state', () => {
    it('extracts visible opening and ending states', () => {
        expect(extractStoryboardBoundaryStates('Opening state: 甲站在门边; Ending state: 甲推门进入')).toEqual({
            openingState: '甲站在门边',
            endingState: '甲推门进入'
        })
    })

    it('does not fold middle performance states into the opening boundary', () => {
        expect(extractStoryboardBoundaryStates('Opening state: 甲站在门边; Middle state 1: 甲听到脚步后抬手; Ending state: 甲推门进入')).toEqual({
            openingState: '甲站在门边',
            endingState: '甲推门进入'
        })
    })

    it('serializes bigint ids and records state-only inheritance', () => {
        const state = buildStoryboardContinuityState({
            continuityMode: 'stateful',
            continuityGroup: 3,
            actionDesc: 'Opening state: 乙坐在桌边；Ending state: 乙抬头',
            shotType: 'close-up',
            scene: { id: 7n, name: '会议室', locationPrompt: '深色木桌，左侧窗光' },
            characters: [{ id: 12n, name: '乙', appearancePrompt: '黑色西装，银色徽章' }],
            inheritedFrom: {
                storyboardId: '99',
                order: 1,
                frameUrl: 'https://example.com/end.png',
                mode: 'stateful',
                anchorKind: 'state'
            }
        })

        expect(state).toMatchObject({
            version: 3,
            sourceVersion: 1,
            mode: 'stateful',
            group: 3,
            scene: { id: '7', name: '会议室' },
            characters: [{ id: '12', name: '乙' }],
            inheritedFrom: { storyboardId: '99', anchorKind: 'state' }
        })
        expect(() => JSON.stringify(state)).not.toThrow()
    })
})
