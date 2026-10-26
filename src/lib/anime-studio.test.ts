import { describe, expect, it } from 'vitest'
import { ANIME_STYLES, EMPTY_ANIME_DRAFT, buildAnimeImagePrompt, buildAnimeProject, parseAnimeDraft } from './anime-studio'
import { getVisualStyle } from './novel'

describe('anime creation handoff', () => {
    it.each(ANIME_STYLES)('uses a real frozen production style for %s', style => {
        const draft = { ...EMPTY_ANIME_DRAFT, style, story: '雨夜灯塔亮起', character: '黑发，蓝色外套，黄铜罗盘' }
        const prompt = buildAnimeImagePrompt(draft)
        expect(getVisualStyle(style).key).toBe(style)
        expect(prompt).toContain(getVisualStyle(style).imagePromptPrefix)
        expect(prompt).toContain(draft.character)
        expect(prompt).toContain(draft.story)
        expect(prompt).toContain('front, side and back')
    })
    it('keeps keyframes single-camera and distinct from multi-view reference sheets', () => {
        const prompt = buildAnimeImagePrompt({ ...EMPTY_ANIME_DRAFT, purpose: 'frame', story: '她举起罗盘前' })
        expect(prompt).toContain('A SINGLE storyboard opening keyframe')
        expect(prompt).not.toContain('front, side and back')
    })
    it('carries the complete story, design, language, aspect, episodes and reference IDs into the project', () => {
        const draft = { ...EMPTY_ANIME_DRAFT, title: '  星港来信 ', story: '  必须保留的原文对白。\n下一幕。 ', character: '黑发蓝衣', episodes: 3, ratio: '16:9' as const }
        expect(buildAnimeProject(draft, 'ja', ['123'])).toMatchObject({
            title: '星港来信',
            visualStyle: 'anime',
            totalEpisodes: 3,
            videoAspectRatio: '16:9',
            contentLanguage: 'ja',
            referenceAssetIds: ['123']
        })
        const project = buildAnimeProject(draft, 'ja', ['123'])
        expect(project.description).toContain(draft.story.trim())
        expect(project.description).toContain(draft.character)
        expect(buildAnimeProject({ ...draft, title: '', story: '开场' }, 'zh', []).title).toBe('开场')
    })
    it('keeps the largest supported project draft inside the existing 20,000 character limit', () => {
        const project = buildAnimeProject({ ...EMPTY_ANIME_DRAFT, story: '字'.repeat(18000), character: '人'.repeat(1000) }, 'zh', [])
        expect(project.description.length).toBeLessThanOrEqual(20000)
    })
    it.each(['null', '[]', '{', '{"style":"foreign","episodes":-1,"ratio":"100:1","purpose":"unknown"}'])('recovers invalid saved drafts: %s', raw => {
        expect(parseAnimeDraft(raw)).toEqual(EMPTY_ANIME_DRAFT)
    })
    it.each([1, 2, 7, 101, 500])('restores a freely entered episode count of %s', episodes => {
        expect(parseAnimeDraft(JSON.stringify({ ...EMPTY_ANIME_DRAFT, episodes })).episodes).toBe(episodes)
    })
    it.each([0, -1, 1.5, 501, null, '', '2'])('recovers an invalid saved episode count of %j', episodes => {
        expect(parseAnimeDraft(JSON.stringify({ ...EMPTY_ANIME_DRAFT, episodes })).episodes).toBe(1)
    })
    it('bounds saved input and ignores saved remote URLs and asset IDs', () => {
        const draft = parseAnimeDraft(
            JSON.stringify({ ...EMPTY_ANIME_DRAFT, title: '题'.repeat(256), story: '文'.repeat(19000), referenceAssetIds: ['123'], referenceUrl: 'https://other.example.com' })
        )
        expect(draft.title).toHaveLength(255)
        expect(draft.story).toHaveLength(18000)
        expect(draft).not.toHaveProperty('referenceAssetIds')
        expect(draft).not.toHaveProperty('referenceUrl')
    })
})
