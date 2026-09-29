import { describe, expect, it } from 'vitest'
import { normalizePublicationMediaUrls, publicationCoverCandidates, publicationTrailerCandidates } from './publication-media'

describe('publication media candidates', () => {
    it('deduplicates persisted and project-owned cover images while preserving useful labels', () => {
        const candidates = publicationCoverCandidates({
            coverUrl: 'https://cdn.test/current.png',
            publicationCoverCandidates: ['https://cdn.test/current.png', 'https://cdn.test/generated.png'],
            novelSetup: JSON.stringify({ styleReferenceImages: ['https://cdn.test/style.png'] }),
            scenes: [{ name: '舰桥', referenceImageUrl: 'https://cdn.test/scene.png' }],
            characters: [{ name: '舰长', referenceImageUrl: 'https://cdn.test/character.png' }],
            episodes: [{ episodeNumber: 1, title: '启航', storyboards: [{ order: 1, firstFrameUrl: 'https://cdn.test/frame.png', lastFrameUrl: null }] }]
        })

        expect(candidates.map(candidate => candidate.url)).toEqual([
            'https://cdn.test/current.png',
            'https://cdn.test/generated.png',
            'https://cdn.test/style.png',
            'https://cdn.test/frame.png',
            'https://cdn.test/scene.png',
            'https://cdn.test/character.png'
        ])
        expect(candidates[3].label).toContain('第 1 集')
    })

    it('offers every completed episode video as a trailer candidate', () => {
        const candidates = publicationTrailerCandidates({
            trailerUrl: 'https://cdn.test/custom.mp4',
            publicationTrailerCandidates: ['https://cdn.test/custom.mp4'],
            episodes: [{ id: 11n, episodeNumber: 1, title: '启航', videoUrl: 'https://cdn.test/episode.mp4' }]
        })
        expect(candidates).toEqual([
            { url: 'https://cdn.test/episode.mp4', label: '第 1 集 · 启航', source: 'episode', episodeId: '11', episodeNumber: 1 },
            { url: 'https://cdn.test/custom.mp4', label: '当前上传的预告片', source: 'current' }
        ])
    })

    it('rejects malformed and oversized media URLs', () => {
        expect(normalizePublicationMediaUrls(['javascript:alert(1)', 'https://cdn.test/a.png', 'https://cdn.test/a.png', 'x'.repeat(1025)])).toEqual(['https://cdn.test/a.png'])
    })
})
