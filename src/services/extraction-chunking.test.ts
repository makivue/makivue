import { describe, expect, it } from 'vitest'
import { chunkEpisodeScripts } from './llm'

describe('extraction chunking', () => {
    it('splits an oversized single episode and retains episode/fragment provenance', () => {
        const script = Array.from({ length: 8 }, (_, index) => `【场景：地点${index + 1}】\n${'剧情'.repeat(350)}`).join('\n')
        const chunks = chunkEpisodeScripts([{ episodeNumber: 7, script }], 1200)
        expect(chunks.length).toBeGreaterThan(1)
        expect(chunks.every(chunk => chunk.length <= 1200)).toBe(true)
        expect(chunks.every(chunk => chunk.includes('第7集'))).toBe(true)
        expect(chunks.some(chunk => chunk.includes('片段 1/'))).toBe(true)
    })
})
