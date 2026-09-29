import { describe, expect, it } from 'vitest'
import {
    DEFAULT_VIDEO_PROVIDER,
    IMAGE_PROVIDER_CAPABILITIES,
    SEEDANCE_20_ENDPOINT_ID,
    SEEDANCE_25_ENDPOINT_ID,
    SEEDANCE_20_REFERENCE_VIDEO_DURATION,
    SEEDANCE_25_REFERENCE_VIDEO_DURATION,
    WAN_3_MODEL,
    WAN_3_PRIME_MODEL,
    WAN_3_RESOLUTION,
    QWEN_IMAGE_MAX_REFERENCES,
    VIDEO_PROVIDER_CAPABILITIES,
    isAvailableProductionVideoProvider,
    isProductionVideoProvider,
    normalizeVideoDuration,
    planVideoDuration,
    resolveImagePromptChannels,
    supportsVideoReferenceMode
} from './provider-capabilities'

describe('provider capability matrix', () => {
    it('uses Wan 3.0 as the product-wide video default', () => {
        expect(DEFAULT_VIDEO_PROVIDER).toBe('wan3')
    })

    it('keeps Happy Horse visual-only and Veo text-only', () => {
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance).toMatchObject({ label: 'Seedance 2.0', duration: { min: 4, max: 15 } })
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance25).toMatchObject({ label: 'Seedance 2.5', duration: { min: 4, max: 30 } })
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance.duration.values).not.toContain(11)
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance25.duration.values).toContain(11)
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance25.duration.values).toContain(30)
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance.referenceVideoDuration).toBe(SEEDANCE_20_REFERENCE_VIDEO_DURATION)
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance25.referenceVideoDuration).toBe(SEEDANCE_25_REFERENCE_VIDEO_DURATION)
        expect(VIDEO_PROVIDER_CAPABILITIES['seedance-2.0-global'].referenceVideoDuration).toBe(SEEDANCE_20_REFERENCE_VIDEO_DURATION)
        expect(VIDEO_PROVIDER_CAPABILITIES['seedance-2.5-global'].referenceVideoDuration).toBe(SEEDANCE_25_REFERENCE_VIDEO_DURATION)
        expect(VIDEO_PROVIDER_CAPABILITIES.wan3.referenceVideoDuration).toEqual({ min: 1, max: 30 })
        expect(VIDEO_PROVIDER_CAPABILITIES.wan3prime.referenceVideoDuration).toEqual({ min: 1, max: 30 })
        expect(SEEDANCE_20_ENDPOINT_ID).toBe('ep-configure-1')
        expect(SEEDANCE_25_ENDPOINT_ID).toBe('ep-configure-2')
        expect(VIDEO_PROVIDER_CAPABILITIES.wanx).toMatchObject({ nativeDialogue: false, embeddedAudio: false })
        expect(VIDEO_PROVIDER_CAPABILITIES.wan3).toMatchObject({ label: 'Wan 3.0', nativeDialogue: true, embeddedAudio: true, duration: { min: 5, max: 30 } })
        expect(VIDEO_PROVIDER_CAPABILITIES.wan3prime).toMatchObject({ label: 'Wan 3.0 Prime', nativeDialogue: true, embeddedAudio: true, duration: { min: 5, max: 30 } })
        expect(VIDEO_PROVIDER_CAPABILITIES['MiniMax-H3']).toMatchObject({
            label: 'MiniMax H3',
            referenceModes: ['text', 'single', 'first_last'],
            nativeDialogue: true,
            embeddedAudio: true,
            maxImageReferences: 3,
            maxVideoReferences: 3,
            duration: { min: 5, max: 15 }
        })
        expect(WAN_3_MODEL).toBe('wan3.0-video')
        expect(WAN_3_PRIME_MODEL).toBe('wan3.0-video-prime')
        expect(WAN_3_RESOLUTION).toBe('1080P')
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance.referenceModes).toContain('first_last')
        expect(VIDEO_PROVIDER_CAPABILITIES.seedance25.referenceModes).toContain('first_last')
        expect(VIDEO_PROVIDER_CAPABILITIES.wanx.referenceModes).toContain('first_last')
        expect(VIDEO_PROVIDER_CAPABILITIES.wan3.referenceModes).toContain('first_last')
        expect(VIDEO_PROVIDER_CAPABILITIES.wan3prime.referenceModes).toContain('first_last')
        for (const provider of ['seedance-2.0-global', 'seedance-2.5-global'] as const) {
            expect(VIDEO_PROVIDER_CAPABILITIES[provider].referenceModes).toEqual(['text', 'single', 'first_last'])
            expect(VIDEO_PROVIDER_CAPABILITIES[provider].maxImageReferences).toBe(2)
            expect(VIDEO_PROVIDER_CAPABILITIES[provider].supportsMultiKeyframe).toBe(true)
        }
        expect(supportsVideoReferenceMode('veo3', 'first_last')).toBe(false)
        expect(supportsVideoReferenceMode('veo3', 'text')).toBe(true)
    })

    it('declares which video models accept up to three reference videos', () => {
        for (const provider of ['seedance', 'seedance25', 'wan3', 'wan3prime', 'seedance-2.0-global', 'seedance-2.5-global'] as const) {
            expect(VIDEO_PROVIDER_CAPABILITIES[provider].maxVideoReferences).toBe(3)
            expect(VIDEO_PROVIDER_CAPABILITIES[provider].referenceVideoDuration).toBeDefined()
        }
        expect(VIDEO_PROVIDER_CAPABILITIES.wanx.maxVideoReferences).toBe(0)
        expect(VIDEO_PROVIDER_CAPABILITIES.veo3.maxVideoReferences).toBe(0)
    })

    it('quantizes provider durations before prompt planning', () => {
        expect(normalizeVideoDuration('veo3', 10)).toBe(8)
        expect(normalizeVideoDuration('seedance', 30)).toBe(15)
        expect(normalizeVideoDuration('seedance', 11)).toBe(10)
        expect(normalizeVideoDuration('seedance25', 11)).toBe(11)
        expect(normalizeVideoDuration('seedance25', 30)).toBe(30)
        expect(normalizeVideoDuration('seedance25', 31)).toBe(30)
        expect(normalizeVideoDuration('wan3', 1)).toBe(5)
        expect(normalizeVideoDuration('wan3', 31)).toBe(30)
        expect(normalizeVideoDuration('wan3prime', 1)).toBe(5)
        expect(normalizeVideoDuration('wan3prime', 31)).toBe(30)
        expect(normalizeVideoDuration('MiniMax-H3', 4)).toBe(5)
        expect(normalizeVideoDuration('MiniMax-H3', 16)).toBe(15)
        expect(planVideoDuration('seedance', 10, 3)).toEqual({ requestedDuration: 10, plannedDuration: 12, segmentDurations: [4, 4, 4] })
    })

    it('keeps retired providers recognizable for history but unavailable to new jobs', () => {
        for (const provider of ['wanx', 'veo3', 'veo-3.1-generate-001', 'veo-3.1-fast-generate-001', 'veo-3.1-lite-generate-001']) {
            expect(isProductionVideoProvider(provider)).toBe(true)
            expect(isAvailableProductionVideoProvider(provider)).toBe(false)
        }
        for (const provider of ['seedance', 'seedance25', 'wan3', 'wan3prime', 'seedance-2.0-global', 'MiniMax-H3']) {
            expect(isAvailableProductionVideoProvider(provider)).toBe(true)
        }
    })

    it('uses native negative prompts only where the provider supports them', () => {
        expect(IMAGE_PROVIDER_CAPABILITIES['qwen-image-3.0-pro'].supportsNegativeParam).toBe(true)
        expect(QWEN_IMAGE_MAX_REFERENCES).toBe(3)
        expect(IMAGE_PROVIDER_CAPABILITIES['qwen-image-3.0-pro'].maxImageReferences).toBe(QWEN_IMAGE_MAX_REFERENCES)
        expect(resolveImagePromptChannels('qwen-image-3.0-pro', 'portrait', 'wax skin').negativePrompt).toBe('wax skin')
        expect(resolveImagePromptChannels('banana', 'portrait', 'wax skin').negativePrompt).toBeUndefined()
    })

    it('routes Himodels reference images using the model capability table', () => {
        expect(IMAGE_PROVIDER_CAPABILITIES['gemini-3.1-flash-image'].maxImageReferences).toBe(14)
        expect(IMAGE_PROVIDER_CAPABILITIES['seedream-5-0-lite'].maxImageReferences).toBe(0)
    })
})
