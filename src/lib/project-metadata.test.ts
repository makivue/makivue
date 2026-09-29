import { describe, expect, it } from 'vitest'
import { clampIntensity, normalizeCanonicalName, normalizeGenre } from './project-metadata'

describe('project metadata normalization', () => {
    it('maps free-form genres to a stable code while preserving the label', () => {
        expect(normalizeGenre('都市情感')).toEqual({ code: 'modern', label: '都市情感' })
        expect(normalizeGenre('犯罪惊悚')).toEqual({ code: 'crime', label: '犯罪惊悚' })
        expect(normalizeGenre('青春成长')).toEqual({ code: 'coming_of_age', label: '青春成长' })
        expect(normalizeGenre('太空歌剧')).toEqual({ code: 'other', label: '太空歌剧' })
    })

    it('normalizes entity names for project-level uniqueness', () => {
        expect(normalizeCanonicalName(' “阿 · 青” ')).toBe('阿青')
    })

    it('normalizes canonical 1-10 intensity values', () => {
        expect(clampIntensity(9)).toBe(9)
    })
})
