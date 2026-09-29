import { describe, expect, it } from 'vitest'
import { extractApiTokenUsage, extractRawTokenUsage } from './api-token-usage'
import { createProviderTokenUsageCollector } from './himodels-token-usage'

describe('HiModels reported text token usage', () => {
    it('prefers the complete job aggregate over legacy per-image counters, including explicit unknowns', () => {
        const data = {
            tokenUsage: { source: 'himodels', calls: 2, inputTokens: 20, outputTokens: 4, totalTokens: 24 },
            result: { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }
        }
        expect(extractApiTokenUsage({ data })).toMatchObject({ inputTokens: 20, outputTokens: 4, totalTokens: 24 })
        expect(extractApiTokenUsage({ data: { ...data, tokenUsage: { ...data.tokenUsage, inputTokens: null, outputTokens: null, totalTokens: null } } })).toBeNull()
    })

    it('retains Gemini modality arrays, cached and reasoning counters without double counting them', () => {
        const usageMetadata = {
            promptTokenCount: 100,
            candidatesTokenCount: 200,
            totalTokenCount: 320,
            thoughtsTokenCount: 20,
            cachedContentTokenCount: 10,
            candidatesTokensDetails: [
                { modality: 'IMAGE', tokenCount: 190 },
                { modality: 'TEXT', tokenCount: 10 }
            ]
        }
        const payload = { result: { response: { usageMetadata } } }
        expect(extractRawTokenUsage(payload)).toEqual({ 'result.response.usageMetadata': usageMetadata })
        expect(extractApiTokenUsage(payload)).toMatchObject({
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 320,
            raw: { 'candidatesTokensDetails.0.tokenCount': 190, cachedContentTokenCount: 10 }
        })
    })

    it('retains ambiguous per-item usage without inventing a request aggregate', () => {
        const payload = { data: [{ usage: { total_tokens: 10 } }, { usage: { total_tokens: 20 } }] }
        expect(extractRawTokenUsage(payload)).toEqual({ 'data.0.usage': { total_tokens: 10 }, 'data.1.usage': { total_tokens: 20 } })
        expect(extractApiTokenUsage(payload)).toBeNull()
        expect(extractApiTokenUsage({ response: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } })).toMatchObject({ totalTokens: 12 })
        expect(extractRawTokenUsage({ choices: [{ message: { usage: { total_tokens: 999 } } }], assets: [{ usage: { total_tokens: 999 } }] })).toBeNull()
    })

    it('counts cumulative video polls or image replays once, preserving earlier usage if the final body omits it', () => {
        const collector = createProviderTokenUsageCollector()
        const record = (id: string, usage: ReturnType<typeof extractApiTokenUsage>, operationKey = 'video-one') => collector.record({ id, model: 'model', operationKey, usage })
        record('submit', null)
        record('poll-1', extractApiTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }))
        record('poll-2', extractApiTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }))
        record('complete', null)
        expect(collector.snapshot().tokenUsage).toMatchObject({ calls: 4, operations: 1, totalTokens: 13, callsWithUsage: 2, missingUsageCalls: 2, missingUsageOperations: 0, complete: true })
        record('separate-text-call', extractApiTokenUsage({ usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }), 'text-one')
        expect(collector.snapshot().tokenUsage).toMatchObject({ calls: 5, operations: 2, inputTokens: 15, outputTokens: 4, totalTokens: 19 })
    })

    it('uses the screenshot counters, not zero-valued alternate aliases or nested breakdowns', () => {
        const usage = extractApiTokenUsage({
            usage: {
                input_tokens: 0,
                output_tokens: 0,
                billing_usage: { gemini_usage_metadata: { promptTokenCount: 13890, candidatesTokenCount: 2520, totalTokenCount: 16410 } },
                completion_tokens: 2520,
                completion_tokens_details: { text_tokens: 2520, reasoning_tokens: 0 },
                prompt_tokens: 13890,
                total_tokens: 16410
            }
        })
        expect(usage).toMatchObject({ inputTokens: 13890, outputTokens: 2520, totalTokens: 16410 })
        expect(usage?.raw.input_tokens).toBe(0)
    })

    it('preserves provider totals that include thinking tokens without adding them again', () => {
        expect(extractApiTokenUsage({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130 } })).toMatchObject({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 130
        })
    })

    it('keeps real zero counters and treats absent/invalid usage as unknown', () => {
        expect(extractApiTokenUsage({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
        expect(extractApiTokenUsage({ choices: [] })).toBeNull()
        expect(extractApiTokenUsage({ usage: { input_tokens: -2 } })).toBeNull()
        expect(extractApiTokenUsage({ usage: { prompt_tokens: '12' } })).toMatchObject({ inputTokens: 12, outputTokens: null, totalTokens: null })
    })

    it('aggregates all batches, retries and fills beyond the raw response retention limit, once per call', () => {
        const collector = createProviderTokenUsageCollector()
        for (let i = 0; i < 25; i++) {
            const call = { id: `call-${i}`, model: 'gemini-3.7-flash', usage: extractApiTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) }
            collector.record(call)
            collector.record(call)
        }
        expect(collector.snapshot().tokenUsage).toMatchObject({
            source: 'himodels',
            inputTokens: 250,
            outputTokens: 50,
            totalTokens: 300,
            calls: 25,
            callsWithUsage: 25,
            missingUsageCalls: 0,
            complete: true
        })
        expect(collector.snapshot().tokenUsageCalls).toHaveLength(25)
    })

    it('explicitly marks incomplete totals, never turning missing usage into a zero-token call', () => {
        const collector = createProviderTokenUsageCollector()
        collector.record({ id: 'unknown', model: 'model', usage: null })
        expect(collector.snapshot().tokenUsage).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null, missingUsageCalls: 1, complete: false })
        collector.record({ id: 'known', model: 'model', usage: extractApiTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 2 } }) })
        expect(collector.snapshot().tokenUsage).toMatchObject({ inputTokens: 10, outputTokens: 2, totalTokens: 12, calls: 2, missingUsageCalls: 1, complete: false })
    })
})
