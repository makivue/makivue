import { describe, expect, it } from 'vitest'
import { createSceneReferenceSelection, getSelectedSceneReferenceUrls, MAX_SELECTED_SCENE_REFERENCES } from './scene-reference-selection'

describe('scene reference selection', () => {
    it('uses the legacy primary reference when no multi-selection exists', () => {
        expect(getSelectedSceneReferenceUrls(null, 'master.png')).toEqual(['master.png'])
    })

    it('reads explicit selected URLs without reintroducing a removed legacy URL', () => {
        expect(getSelectedSceneReferenceUrls({ version: 1, selectedUrls: ['reverse.png'] }, 'master.png')).toEqual(['reverse.png'])
        expect(getSelectedSceneReferenceUrls({ version: 1, selectedUrls: [] }, 'master.png')).toEqual([])
    })

    it('deduplicates and caps selected references at four', () => {
        const urls = ['a.png', 'b.png', 'a.png', 'c.png', 'd.png', 'e.png']
        expect(createSceneReferenceSelection(urls)).toEqual({
            version: 1,
            selectedUrls: ['a.png', 'b.png', 'c.png', 'd.png']
        })
        expect(MAX_SELECTED_SCENE_REFERENCES).toBe(4)
    })

    it('supports an asset-array shape for forward compatibility', () => {
        expect(
            getSelectedSceneReferenceUrls([
                { url: 'a.png', status: 'selected' },
                { url: 'b.png', status: 'candidate' },
                { url: 'c.png', selected: true }
            ])
        ).toEqual(['a.png', 'c.png'])
    })
})
