import { BillingError } from '@/lib/billing-error'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/services/narrative-persistence', () => ({ saveGeneratedNarrative: mocks.save }))

import { POST } from './route'

const content = '阿青交出信封，小雨接过信封。'.repeat(10)
beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    const episode = { id: 789n, projectId: 999n, episodeNumber: 1, sourceVersion: 1, operationVersion: 0, status: 'outlined', title: '信封', synopsis: '交接信封', chapterContent: null }
    mocks.episode.mockResolvedValue({ ...episode, project: { id: 999n, title: '信封', totalEpisodes: 1, novelStage: 'outlined', novelSetup: JSON.stringify({ targetWordCount: 100 }) } })
    mocks.episodes.mockResolvedValue([episode])
    mocks.activeJob.mockResolvedValue(null)
    mocks.model.mockResolvedValue({ modelName: 'gemini-3.7-flash' })
    mocks.createJob.mockResolvedValue({ id: '456', createdByRequest: true })
    mocks.generate.mockResolvedValue(content)
    mocks.correct.mockResolvedValue(content)
    mocks.save.mockResolvedValue(episode)
})
afterEach(() => vi.useRealTimers())

async function submit() {
    const response = await POST(new NextRequest('http://localhost/api/ai/chapter', { method: 'POST', body: JSON.stringify({ episodeId: '789' }) }))
    expect((await response.json()).data.jobId).toBe('456')
    return mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined
}

describe('chapter generation delivery', () => {
    it('saves the first chapter without review, correction or invented facts', async () => {
        const sentence = '“I can’t leave,” Maya said.'
        mocks.generate.mockResolvedValue(sentence)
        await (await submit())!()
        expect(mocks.generate).toHaveBeenCalledOnce()
        expect(mocks.chatJSON).not.toHaveBeenCalled()
        expect(mocks.correct).not.toHaveBeenCalled()
        expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ content: sentence, facts: expect.objectContaining({ summary: sentence, events: [] }) }))
        expect(mocks.updateJob).toHaveBeenLastCalledWith('456', expect.objectContaining({ phase: 'done' }))
    })

    it('does not save or report success if local persistence rejects the result', async () => {
        mocks.save.mockRejectedValue(new Error('content changed during generation'))
        await (await submit())!()
        expect(mocks.generate).toHaveBeenCalledOnce()
        expect(mocks.updateJob).toHaveBeenLastCalledWith('456', expect.objectContaining({ phase: 'error' }))
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
