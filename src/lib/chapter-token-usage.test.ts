import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    currentUserId: vi.fn(),
    assertEpisodeOwner: vi.fn(),
    readHiModelsUsage: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({ prisma: { chapterJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertEpisodeOwner: mocks.assertEpisodeOwner }))
vi.mock('@/lib/himodels-usage-ledger.server', () => ({ readHiModelsUsage: mocks.readHiModelsUsage }))

import { GET } from '@/app/api/ai/chapter/status/[jobId]/route'
import { updateJob } from './chapterJobStore'
import { extractApiTokenUsage } from './api-token-usage'
import { createProviderTokenUsageCollector } from './himodels-token-usage'

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertEpisodeOwner.mockResolvedValue(null)
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.readHiModelsUsage.mockResolvedValue({ tokenUsage: null, himodelsUsageCalls: [], usageTrackingAvailable: true })
})

describe('chapter direct-provider token usage', () => {
    it('preserves per-call usage when the completed chapter content is saved', async () => {
        const collector = createProviderTokenUsageCollector()
        collector.record({
            id: 'gemini-call',
            provider: 'gemini',
            model: 'gemini:gemini-3.7-flash',
            usage: extractApiTokenUsage({ usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, totalTokenCount: 110 } })
        })
        mocks.findUnique.mockResolvedValue({ result: collector.snapshot() })

        await updateJob('456', { phase: 'done', result: { episodeId: '789', chapterContent: 'chapter' } })

        expect(mocks.updateMany.mock.calls[0][0].data.result).toMatchObject({
            episodeId: '789',
            chapterContent: 'chapter',
            tokenUsage: { source: 'gemini', inputTokens: 80, outputTokens: 20, totalTokens: 110 },
            tokenUsageCalls: [expect.objectContaining({ id: 'gemini-call', provider: 'gemini' })]
        })
    })

    it('returns saved Gemini usage at the top level of a completed chapter status response', async () => {
        const collector = createProviderTokenUsageCollector()
        collector.record({
            id: 'gemini-call',
            provider: 'gemini',
            model: 'gemini:gemini-3.7-flash',
            usage: extractApiTokenUsage({ usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, totalTokenCount: 110 } })
        })
        mocks.findUnique.mockResolvedValue({
            id: 456n,
            episodeId: 789n,
            projectId: 999n,
            phase: 'done',
            attempts: 1,
            result: { episodeId: '789', chapterContent: 'chapter', ...collector.snapshot() },
            createdAt: new Date(),
            updatedAt: new Date(),
            leaseExpiresAt: null
        })

        const response = await GET(new NextRequest('http://localhost:3000/api/ai/chapter/status/456'), { params: Promise.resolve({ jobId: '456' }) })
        const payload = await response.json()

        expect(payload.data.tokenUsage).toMatchObject({ source: 'gemini', inputTokens: 80, outputTokens: 20, totalTokens: 110 })
        expect(payload.data.tokenUsageCalls).toEqual([expect.objectContaining({ id: 'gemini-call', provider: 'gemini' })])
        expect(payload.data.himodelsUsageCalls).toEqual([])
        expect(payload.data.result).toEqual({ episodeId: '789', chapterContent: 'chapter' })
    })
})
