import { describe, expect, it } from 'vitest'
import {
    buildPublicationCoverPrompts,
    normalizeGeneratedPublicationMetadata,
    publicationGenerationContext,
    toPublicationGenerationSource,
    type PublicationGenerationSource
} from './publication-generation'

const source: PublicationGenerationSource = {
    title: '星际大战',
    description: '失散舰长率领幸存者寻找故乡。',
    genre: '科幻',
    visualStyle: 'cinematic',
    contentLanguage: 'zh',
    totalEpisodes: 12,
    characters: [{ name: '林澈', role: '舰长', personality: '冷静果断' }],
    scenes: [{ name: '舰桥', description: '受损星舰的中央舰桥' }],
    episodes: [{ episodeNumber: 1, title: '失联', synopsis: '星舰失去与母星的联系，舰长发现航线遭到篡改。' }]
}

describe('publication AI generation', () => {
    it('removes Prisma BigInt identifiers before source data enters JSON-based AI and billing flows', () => {
        const databaseSource = {
            ...source,
            id: 638260232912411993n,
            characters: source.characters.map(character => ({ ...character, id: 1n, referenceImageUrl: 'https://example.com/character.png' })),
            scenes: source.scenes.map(scene => ({ ...scene, id: 2n, referenceImageUrl: 'https://example.com/scene.png' })),
            episodes: source.episodes.map(episode => ({ ...episode, id: 3n, videoUrl: 'https://example.com/episode.mp4', storyboards: [{ id: 4n }] }))
        }

        const sanitized = toPublicationGenerationSource(databaseSource)

        expect(() => JSON.stringify(sanitized)).not.toThrow()
        expect(sanitized).toEqual(source)
    })

    it('normalizes generated metadata and enriches sparse keyword output with project facts', () => {
        expect(normalizeGeneratedPublicationMetadata({ seoTitle: ' 星海归途 ', seoDescription: '舰长带领幸存者穿越危机。', seoKeywords: ['太空', '太空'] }, source)).toEqual({
            seoTitle: '星海归途',
            seoDescription: '舰长带领幸存者穿越危机。',
            seoKeywords: ['太空', '科幻', '星际大战', '林澈'],
            coverAlt: '《星海归途》作品封面,呈现科幻的核心人物、场景与故事氛围。'
        })
    })

    it('caps story context and creates three materially different cover directions', () => {
        const context = publicationGenerationContext({ ...source, description: 'x'.repeat(4_000) })
        expect(context.description).toHaveLength(2_000)
        const prompts = buildPublicationCoverPrompts(source, normalizeGeneratedPublicationMetadata({}, source))
        expect(prompts).toHaveLength(3)
        expect(new Set(prompts)).toHaveLength(3)
        expect(prompts.every(prompt => prompt.includes('no typography'))).toBe(true)
    })
})
