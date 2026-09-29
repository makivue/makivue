import { describe, expect, it } from 'vitest'
import {
    buildHiModelsImageRequest,
    buildHiModelsVideoRequest,
    extractHiModelsUsage,
    HIMODELS_VEO_LABEL,
    isUnsupportedHiModelsThinkingParameter,
    resolveHiModelsLocalReferencePath,
    stringifyHiModelsRequest
} from './himodels'
import { getHiModelsImageModelCapability, HIMODELS_IMAGE_MODELS, HIMODELS_TEXT_MODELS, HIMODELS_VIDEO_MODELS, isHiModelsTextModel } from '@/lib/himodels-models'

describe('Himodels model integration', () => {
    it('confines local reference images to public', () => {
        const projectRoot = '/srv/local-studio'
        expect(resolveHiModelsLocalReferencePath('/storage/character.png', projectRoot)).toBe('/srv/local-studio/public/storage/character.png')
        expect(resolveHiModelsLocalReferencePath('../hi-models.json', projectRoot)).toBeNull()
    })

    it('uses the same raw provider IDs throughout the product and upstream requests', () => {
        expect(HIMODELS_VEO_LABEL).toBe('veo-3.1-generate-001')
        expect(HIMODELS_IMAGE_MODELS).toEqual(['gemini-3.1-flash-image', 'seedream-5-0-lite'])
        expect(HIMODELS_VIDEO_MODELS).toEqual(['seedance-2.0-global', 'seedance-2.5-global', 'MiniMax-H3', 'veo-3.1-generate-001', 'veo-3.1-fast-generate-001', 'veo-3.1-lite-generate-001'])
        expect(HIMODELS_TEXT_MODELS).toEqual(['gemini-3.7-flash'])
        expect(isHiModelsTextModel('gemini-3.7-flash')).toBe(true)
    })

    it('builds Gemini image requests according to each model capability', () => {
        expect(buildHiModelsImageRequest({ model: 'gemini-3.1-flash-image', prompt: 'cat', aspectRatio: '16:9', imageSize: '2K' })).toEqual({
            model: 'gemini-3.1-flash-image',
            contents: [{ role: 'user', parts: [{ text: 'cat' }] }],
            generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: '16:9', imageSize: '2K' }
            }
        })
    })

    it('strips every thinking-level field from all HiModels request payloads', () => {
        // These unsupported fields are deliberately injected into a fake payload
        // to prove the outbound serializer removes them; this is not a request template.
        const serialized = stringifyHiModelsRequest({
            model: 'future-model',
            thinkingLevel: 'HIGH',
            thinking_level: 'HIGH',
            generationConfig: {
                thinking_config: { thinking_level: 'HIGH' },
                responseModalities: ['IMAGE']
            }
        })

        expect(JSON.parse(serialized)).toEqual({
            model: 'future-model',
            generationConfig: { responseModalities: ['IMAGE'] }
        })
        expect(serialized).not.toMatch(/thinking[_-]?(?:level|config)/i)
    })

    it('keeps an exhaustive capability profile for every Himodels image model', () => {
        expect(getHiModelsImageModelCapability('gemini-3.1-flash-image')).toMatchObject({ requestFamily: 'gemini', maxReferenceImages: 14 })
        expect(getHiModelsImageModelCapability('seedream-5-0-lite')).toMatchObject({ requestFamily: 'seedream', maxReferenceImages: 0, supportedImageSizes: ['2K'] })
    })

    it('recognizes only explicit unsupported-thinking responses for a safe compatibility retry', () => {
        expect(isUnsupportedHiModelsThinkingParameter(new Error('thinking_level is not supported by this model'))).toBe(true)
        expect(isUnsupportedHiModelsThinkingParameter(new Error('thinking_level\nis not supported by this model'))).toBe(true)
        expect(isUnsupportedHiModelsThinkingParameter(new Error('invalid prompt'))).toBe(false)
        expect(isUnsupportedHiModelsThinkingParameter(new Error('request timed out'))).toBe(false)
    })

    it('builds Seedream image requests according to each model capability', () => {
        expect(buildHiModelsImageRequest({ model: 'seedream-5-0-lite', prompt: 'cat', imageSize: '1K' })).toEqual({
            model: 'seedream-5-0-lite',
            prompt: 'cat',
            size: '2K',
            output_format: 'png',
            watermark: false
        })
    })

    it('passes an ultra-wide aspect ratio through the Gemini image request', () => {
        expect(buildHiModelsImageRequest({ model: 'gemini-3.1-flash-image', prompt: 'character sheet', aspectRatio: '21:9', imageSize: '4K' })).toMatchObject({
            generationConfig: { imageConfig: { aspectRatio: '21:9', imageSize: '4K' } }
        })
    })

    it.each(['seedance-2.0-global', 'seedance-2.5-global'] as const)('builds the documented Seedance request for %s', model => {
        expect(buildHiModelsVideoRequest({ model, prompt: 'camera pans left', aspectRatio: '16:9', duration: 5 })).toEqual({
            model,
            ratio: '16:9',
            content: [{ type: 'text', text: 'camera pans left' }],
            duration: 5,
            resolution: '720p'
        })
    })

    it('builds the documented MiniMax H3 2K omni-modal request', () => {
        expect(
            buildHiModelsVideoRequest({
                model: 'MiniMax-H3',
                prompt: 'camera pans left',
                aspectRatio: '21:9',
                duration: 15,
                referenceImages: [
                    { url: 'https://cdn.test/opening.png', role: 'first_frame' },
                    { url: 'https://cdn.test/ending.png', role: 'last_frame' },
                    { url: 'https://cdn.test/style.png', role: 'reference_image' }
                ],
                referenceVideos: [{ url: 'https://cdn.test/motion.mp4', durationSeconds: 6 }]
            })
        ).toEqual({
            model: 'MiniMax-H3',
            ratio: '21:9',
            content: [
                { type: 'text', text: 'camera pans left' },
                { type: 'image_url', image_url: { url: 'https://cdn.test/opening.png' }, role: 'first_frame' },
                { type: 'image_url', image_url: { url: 'https://cdn.test/ending.png' }, role: 'last_frame' },
                { type: 'image_url', image_url: { url: 'https://cdn.test/style.png' }, role: 'reference_image' },
                { type: 'video_url', video_url: { url: 'https://cdn.test/motion.mp4' }, role: 'reference_video' }
            ],
            duration: 15,
            resolution: '2K'
        })
    })

    it('adds reference videos to content-based HiModels video requests', () => {
        expect(
            buildHiModelsVideoRequest({
                model: 'seedance-2.5-global',
                prompt: 'camera pans left',
                aspectRatio: '16:9',
                duration: 5,
                referenceVideos: [{ url: 'https://cdn.test/reference.mp4' }]
            }).content
        ).toContainEqual({ type: 'video_url', video_url: { url: 'https://cdn.test/reference.mp4' }, role: 'reference_video' })
    })

    it('extracts only usage counters from image and video responses', () => {
        expect(
            extractHiModelsUsage({
                id: 'task-1',
                usage: { input_tokens: 120, output_tokens: 480, input_tokens_details: { text_tokens: 80, image_tokens: 40 } },
                response: { metadata: { billableSeconds: 8 } },
                authorizationToken: 'must-not-leak'
            })
        ).toEqual({
            'usage.input_tokens': 120,
            'usage.output_tokens': 480,
            'usage.input_tokens_details.text_tokens': 80,
            'usage.input_tokens_details.image_tokens': 40,
            'response.metadata.billableSeconds': 8
        })
        expect(extractHiModelsUsage({ name: 'task-2', done: true })).toBeNull()
    })
})
