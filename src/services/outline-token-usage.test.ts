import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderTokenUsageCollector } from '@/lib/himodels-token-usage'
import { extractApiTokenUsage } from '@/lib/api-token-usage'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), chatHiModels: vi.fn(), chatGemini: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: mocks.findUnique } } }))
vi.mock('./himodels', () => ({ chatHiModels: mocks.chatHiModels }))
vi.mock('./gemini-text', () => ({ chatGemini: mocks.chatGemini }))
import { generateOutlineBatch, fillMissingChapters } from './llm'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('outline usage propagation through JSON parsing', () => {
    it('sends the selected regional narrative recipe to the outline model', async () => {
        mocks.findUnique.mockResolvedValue({ modelName: 'gemini:gemini-3.7-flash' })
        mocks.chatGemini.mockResolvedValue(JSON.stringify({ chapters: [{ chapterNumber: 1, title: 'chapter', synopsis: 'text' }] }))
        await generateOutlineBatch({ title: 'test', totalEpisodes: 1, setup: { visualStyle: 'sea-rebirth-revenge', contentLanguage: 'fr' }, existingChapters: [], chapterNumbers: [1] })
        const messages = mocks.chatGemini.mock.calls.at(-1)![1] as Array<{ content: string }>
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('Regional story direction: Southeast Asia / sea-rebirth-revenge')
        expect(prompt).toContain('limits of foreknowledge')
        expect(prompt).toContain('Preserve the selected content language')
        expect(prompt).not.toContain('Ho Chi Minh City:')
    })

    it('collects an invalid-JSON retry and a missing-chapter fill as separate actual upstream calls', async () => {
        mocks.findUnique.mockResolvedValue({ modelName: 'gemini-3.7-flash' })
        let calls = 0
        const collector = createProviderTokenUsageCollector()
        mocks.chatHiModels.mockImplementation(async (model, _messages, options) => {
            calls += 1
            await options.onUsage?.({ id: `call-${calls}`, provider: 'himodels', model, usage: extractApiTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) })
            return calls === 1 ? ']][[' : JSON.stringify({ chapters: [{ chapterNumber: calls === 2 ? 1 : 2, title: 'chapter', synopsis: 'text' }] })
        })
        const base = { title: 'test', totalEpisodes: 2, setup: {}, existingChapters: [], onTokenUsage: collector.record }
        await generateOutlineBatch({ ...base, chapterNumbers: [1] })
        await fillMissingChapters({ ...base, missingChapterNumbers: [2] })
        expect(calls).toBe(3)
        expect(collector.snapshot().tokenUsage).toMatchObject({ source: 'himodels', providers: ['himodels'], inputTokens: 30, outputTokens: 6, totalTokens: 36, calls: 3, complete: true })
    })

    it('propagates direct Gemini usage through the same outline collector', async () => {
        mocks.findUnique.mockResolvedValue({ modelName: 'gemini:gemini-3.7-flash' })
        const collector = createProviderTokenUsageCollector()
        mocks.chatGemini.mockImplementation(async (model, _messages, options) => {
            await options.onUsage?.({
                id: 'gemini-call',
                provider: 'gemini',
                model: `gemini:${model}`,
                usage: extractApiTokenUsage({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 180 } })
            })
            return JSON.stringify({ chapters: [{ chapterNumber: 1, title: 'chapter', synopsis: 'text' }] })
        })

        await generateOutlineBatch({ title: 'test', totalEpisodes: 1, setup: {}, existingChapters: [], chapterNumbers: [1], onTokenUsage: collector.record })

        expect(collector.snapshot().tokenUsage).toMatchObject({
            source: 'gemini',
            providers: ['gemini'],
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 180,
            calls: 1
        })
    })
})
