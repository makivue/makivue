import { describe, expect, it } from 'vitest'
import { getVisualStyle, getVisualStyleForSetup, getVisualStyleProfile, parseNovelSetup, VISUAL_STYLE_PRESETS } from './novel'
import { buildVisualStylePreviewPrompt, createVisualStyleProfile, formatVisualStyleProfile, VISUAL_STYLE_PROFILE_VERSION } from './visual-style-profile'

describe('project visual style profiles', () => {
    it('expands a style key into production-ready visual language dimensions', () => {
        const profile = getVisualStyleProfile('cinematic')

        expect(profile.version).toBe(VISUAL_STYLE_PROFILE_VERSION)
        expect(profile.presetKey).toBe('cinematic')
        expect(profile.rendering.summary).toBe('真人电影摄影')
        expect(profile.composition.prompt).toContain('focal hierarchy')
        expect(profile.linework.prompt).toContain('photographic edges')
        expect(profile.lighting.prompt).toContain('motivated')
        expect(profile.colorPalette.prompt).toContain('palette')
        expect(profile.texture.prompt).toContain('skin pores')
        expect(profile.cameraLanguage.prompt).toContain('depth of field')
        expect(profile.motionLanguage.prompt).toContain('screen direction')
    })

    it('uses medium-specific rules instead of treating every preset as a one-word label', () => {
        const anime = getVisualStyleProfile('anime')
        const watercolor = getVisualStyleProfile('watercolor')
        const documentary = getVisualStyleProfile('savanna-wildlife-doc')

        expect(anime.rendering.summary).toBe('二维动画与插画')
        expect(anime.linework.prompt).toContain('line art')
        expect(watercolor.texture.prompt).toContain('paper tooth')
        expect(documentary.composition.prompt).toContain('foreground, midground and background')
        expect(documentary.motionLanguage.prompt).toContain('patient pans')
    })

    it('hydrates legacy projects and applies the stored profile to downstream prompts', () => {
        const setup = parseNovelSetup(JSON.stringify({ visualStyle: 'anime' }))
        const style = getVisualStyleForSetup(setup)

        expect(setup.visualStyleProfile?.presetKey).toBe('anime')
        expect(style.imagePromptPrefix).toContain(setup.visualStyleProfile!.composition.prompt)
        expect(style.videoPromptPrefix).toContain(setup.visualStyleProfile!.motionLanguage.prompt)
    })

    it('preserves a valid project snapshot instead of silently replacing it with a later preset', () => {
        const preset = getVisualStyle('cinematic')
        const stored = createVisualStyleProfile(preset)
        stored.composition = { summary: '项目专属中心构图', prompt: 'project-specific centered composition with strict bilateral balance' }
        stored.imagePromptPrefix = `${stored.imagePromptPrefix}, ${stored.composition.prompt}`

        const resolved = getVisualStyleForSetup({ visualStyle: 'cinematic', visualStyleProfile: stored })

        expect(resolved.imagePromptPrefix).toContain('project-specific centered composition')
    })

    it('can produce a complete structured context for every registered preset', () => {
        for (const style of VISUAL_STYLE_PRESETS) {
            const context = formatVisualStyleProfile(createVisualStyleProfile(style))
            expect(context).toContain('构图逻辑：')
            expect(context).toContain('线条/轮廓：')
            expect(context).toContain('光影：')
            expect(context).toContain('色彩：')
            expect(context).toContain('材质：')
            expect(context).toContain('镜头语言：')
        }
    })

    it('generates style previews from the same complete profile used downstream', () => {
        const style = getVisualStyle('watercolor')
        const profile = createVisualStyleProfile(style)
        const prompt = buildVisualStylePreviewPrompt(style, profile)

        expect(prompt).toContain(profile.composition.prompt)
        expect(prompt).toContain(profile.linework.prompt)
        expect(prompt).toContain(profile.lighting.prompt)
        expect(prompt).toContain(profile.colorPalette.prompt)
        expect(prompt).toContain(profile.texture.prompt)
    })
})
