import { describe, expect, it } from 'vitest'
import { buildEpisodeFactSnapshot } from '@/lib/content-contracts'
import { mergeObservedFacts, narrativeContentHash, readObservedFacts, setupWithObservedFacts, type ObservedEpisodeFacts } from './narrative-facts'

const content = '阿青把信封交给小雨。'
const facts: ObservedEpisodeFacts = {
    ...buildEpisodeFactSnapshot({ episodeNumber: 1 }),
    kind: 'observed',
    sourceStage: 'chapter',
    sourceHash: narrativeContentHash(content),
    summary: content,
    endingState: '小雨持有信封',
    events: [{ description: '信封交接完成', evidence: content }]
}

describe('observed narrative facts', () => {
    it('does not promote future plans or stale text into established facts', () => {
        const setup = { factLedger: [buildEpisodeFactSnapshot({ episodeNumber: 3, synopsis: '第三集才揭晓真相' })] }
        const episodes = [
            { episodeNumber: 1, chapterContent: content, contentFacts: { chapter: facts } },
            { episodeNumber: 2, chapterContent: '阿青烧掉信封。', contentFacts: { chapter: { ...facts, episodeNumber: 2 } } },
            { episodeNumber: 3, chapterContent: content, contentFacts: { chapter: { ...facts, episodeNumber: 3 } } }
        ]
        expect(setupWithObservedFacts(setup, episodes, 3).factLedger).toEqual([facts])
    })

    it('preserves the detailed outline and invalidates script facts when the chapter changes', () => {
        const original = { summary: '详细大纲'.repeat(100), script: { old: true } }
        const stored = mergeObservedFacts(original, 'chapter', facts)
        expect(stored.summary).toBe(original.summary)
        expect(stored.script).toBeNull()
        expect(stored.scriptInvalidated).toBe(true)
        expect(readObservedFacts({ episodeNumber: 1, chapterContent: content, contentFacts: stored }, 'chapter')).toEqual(facts)
    })
})
