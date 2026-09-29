import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRegionalPreviewPrompt, formatRegionalStoryContext, getRegionalStoryPreset, REGIONAL_STORY_GROUPS, REGIONAL_STORY_PRESETS, selectRegionalStoryStyle } from './regional-story-presets'
import { getVisualStyle, getVisualStyleForSetup, parseNovelSetup, stringifyNovelSetup } from './novel'
import { buildVisualStylePreviewPrompt } from './visual-style-profile'
import { buildVisualStyleLock, getVisualStyleFamily, sanitizePromptForVisualStyle } from './visual-style-lock'
import { getStylePreviewSrc, STYLE_PREVIEW_ASSET_VERSION } from './style-preview'

afterEach(() => vi.unstubAllEnvs())

describe('regional story presets', () => {
    it('matches all subcategories in the reference, deduplicating the repeated SEA family category', () => {
        const categories = REGIONAL_STORY_GROUPS.map(region => REGIONAL_STORY_PRESETS.filter(p => p.region === region.key).map(p => p.label))
        expect(categories).toEqual([
            ['都市复仇', '硬核悬疑', '暗黑奇幻', '惊悚反转', '职场逆袭'],
            ['豪门恩怨', '甜宠逆袭', '家庭伦理', '重生复仇'],
            ['大女主逆袭', '豪门家族纷争', '都市情感', '传奇励志', '女性成长'],
            ['犯罪悬疑', '暗黑奇幻', '都市反转', '历史传奇', '人性剧情']
        ])
        expect(new Set(REGIONAL_STORY_PRESETS.map(p => p.key)).size).toBe(19)
        expect(new Set(REGIONAL_STORY_PRESETS.map(p => p.previewScene)).size).toBe(19)
    })

    it.each(REGIONAL_STORY_PRESETS)('persists $key and applies its own visual direction without its cover scene', preset => {
        const registered = getVisualStyle(preset.key)
        expect(registered.key).toBe(preset.key)
        const setup = parseNovelSetup(stringifyNovelSetup({ visualStyle: preset.key, contentLanguage: 'fr' }))
        const style = getVisualStyleForSetup(setup)
        expect(setup.visualStyle).toBe(preset.key)
        expect(setup.contentLanguage).toBe('fr')
        expect(setup.visualStyleProfile?.presetKey).toBe(preset.key)
        expect(style.imagePromptPrefix).toContain(preset.visual)
        expect(style.videoPromptPrefix).toContain(preset.visual)
        expect(style.imagePromptPrefix).not.toContain(preset.previewScene)
        expect(buildRegionalPreviewPrompt(preset)).toContain(preset.previewScene)
        expect(buildVisualStylePreviewPrompt(style)).toContain(preset.previewScene)
        const context = formatRegionalStoryContext(preset.key)
        expect(context).toContain(preset.story)
        expect(context).toContain('take precedence over defaults')
        expect(context).toContain('Preserve the selected content language')
        expect(context).not.toContain(preset.previewScene)
    })

    it('keeps historical and supernatural stories out of the forced present-day style lock', () => {
        for (const key of ['me-historical-legend', 'me-dark-fantasy', 'na-dark-fantasy', 'sea-rebirth-revenge']) {
            const style = getVisualStyle(key)
            expect(getVisualStyleFamily(style)).toBe('historical-fantasy')
            expect(buildVisualStyleLock(style).positive).not.toContain('MUST be contemporary')
            expect(buildVisualStyleLock(style).negative).not.toContain('ancient robes')
            expect(sanitizePromptForVisualStyle('historical robes in an ancient courtyard', style)).toContain('historical robes')
        }
        const customPeriod = getVisualStyle('eu-family-dynasty')
        expect(sanitizePromptForVisualStyle('historical robes', customPeriod)).toBe('historical robes')
        expect(buildVisualStyleLock(customPeriod).positive).toContain('explicit user settings take precedence')
    })

    it('suggests broad genres without resetting independent choices or the language', () => {
        const form = { visualStyle: 'cinematic', genre: '剧情', contentLanguage: 'ar', title: 'Test' }
        const fantasy = selectRegionalStoryStyle(form, 'na-dark-fantasy')
        expect(fantasy).toMatchObject({ visualStyle: 'na-dark-fantasy', genre: '奇幻', contentLanguage: 'ar', title: 'Test' })
        expect(selectRegionalStoryStyle(fantasy, 'me-historical-legend').genre).toBe('历史 / 年代')
        expect(selectRegionalStoryStyle({ ...form, genre: '喜剧' }, 'sea-sweet-romance').genre).toBe('喜剧')
        expect(selectRegionalStoryStyle(form, 'watercolor').genre).toBe('剧情')
    })

    it('serves every preset from bundled local artwork regardless of cloud settings', () => {
        vi.stubEnv('NEXT_PUBLIC_STYLE_PREVIEW_BASE_URL', 'https://cdn.example.com')
        expect(getStylePreviewSrc('na-urban-revenge')).toBe('/style-previews/na-urban-revenge.svg')
        expect(getStylePreviewSrc('cinematic', 256)).toBe('/style-previews/cinematic.svg')
        expect(STYLE_PREVIEW_ASSET_VERSION).toBe('local-v1')
    })

    it('does not add regional narrative constraints to existing styles', () => {
        expect(formatRegionalStoryContext('cinematic')).toBe('')
        expect(formatRegionalStoryContext(undefined)).toBe('')
        expect(getRegionalStoryPreset('unknown')).toBeUndefined()
    })
})
