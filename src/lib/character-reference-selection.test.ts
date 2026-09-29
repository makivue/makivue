import { describe, expect, it } from 'vitest'
import { characterReferenceFallbackRoles, characterReferenceRoleForShot } from './character-reference-selection'

describe('characterReferenceRoleForShot', () => {
    it.each(['close-up', 'detail shot', 'wide', 'full shot', 'medium', null, undefined])('uses the multi-view sheet for %s', shotType => {
        expect(characterReferenceRoleForShot(shotType)).toBe('turnaround_sheet')
    })

    it('keeps the turnaround sheet as the only identity source for explicit angles', () => {
        expect(characterReferenceRoleForShot({ shotType: 'medium', actionDesc: 'She looks out the window in profile' })).toBe('turnaround_sheet')
        expect(characterReferenceRoleForShot({ shotType: 'wide', imagePrompt: 'rear view, seen from behind' })).toBe('turnaround_sheet')
        expect(characterReferenceRoleForShot({ shotType: 'medium', imagePrompt: '45 degree three-quarter view' })).toBe('turnaround_sheet')
    })

    it.each(['turnaround_sheet', 'full_body', 'three_quarter_view', 'profile', 'back', 'face'] as const)('falls back only to the turnaround sheet for %s', role => {
        expect(characterReferenceFallbackRoles(role)).toEqual(['turnaround_sheet'])
    })
})
