import { afterEach, describe, expect, it, vi } from 'vitest'
import { actualModelCostUsd, meterModelRequest, resolveModelPrice, type ModelPrice } from './model-pricing'
import { SEEDANCE_25_ENDPOINT_ID } from './provider-capabilities'

afterEach(() => vi.unstubAllEnvs())
const meter = meterModelRequest({ prompt: 'A paper boat', duration: 6, resolution: '720p' })
const hi = 'https://api.himodels.ai/v1/chat/completions'
function price(provider: 'himodels' | 'gemini' | 'qwen' | 'volcengine', model: string, url = hi, params = meter): ModelPrice {
    return { ...resolveModelPrice(provider, model, params, url)!, usdPerCurrency: 1 }
}

describe('supplier cost billing', () => {
    it('uses the real HiModels input and completion totals including reasoning', () => {
        const cost = actualModelCostUsd(price('himodels', 'gemini-3.7-flash'), meter, {
            usage: { input_tokens: 0, output_tokens: 0, prompt_tokens: 1495, completion_tokens: 2663, total_tokens: 4158, completion_tokens_details: { text_tokens: 1550, reasoning_tokens: 1113 } }
        })
        expect(cost).toBe(0.0262095)
        expect(Math.ceil(cost! * 1000)).toBe(27)
    })
    it('subtracts cache hits from ordinary input instead of charging both', () => {
        const cost = actualModelCostUsd(price('himodels', 'gemini-3.7-flash'), meter, { usage: { prompt_tokens: 10000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 6000 } } })
        expect(cost).toBe(0.0249)
    })
    it('includes native Gemini thoughts exactly once even with a compatibility envelope', () => {
        const cost = actualModelCostUsd(price('gemini', 'gemini:gemini-3.7-flash', 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/models/x'), meter, {
            usage: { prompt_tokens: 1000, completion_tokens: 2000 },
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, thoughtsTokenCount: 1500, totalTokenCount: 3000 }
        })
        expect(cost).toBe(0.00825)
    })
    it('separates image output and thinking tokens', () => {
        expect(
            actualModelCostUsd(price('himodels', 'gemini-3.1-flash-image'), meter, {
                usageMetadata: {
                    promptTokenCount: 1000,
                    candidatesTokenCount: 1000,
                    thoughtsTokenCount: 200,
                    totalTokenCount: 2200,
                    candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1000 }]
                }
            })
        ).toBe(0.0611)
    })
    it('accepts the observed HiModels image response with both usage envelopes', () => {
        expect(
            actualModelCostUsd(price('himodels', 'gemini-3.1-flash-image'), meter, {
                usage: { prompt_tokens: 1792, completion_tokens: 2520, total_tokens: 4312 },
                usageMetadata: { promptTokenCount: 1792, candidatesTokenCount: 2520, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 2520 }] }
            })
        ).toBe(0.152096)
    })
    it('requires output tokens for token-priced videos; duration is never a substitute', () => {
        const p = price('himodels', 'seedance-2.0-global')
        expect(actualModelCostUsd(p, meter, { duration: 6 })).toBeNull()
        expect(actualModelCostUsd(p, meter, { usage: { completion_tokens: 100000 } })).toBe(0.7)
    })
    it('keeps 2.5 independent of the 2.0 price and locks CNY conversion', () => {
        expect(resolveModelPrice('himodels', 'seedance-2.5-global', meter, hi)?.output).toBe(10.7)
        const p = price('volcengine', SEEDANCE_25_ENDPOINT_ID, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks')
        expect(p.output).toBe(70)
        expect(actualModelCostUsd({ ...p, usdPerCurrency: 1 / 7 }, meter, { usage: { completion_tokens: 100000 } })).toBe(1)
    })
    it.each([
        ['480p', false, 10.7],
        ['480p', true, 6.4],
        ['720p', false, 10.7],
        ['720p', true, 6.4],
        ['1080p', false, 11.7],
        ['1080p', true, 7]
    ])('settles HiModels 2.5 %s, input video=%s at the independent dollar tariff', (resolution, hasInputVideo, output) => {
        const params = { ...meter, resolution: String(resolution), hasInputVideo: Boolean(hasInputVideo) }
        const p = price('himodels', 'seedance-2.5-global', hi, params)
        expect(p.output).toBe(output)
        expect(actualModelCostUsd(p, params, { usage: { completion_tokens: 100000 } })).toBeCloseTo(Number(output) / 10, 12)
        expect(actualModelCostUsd(p, params, { duration: 6 })).toBeNull()
    })
    it('does not guess an unpublished 2.5 4K tariff', () => {
        expect(resolveModelPrice('himodels', 'seedance-2.5-global', { ...meter, resolution: '4k' }, hi)).toBeNull()
    })
    it('prices MiniMax H3 2K input/output seconds and only images beyond five', () => {
        const params = meterModelRequest({
            model: 'MiniMax-H3',
            resolution: '2K',
            duration: 10,
            input_video_duration: 4,
            content: [{ type: 'text', text: 'animate' }, ...Array.from({ length: 6 }, (_, index) => ({ type: 'image_url', image_url: { url: `https://cdn.test/${index}.png` } }))]
        })
        const p = price('himodels', 'MiniMax-H3', hi, params)
        expect(p).toMatchObject({ kind: 'video_seconds', second: 0.13, inputImage: 0.04, includedInputImages: 5 })
        expect(actualModelCostUsd(p, params, { duration: 10 })).toBe(1.86)
    })
    it('rounds only after adding input and successful output image costs', () => {
        const params = meterModelRequest({ input: { messages: [{ content: [{ image: 'a' }, { image: 'b' }, { text: 'boat' }] }] }, parameters: { size: '1328*1328', n: 2 } })
        const p = price('qwen', 'qwen-image-3.0-pro', 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', params)
        expect(params.inputImages).toBe(2)
        expect(
            actualModelCostUsd({ ...p, usdPerCurrency: 1 / 7 }, params, { usage: { output_image_type: 'qima_output_1k' }, output: { choices: [{ message: { content: [{ image: 'success.png' }] } }] } })
        ).toBeCloseTo(0.29 / 7, 12)
        expect(actualModelCostUsd({ ...p, usdPerCurrency: 1 / 7 }, params, { usage: { output_image_type: 'qima_output_2k', output_image_count: 1, input_image_count: 2 } })).toBeCloseTo(0.54 / 7, 12)
        expect(actualModelCostUsd(p, params, { usage: { output_width: 1328, output_height: 1328, output_image_count: 1 } })).toBeNull()
    })
    it('counts delivered Seedream URL images when the real gateway response has no token usage', () => {
        const p = price('himodels', 'seedream-5-0-lite')
        const requestedBatch = { ...meter, outputImages: 4 }
        expect(actualModelCostUsd(p, requestedBatch, { images: ['https://images.example/cup.png'] })).toBe(0.04)
        expect(actualModelCostUsd(p, requestedBatch, { images: ['https://images.example/a.png', 'https://images.example/b.png'] })).toBe(0.08)
        expect(actualModelCostUsd(p, requestedBatch, { images: [] })).toBeNull()
        expect(actualModelCostUsd(p, requestedBatch, { images: ['', 'upstream error', null] })).toBeNull()
    })
    it('uses actual billed input and output seconds for Wan', () => {
        const params = { ...meter, resolution: '1080p', duration: 10, inputVideoSeconds: 5 }
        const p = price('qwen', 'wan3.0-video', 'https://dashscope.aliyuncs.com/api/v1/tasks/x', params)
        expect(actualModelCostUsd({ ...p, usdPerCurrency: 1 / 7 }, params, { usage: { output_video_duration: 8, input_video_duration: 3 } })).toBe(1.32)
        expect(actualModelCostUsd(p, params, { output: { video_url: 'ready.mp4' } })).toBeNull()
    })
    it('uses actual input for the 200K context tier, independent of budget', () => {
        const params = { ...meter, inputTokenBudget: 400000 }
        const p = price('gemini', 'gemini-2.5-pro', 'https://aiplatform.googleapis.com/models/x', params)
        expect(actualModelCostUsd(p, params, { usageMetadata: { promptTokenCount: 100000, candidatesTokenCount: 1000 } })).toBe(0.135)
        expect(actualModelCostUsd(p, params, { usageMetadata: { promptTokenCount: 200001, candidatesTokenCount: 1000 } })).toBe(0.5150025)
    })
    it('does not silently turn missing usage or malformed prices into free calls', () => {
        expect(actualModelCostUsd(price('himodels', 'gemini-3.1-flash-image'), meter, { usage: { prompt_tokens: 100, completion_tokens: 1000 } })).toBeNull()
        vi.stubEnv('MODEL_COST_RATES_JSON', JSON.stringify({ 'himodels:gemini-3.7-flash': { version: 'test', source: hi, currency: 'USD', kind: 'text', input: -1, output: 3 } }))
        expect(() => resolveModelPrice('himodels', 'gemini-3.7-flash', meter, hi)).toThrow()
    })
})
