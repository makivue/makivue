import { describe, expect, it } from 'vitest'
import { parseNovelSetup, stringifyNovelSetup } from './novel'
import { serializeStyleLibraryEntry, styleLibrarySetup } from './style-library'

describe('local custom style contract', () => {
    const entry = {
        id: '7', kind: 'theme' as const, name: '港口故事', description: '雨夜霓虹', baseStyle: 'pixel-art',
        region: '滨海小城', genre: null, referenceImages: ['/api/local-media/style-library/1/reference.webp']
    }

    it('retains authored art direction and local anchors after storing the setup', () => {
        const setup = parseNovelSetup(stringifyNovelSetup({ ...parseNovelSetup(null), ...styleLibrarySetup(entry) }))
        expect(setup.visualStyle).toBe('pixel-art')
        expect(setup.styleReferenceImages).toEqual(entry.referenceImages)
        expect(setup.styleReferencePrompt).toContain('雨夜霓虹')
        expect(setup.worldBible).toContain('滨海小城')
        expect(setup.visualStyleProfile?.artDirection.summary).toBe('港口故事')
        expect(setup.visualStyleProfile?.imagePromptPrefix).toContain('User art direction:')
    })

    it('normalizes stored IDs and bounds image anchors', () => {
        const normalized = serializeStyleLibraryEntry({ ...entry, id: 7n, kind: 'unknown', referenceImages: [null, 'a', 'b', 3, 'c', 'd'] })
        expect(normalized).toMatchObject({ id: '7', kind: 'style', referenceImages: ['a', 'b', 'c'] })
    })
})
