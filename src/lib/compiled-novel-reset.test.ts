import { describe, expect, it } from 'vitest'
import { compiledNovelResetPatch } from './compiled-novel-reset'

describe('resetting the compiled chapter copy', () => {
    const project = {
        novel: '第一章正文\n\n第二章正文',
        episodes: [
            { episodeNumber: 2, chapterContent: '第二章正文', finalizedAt: '2026-09-01' },
            { episodeNumber: 1, chapterContent: '第一章正文', finalizedAt: '2026-09-01' }
        ]
    }

    it('clears the old compilation so outline generation cannot reuse it as source material', () => {
        expect(compiledNovelResetPatch(project)).toEqual({ novel: null })
    })

    it('preserves imported source material even when it matches the chapters', () => {
        expect(compiledNovelResetPatch({ ...project, novelSetup: JSON.stringify({ fieldSources: { episodeStatePlan: 'derived_from_import' } }) })).toEqual({})
    })

    it('preserves independent source text and unfinalized imported chapters', () => {
        expect(compiledNovelResetPatch({ ...project, novel: '独立的原始小说' })).toEqual({})
        expect(compiledNovelResetPatch({ ...project, episodes: project.episodes.map(episode => ({ ...episode, finalizedAt: null })) })).toEqual({})
    })
})
