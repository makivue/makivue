import { describe, expect, it } from 'vitest'
import { canonicalProjectGenreLabel, PROJECT_GENRES } from './project-genres'

describe('project genres', () => {
    it('provides the common international genres with stable codes', () => {
        expect(PROJECT_GENRES).toHaveLength(19)
        expect(PROJECT_GENRES.map(genre => genre.code)).toEqual([
            'drama',
            'romance',
            'comedy',
            'thriller',
            'mystery',
            'crime',
            'action',
            'adventure',
            'horror',
            'sci_fi',
            'fantasy',
            'historical',
            'family',
            'coming_of_age',
            'urban',
            'xuanhuan',
            'wealthy_family',
            'political_intrigue',
            'xianxia'
        ])
    })

    it('maps legacy and English values to the global genre labels', () => {
        expect(canonicalProjectGenreLabel('都市')).toBe('都市')
        expect(canonicalProjectGenreLabel('言情')).toBe('爱情')
        expect(canonicalProjectGenreLabel('仙侠')).toBe('仙侠')
        expect(canonicalProjectGenreLabel('Coming-of-age')).toBe('青春成长')
    })
})
