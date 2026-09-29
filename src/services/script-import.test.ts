import { describe, expect, it } from 'vitest'
import { mergeDetectedScriptChunks, parseImportTextFast, splitImportText } from './script-import'

function fixture(encoded: string) {
    return Buffer.from(encoded, 'base64').toString('utf8')
}

describe('script import chunking', () => {
    it('covers the entire long input without silently dropping the middle', () => {
        const source = `${'前'.repeat(47_000)}\n\n${'中'.repeat(47_000)}\n\n${'后'.repeat(47_000)}`
        const chunks = splitImportText(source)
        expect(chunks.length).toBeGreaterThan(1)
        expect(chunks.join('')).toBe(source.replace(/\n/g, ''))
        expect(chunks.some(chunk => chunk.includes('中'.repeat(100)))).toBe(true)
    })

    it('merges split episodes and retains an unsegmented novel verbatim', () => {
        const novel = '完整长篇正文'.repeat(20_000)
        const merged = mergeDetectedScriptChunks(
            [
                { stage: 'novel', totalEpisodes: 1, episodes: [], novel: '模型摘要一' },
                { stage: 'novel', totalEpisodes: 1, episodes: [], novel: '模型摘要二' }
            ],
            novel
        )
        expect(merged.novel).toBe(novel)
    })

    it('uses the canonical 1-10 intensity range', () => {
        const merged = mergeDetectedScriptChunks(
            [{ stage: 'outline', outline: [{ episodeNumber: 1, synopsis: '剧情', intensity: 9 }] }],
            '测试文本'
        )
        expect(merged.outline?.[0].intensity).toBe(9)
    })
})

describe('fast script import parsing', () => {
    it('parses explicit episodes and shot blocks without a model call', () => {
        const source = fixture(
            '56ysMembhiDngrzlppblo7YKCjEtMSDml6Ug5YaFIOWuouagiO+8iOWRqOS6ke+8jOWwj+S6jO+8iQoK4peP55S76Z2iMe+8iOWFqOaZr++8jOW5s+inhu+8iQrpnZLpmLPljr/kuIvvvIzmspnmvKDovrnpmbLlsI/plYfnmoTlrqLmoIjjgIIK5a2X5bmV77ya6Z2S6Ziz5Y6/77yM6ZuB6Zeo6ZWH44CCCgril4/nlLvpnaIy77yI6L+R5pmv77yMNeenku+8iQrlkajkupHvvJrnu5nmiJHmnaXnopfmsLTjgIIKCuesrDLpm4Yg6L+96LiqCgoyLTEg5aScIOWkliDln47pl6gKCuKXj+eUu+mdojHvvIjov5zmma/vvIkK5ZGo5LqR6LWw5Ye65Z+O6Zeo44CC'
        )

        const parsed = parseImportTextFast(source, 'sample-script.docx')

        expect(parsed.stage).toBe('storyboard')
        expect(parsed.projectTitle).toBe('sample-script')
        expect(parsed.totalEpisodes).toBe(2)
        expect(parsed.episodes).toHaveLength(2)
        expect(parsed.episodes?.[0].storyboards).toHaveLength(2)
        expect(parsed.episodes?.[0].storyboards?.[0]).toMatchObject({ order: 1, shotType: '全景', narration: expect.any(String) })
        expect(parsed.episodes?.[0].storyboards?.[1]).toMatchObject({ order: 2, shotType: '近景', duration: 5, dialogue: expect.any(String) })
    })

    it('imports short episode sections as outlines', () => {
        const source = fixture(
            '56ysMembhiDliJ3pgYcK55S35aWz5Li75Zyo6Zuo5aSc55u46YGH44CCCgrnrKwy6ZuGIOWGsueqgQrkuKTkurrlm6DkuLror6/kvJrlj5HnlJ/kuonmiafjgIIKCuesrDPpm4Yg5ZKM6KejCuecn+ebuOaPreaZk++8jOS4pOS6uumHjeW9kuS6juWlveOAgg=='
        )

        const parsed = parseImportTextFast(source)

        expect(parsed.stage).toBe('outline')
        expect(parsed.totalEpisodes).toBe(3)
        expect(parsed.outline).toHaveLength(3)
        expect(parsed.outline?.[1]).toMatchObject({ episodeNumber: 2, synopsis: expect.any(String) })
    })

    it('imports chaptered prose as episode chapter content', () => {
        const source = fixture(
            '56ys5LiA56ugIOWIneWIsOmdkumYswrov5nmmK/nrKzkuIDnq6DnmoTlsI/or7TmraPmlofvvIzkurrnianmnaXliLDpmYznlJ/lsI/plYfvvIzlvIDlp4vlr7vmib7lpLHokL3nmoTlrp3nianjgIIKCuesrOS6jOeroCDlrqLmoIjpo47ms6IK6L+Z5piv56ys5LqM56ug55qE5bCP6K+05q2j5paH77yM5Li76KeS5Zyo5a6i5qCI6YGt6YGH6L+95YW15bm26K6+5rOV6ISx6Lqr44CC'
        )

        const parsed = parseImportTextFast(source)

        expect(parsed.stage).toBe('novel')
        expect(parsed.episodes).toHaveLength(2)
        expect(parsed.episodes?.every(episode => Boolean(episode.chapterContent))).toBe(true)
    })
})
