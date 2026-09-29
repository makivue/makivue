import { describe, expect, it } from 'vitest'
import { contentLanguagePrompt, defaultEpisodeTitle, normalizeContentLanguage } from './content-language'

describe('project content language', () => {
    it('accepts every supported project language and rejects unknown values', () => {
        expect(normalizeContentLanguage('fr')).toBe('fr')
        expect(normalizeContentLanguage('not-a-locale')).toBe('zh')
    })

    it('keeps technical JSON fields stable while locking creative output language', () => {
        const prompt = contentLanguagePrompt('ja')
        expect(prompt).toContain('Japanese')
        expect(prompt).toContain('JSON keys')
    })

    it('creates initial episode labels in the selected content language', () => {
        expect(defaultEpisodeTitle(3, 'fr')).toBe('Épisode 3')
        expect(defaultEpisodeTitle(3, 'zh')).toBe('第3集')
    })
})
