import { describe, expect, it } from 'vitest'
import { generationModelSource, modelDisplayName, modelDisplayNameWithSource } from './model-display'

describe('model display formatting', () => {
    it('uses readable names for Himodels model IDs', () => {
        expect(modelDisplayName('gemini:gemini-3.7-flash')).toBe('Gemini 3.7 Flash')
        expect(modelDisplayName('gemini-3.7-flash')).toBe('Gemini 3.7 Flash')
        expect(modelDisplayName(`gemini-3.7-flash_${'trans'}`)).toBe('Gemini 3.7 Flash')
        expect(modelDisplayName('seedance-2.0-global')).toBe('Seedance 2.0 Global')
        expect(modelDisplayName('MiniMax-H3')).toBe('MiniMax H3')
        expect(modelDisplayName('custom-model')).toBe('custom-model')
    })

    it.each([
        ['banana', 'direct'],
        ['qwen-image-3.0-pro', 'direct'],
        ['seedance25', 'direct'],
        ['wan3prime', 'direct'],
        ['gemini:gemini-3.7-flash', 'direct'],
        ['gemini-3.1-flash-image', 'himodels'],
        ['seedream-5-0-lite', 'himodels'],
        ['seedance-2.0-global', 'himodels'],
        ['MiniMax-H3', 'himodels'],
        [`seedance-2.5-global_${'trans'}`, 'himodels'],
        [`seedance25_${'trans'}`, 'himodels'],
        ['gemini-3.1-pro-preview', 'himodels'],
        ['gemini-3.7-flash', 'himodels']
    ])('identifies the transport source for %s', (model, source) => {
        expect(generationModelSource(model)).toBe(source)
    })

    it('adds a translated source without exposing a raw direct-provider transport name', () => {
        const translate = (value: string) => (value === '厂商直连' ? 'Direct provider' : value)
        expect(modelDisplayNameWithSource('banana', translate)).toBe('Direct provider · Nano Banana')
        expect(modelDisplayNameWithSource('google', translate)).toBe('Direct provider')
        expect(modelDisplayNameWithSource('himodels', translate)).toBe('Himodels')
    })
})
