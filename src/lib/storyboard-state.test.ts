import { describe, expect, it } from 'vitest'
import { extractStoryboardBoundaryStates } from './storyboard-state'

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
})
