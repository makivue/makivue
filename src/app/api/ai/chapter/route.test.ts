import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BillingError } from '@/lib/billing-error'

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    episode: vi.fn(),
    episodes: vi.fn(),
    activeJob: vi.fn(),
    model: vi.fn(),
    createJob: vi.fn(),
    updateJob: vi.fn(),
    generate: vi.fn(),
    correct: vi.fn(),
    chatJSON: vi.fn(),
    save: vi.fn()
}))

vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: mocks.after }))
vi.mock('@/lib/prisma', () => ({
    prisma: {
        episode: { findFirst: mocks.episode, findMany: mocks.episodes },
        chapterJob: { findFirst: mocks.activeJob },
        aiServiceConfig: { findUnique: mocks.model }
    }
}))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 123n }))
vi.mock('@/lib/ownership', () => ({ assertEpisodeOwner: async () => null }))
vi.mock('@/lib/chapterJobStore', () => ({ createJob: mocks.createJob, updateJob: mocks.updateJob }))
vi.mock('@/lib/text-job-lease', () => ({ startTextJobHeartbeat: () => () => {} }))
vi.mock('@/lib/himodels-usage-context.server', () => ({ withHiModelsUsageScope: (_scope: unknown, run: () => Promise<void>) => run() }))
vi.mock('@/services/billing', async () => ({ ...(await import('@/lib/billing-error')), assertSufficientPoints: async () => {}, quoteLlmBudgetPoints: () => 10, chargeLlmUsage: vi.fn() }))
vi.mock('@/services/llm', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/llm')>()),
    generateChapter: mocks.generate,
    correctChapterContent: mocks.correct,
    chatJSON: mocks.chatJSON
}))
vi.mock('@/services/narrative-persistence', () => ({ saveReviewedNarrative: mocks.save }))

import { POST } from './route'

const content = '阿青交出信封，小雨接过信封。'.repeat(10)
const review = {
    issues: [],
    quality: { causality: 80, characterAgency: 80, escalation: 80, emotionalProgression: 80, dialogueSubtext: 80, hookStrength: 80, visualDramatization: 80, notes: [] },
    facts: {
        summary: '交接信封',
        openingState: '阿青持信封',
        endingState: '小雨持信封',
        characterStateChanges: '信封易主',
        continuityBridge: '首集建立场景',
        events: [{ description: '小雨获得信封', evidence: '小雨接过信封' }]
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    const episode = { id: 789n, projectId: 999n, episodeNumber: 1, sourceVersion: 1, operationVersion: 0, status: 'outlined', title: '信封', synopsis: '交接信封', chapterContent: null }
    mocks.episode.mockResolvedValue({ ...episode, project: { id: 999n, title: '信封', totalEpisodes: 1, novelStage: 'outlined', novelSetup: JSON.stringify({ targetWordCount: 100 }) } })
    mocks.episodes.mockResolvedValue([episode])
    mocks.activeJob.mockResolvedValue(null)
    mocks.model.mockResolvedValue({ modelName: 'gemini-3.7-flash' })
    mocks.createJob.mockResolvedValue({ id: '456', createdByRequest: true })
    mocks.generate.mockResolvedValue(content)
    mocks.correct.mockResolvedValue(content)
    mocks.chatJSON.mockResolvedValue(review)
    mocks.save.mockResolvedValue(episode)
})
afterEach(() => vi.useRealTimers())

async function submit() {
    const response = await POST(new NextRequest('http://localhost/api/ai/chapter', { method: 'POST', body: JSON.stringify({ episodeId: '789' }) }))
    expect((await response.json()).data.jobId).toBe('456')
    return mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined
}

describe('chapter generation delivery', () => {
    it('delivers an English chapter when the review replaces smart quotes with straight quotes', async () => {
        const sentence = '“I can’t leave,” Maya said.'
        const englishContent = (sentence + '\n').repeat(25)
        mocks.generate.mockResolvedValue(englishContent)
        mocks.chatJSON.mockResolvedValue({ ...review, facts: { ...review.facts, events: [{ description: 'Maya speaks', evidence: '"I can\'t leave," Maya said.' }] } })
        await (await submit())!()
        expect(mocks.generate).toHaveBeenCalledOnce()
        expect(mocks.chatJSON).toHaveBeenCalledOnce()
        expect(mocks.correct).not.toHaveBeenCalled()
        expect(mocks.save).toHaveBeenCalledWith(
            expect.objectContaining({
                content: englishContent.trim(),
                facts: expect.objectContaining({ events: [{ description: 'Maya speaks', evidence: sentence }] })
            })
        )
        expect(mocks.updateJob).toHaveBeenLastCalledWith('456', expect.objectContaining({ phase: 'done' }))
    })

    it('saves a chapter after recovering malformed review evidence without generating it again', async () => {
        mocks.chatJSON.mockResolvedValueOnce({ ...review, facts: { ...review.facts, events: [{ description: '交接', evidence: '不存在的原句' }] } })
        const run = await submit()
        expect(mocks.generate).not.toHaveBeenCalled()
        await run!()
        expect(mocks.generate).toHaveBeenCalledOnce()
        expect(mocks.chatJSON).toHaveBeenCalledTimes(2)
        expect(mocks.save).toHaveBeenCalledOnce()
        expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ stage: 'chapter', content, facts: expect.objectContaining({ events: review.facts.events }) }))
        expect(mocks.updateJob).toHaveBeenLastCalledWith('456', expect.objectContaining({ phase: 'done', result: expect.objectContaining({ chapterContent: content }) }))
    })

    it('does not save or report success when factual review stays invalid', async () => {
        mocks.chatJSON.mockResolvedValue({ ...review, facts: { ...review.facts, events: [] } })
        await (await submit())!()
        expect(mocks.generate).toHaveBeenCalledOnce()
        expect(mocks.chatJSON).toHaveBeenCalledTimes(3)
        expect(mocks.save).not.toHaveBeenCalled()
        expect(mocks.updateJob).toHaveBeenLastCalledWith('456', expect.objectContaining({ phase: 'error', error: expect.stringContaining('未提取实际事件') }))
    })

    it('surfaces insufficient balance immediately instead of retrying it four times', async () => {
        mocks.generate.mockRejectedValue(new BillingError('可用金币不足'))
        await (await submit())!()
        expect(mocks.generate).toHaveBeenCalledOnce()
        expect(mocks.save).not.toHaveBeenCalled()
        expect(mocks.updateJob).toHaveBeenLastCalledWith('456', expect.objectContaining({ phase: 'error', error: '可用金币不足' }))
    })

    it('reconnects to an existing job without scheduling or charging another generation', async () => {
        mocks.activeJob.mockResolvedValue({ id: 456n })
        expect(await submit()).toBeUndefined()
        expect(mocks.createJob).not.toHaveBeenCalled()
        expect(mocks.generate).not.toHaveBeenCalled()
    })
})
