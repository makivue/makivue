vi.mock('@/lib/local-store', () => ({ localTransactionLock: async () => [{ acquired: 1 }] }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    transaction: vi.fn(),
    queryRaw: vi.fn(),
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    releaseModelReservations: vi.fn()
}))
vi.mock('@/lib/prisma', () => ({
    prisma: {
        outlineJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
        $transaction: mocks.transaction
    }
}))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/services/wallet-reservations', () => ({ releaseModelReservations: mocks.releaseModelReservations }))

import { appendOutlineHiModelsResponse, updateJob } from './outlineJobStore'
import { DELETE, GET } from '@/app/api/ai/outline/status/[jobId]/route'
import { HIMODELS_RAW_RESPONSE_MAX_RECORDS, type HiModelsRawResponse } from './himodels-response-diagnostics'
import { createProviderTokenUsageCollector } from './himodels-token-usage'
import { extractApiTokenUsage } from './api-token-usage'

const diagnostic: HiModelsRawResponse = {
    id: 'provider-call-1',
    model: 'gemini-3.7-flash',
    status: 200,
    receivedAt: '2026-09-07T00:00:00.000Z',
    requestId: 'upstream-request-1',
    response: { choices: [{ message: { content: 'outline' } }], usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } },
    truncated: false
}

beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'true')
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertProjectOwner.mockResolvedValue(null)
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.transaction.mockImplementation(callback => callback({ $queryRaw: mocks.queryRaw, outlineJob: { updateMany: mocks.updateMany } }))
    mocks.releaseModelReservations.mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllEnvs())

describe('outline raw response persistence', () => {
    it('appends separate calls and bounds retained diagnostics', async () => {
        const responses = Array.from({ length: HIMODELS_RAW_RESPONSE_MAX_RECORDS }, (_, index) => ({ ...diagnostic, id: `call-${index}` }))
        mocks.findUnique.mockResolvedValue({ result: { count: 5, himodelsResponses: responses, himodelsResponsesDropped: 2 } })

        await appendOutlineHiModelsResponse('456', diagnostic)

        const args = mocks.updateMany.mock.calls[0][0]
        expect(args.where).toEqual({ id: 456n, phase: { notIn: ['cancelled', 'done', 'error'] } })
        expect(args.data.result.count).toBe(5)
        expect(args.data.result.himodelsResponses).toEqual([...responses.slice(1), diagnostic])
        expect(args.data.result.himodelsResponsesDropped).toBe(3)
    })

    it('preserves raw responses when saving the final outline summary', async () => {
        mocks.findUnique.mockResolvedValue({ result: { himodelsResponses: [diagnostic], himodelsResponsesDropped: 0 } })

        await updateJob('456', { phase: 'done', result: { count: 12, requested: 12, missing: [] } })

        expect(mocks.updateMany.mock.calls[0][0].data.result).toEqual({
            himodelsResponses: [diagnostic],
            himodelsResponsesDropped: 0,
            count: 12,
            requested: 12,
            missing: []
        })
    })

    it('does not touch diagnostic results during heartbeat updates', async () => {
        await updateJob('456', {})

        expect(mocks.findUnique).not.toHaveBeenCalled()
        expect(mocks.updateMany.mock.calls[0][0].data).not.toHaveProperty('result')
    })
})

describe('outline status diagnostic access', () => {
    const request = () => new NextRequest('http://localhost:3000/api/ai/outline/status/456')
    const context = () => ({ params: Promise.resolve({ jobId: '456' }) })
    const job = (phase = 'done') => ({
        id: 456n,
        projectId: 789n,
        phase,
        totalEpisodes: 12,
        receivedChapters: 12,
        result: { count: 12, requested: 12, missing: [], himodelsResponses: [diagnostic], himodelsResponsesDropped: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000)
    })

    it.each(['generating', 'done', 'error'])('returns original provider bodies to the project owner during %s', async phase => {
        mocks.findUnique.mockResolvedValue(job(phase))

        const response = await GET(request(), context())
        const payload = await response.json()

        expect(mocks.assertProjectOwner).toHaveBeenCalledWith(789n, 123n)
        expect(payload.data.himodelsResponses).toEqual([diagnostic])
        expect(payload.data.result?.himodelsResponses).toBeUndefined()
        if (phase === 'done') expect(payload.data.result).toEqual({ count: 12, requested: 12, missing: [] })
    })

    it('does not expose stored raw content in production when diagnostics are disabled', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', '')
        mocks.findUnique.mockResolvedValue(job())

        const payload = await (await GET(request(), context())).json()

        expect(payload.data).not.toHaveProperty('himodelsResponses')
        expect(payload.data.result).toEqual({ count: 12, requested: 12, missing: [] })
    })

    it.each(['generating', 'done', 'error'])('returns reported usage during %s even with production diagnostics disabled', async phase => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'false')
        const collector = createProviderTokenUsageCollector()
        collector.record({ id: 'usage-call', model: diagnostic.model, usage: extractApiTokenUsage(diagnostic.response) })
        const snapshot = collector.snapshot()
        const row = job(phase)
        mocks.findUnique.mockResolvedValue({ ...row, result: { ...row.result, tokenUsage: snapshot.tokenUsage, himodelsUsageCalls: snapshot.tokenUsageCalls } })

        const payload = await (await GET(request(), context())).json()

        expect(payload.data).not.toHaveProperty('himodelsResponses')
        expect(payload.data.tokenUsage).toMatchObject({ inputTokens: 12, outputTokens: 34, totalTokens: 46, source: 'himodels', complete: true })
        expect(payload.data.himodelsUsageCalls).toHaveLength(1)
    })

    it('returns direct-provider usage saved with the outline job', async () => {
        const collector = createProviderTokenUsageCollector()
        collector.record({
            id: 'gemini-usage-call',
            provider: 'gemini',
            model: 'gemini:gemini-3.7-flash',
            usage: extractApiTokenUsage({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 180 } })
        })
        const row = job()
        mocks.findUnique.mockResolvedValue({ ...row, result: { ...row.result, ...collector.snapshot() } })

        const payload = await (await GET(request(), context())).json()

        expect(payload.data.tokenUsage).toMatchObject({ source: 'gemini', providers: ['gemini'], inputTokens: 120, outputTokens: 30, totalTokens: 180 })
        expect(payload.data.tokenUsageCalls).toHaveLength(1)
        expect(payload.data.himodelsUsageCalls).toEqual([])
    })

    it('rejects a non-owner without exposing the provider response', async () => {
        mocks.findUnique.mockResolvedValue(job())
        mocks.assertProjectOwner.mockResolvedValue(new Response('forbidden', { status: 403 }))

        const response = await GET(request(), context())

        expect(response.status).toBe(403)
        expect(await response.text()).not.toContain('provider-call-1')
    })

    it('requires authentication before accessing stored diagnostics', async () => {
        mocks.currentUserId.mockReturnValue(null)

        const response = await GET(request(), context())

        expect(response.status).toBe(401)
        expect(mocks.findUnique).not.toHaveBeenCalled()
    })

    it('lets the project owner cancel an active outline job and releases its active lease', async () => {
        mocks.findUnique.mockResolvedValue(job('generating'))

        const response = await DELETE(request(), context())
        const payload = await response.json()

        expect(response.status).toBe(200)
        expect(mocks.assertProjectOwner).toHaveBeenCalledWith(789n, 123n)
        expect(mocks.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 456n, projectId: 789n, phase: { in: ['generating', 'filling', 'writing_db'] } },
                data: expect.objectContaining({ phase: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null })
            })
        )
        expect(mocks.releaseModelReservations).toHaveBeenCalledWith('job:456')
        expect(payload.data.cancelled).toBe(true)
    })

    it('does not let a non-owner cancel an outline job', async () => {
        mocks.findUnique.mockResolvedValue(job('generating'))
        mocks.assertProjectOwner.mockResolvedValue(new Response('forbidden', { status: 403 }))

        const response = await DELETE(request(), context())

        expect(response.status).toBe(403)
        expect(mocks.updateMany).not.toHaveBeenCalled()
    })
})
