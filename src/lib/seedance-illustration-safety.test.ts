import { describe, expect, it } from 'vitest'
import { getSeedanceIllustrationSafety } from './seedance-illustration-safety'

describe('Seedance illustration safety', () => {
    it('adds a virtual-character guard only for Seedance shots with visible people', () => {
        const safety = getSeedanceIllustrationSafety('seedance', true)

        expect(safety?.positive).toContain('original fictional virtual actor')
        expect(safety?.positive).toContain('Keep the selected project art style')
        expect(safety?.positive).toContain('never a real-person photo')
        expect(safety?.negative).toContain('real person likeness')
        expect(safety?.negative).toContain('passport photo')
    })

    it('does not alter environment-only shots or other video providers', () => {
        expect(getSeedanceIllustrationSafety('seedance', false)).toBeNull()
        expect(getSeedanceIllustrationSafety('wanx', true)).toBeNull()
        expect(getSeedanceIllustrationSafety('veo3', true)).toBeNull()
        expect(getSeedanceIllustrationSafety(undefined, true)).toBeNull()
    })
})
