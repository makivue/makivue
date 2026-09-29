import { describe, expect, it } from 'vitest'
import { extractionActiveKey } from './extract-fingerprint'

describe('extractionActiveKey', () => {
    const episodes = [
        { episodeNumber: 1, script: '第一集剧本' },
        { episodeNumber: 2, script: '第二集剧本' }
    ]
    const profile = { style: 'cinematic', palette: ['amber', 'black'] }

    it('is stable for the same scripts and visual style', () => {
        expect(extractionActiveKey('100', episodes, profile).activeKey).toBe(extractionActiveKey('100', episodes, profile).activeKey)
    })

    it('changes when either the script or visual style changes', () => {
        const original = extractionActiveKey('100', episodes, profile).activeKey
        expect(extractionActiveKey('100', [{ ...episodes[0], script: '剧本已修改' }, episodes[1]], profile).activeKey).not.toBe(original)
        expect(extractionActiveKey('100', episodes, { ...profile, style: 'anime' }).activeKey).not.toBe(original)
    })

    it('uses the same normalized non-empty script list for starting and committing', () => {
        const result = extractionActiveKey('100', [...episodes, { episodeNumber: 3, script: '   ' }, { episodeNumber: 4, script: null }], profile)
        expect(result.withScripts).toEqual(episodes)
    })
})
