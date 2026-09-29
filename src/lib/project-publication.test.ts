import { describe, expect, it } from 'vitest'
import { normalizeStringList, normalizeSubtitleLanguages, projectPublicationIssues, publicationFieldsFromSetup } from './project-publication'

describe('project publication metadata', () => {
    it('normalizes comma-separated keywords without duplicates', () => {
        expect(normalizeStringList('都市, 复仇，都市\n逆袭')).toEqual(['都市', '复仇', '逆袭'])
    })

    it('keeps only supported subtitle languages', () => {
        expect(normalizeSubtitleLanguages(['en', 'zh', 'unknown', 'en'])).toEqual(['en', 'zh'])
    })

    it('derives structured publication fields from the creative setup', () => {
        expect(publicationFieldsFromSetup({ videoAspectRatio: '16:9', visualStyle: 'anime', contentLanguage: 'ja', episodeFormat: 'short' })).toEqual({
            videoAspectRatio: '16:9',
            visualStyle: 'anime',
            contentLanguage: 'ja',
            episodeFormat: 'short'
        })
    })

    it('reports every missing field required for public publication', () => {
        const issues = projectPublicationIssues(
            {
                genreLabel: null,
                seoTitle: null,
                seoDescription: null,
                seoKeywords: null,
                coverUrl: null,
                trailerUrl: null,
                videoAspectRatio: null,
                visualStyle: null,
                contentLanguage: null,
                subtitleLanguages: null,
                episodeFormat: null,
                totalEpisodes: 0
            },
            { displayName: null, avatarUrl: null }
        )
        expect(issues).toHaveLength(14)
    })
})
