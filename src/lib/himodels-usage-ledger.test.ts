import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiModelsCall } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'
import { extractApiTokenUsage } from './api-token-usage'
import { currentHiModelsUsageScope, withHiModelsUsageScope } from './himodels-usage-context.server'
import { finishHiModelsUsage, hiModelsOperationKey, readHiModelsGenerationUsage, readHiModelsUsage, startHiModelsUsage, summarizeHiModelsCalls } from './himodels-usage-ledger.server'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), findMany: vi.fn() }))
vi.mock('./prisma', () => ({ prisma: { hiModelsCall: mocks } }))
vi.mock('./id', () => ({ genId: () => 123n }))

const usage = extractApiTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })!
const call = { id: 'test-call', model: 'gemini-3.7-flash', endpoint: '/v1/chat/completions', operationKey: 'operation', sentAt: '2026-09-07T00:00:00.000Z', usage }
const row = (patch: Partial<HiModelsCall> = {}): HiModelsCall => ({
    id: 123n,
    callId: call.id,
    userId: 1n,
    jobId: 2n,
    parentJobId: null,
    generationId: null,
    provider: 'himodels',
    model: call.model,
    endpoint: call.endpoint,
    operationKey: call.operationKey,
    httpStatus: 200,
    captureState: 'received',
    requestId: 'upstream-id',
    usage,
    rawUsage: { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    sentAt: new Date(call.sentAt),
    receivedAt: new Date('2026-09-07T00:00:01Z'),
    ...patch
})

beforeEach(() => {
    vi.resetAllMocks()
    mocks.create.mockResolvedValue({})
    mocks.update.mockResolvedValue({})
    mocks.findMany.mockResolvedValue([])
})

describe('durable HiModels usage ledger', () => {
    it('binds owner, job, parent and generation before dispatch', async () => {
        await withHiModelsUsageScope({ userId: 1n, jobId: '2' }, () => withHiModelsUsageScope({ jobId: '3', generationId: '4' }, () => startHiModelsUsage(call, 1n)))
        expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ userId: 1n, jobId: 3n, parentJobId: 2n, generationId: 4n, captureState: 'pending' }) })
        expect(currentHiModelsUsageScope()).toBeUndefined()
    })

    it('isolates simultaneous owners and asynchronous callbacks', async () => {
        const values = await Promise.all(
            [1n, 2n].map(userId =>
                withHiModelsUsageScope({ userId, jobId: String(userId) }, async () => {
                    await Promise.resolve()
                    return currentHiModelsUsageScope()
                })
            )
        )
        expect(values).toEqual([
            { userId: 1n, jobId: '1' },
            { userId: 2n, jobId: '2' }
        ])
        expect(currentHiModelsUsageScope()).toBeUndefined()
    })

    it('fails closed before an authenticated call when the ledger cannot be created', async () => {
        mocks.create.mockRejectedValue(new Error('table missing'))
        await expect(startHiModelsUsage(call, 1n)).rejects.toThrow('尚未调用模型')
        expect(await startHiModelsUsage(call, null)).toBeNull()
        expect(mocks.create).toHaveBeenCalledTimes(1)
    })

    it('reports transient contention without misdiagnosing a missing migration or exposing database details', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('private database details', { code: 'P2028', clientVersion: 'test' }))
        try {
            await expect(startHiModelsUsage(call, 1n)).rejects.toThrow('暂时繁忙，尚未调用模型')
            expect(log).toHaveBeenCalledWith('[Model Usage] Pre-dispatch persistence failed', { callId: call.id, code: 'P2028' })
        } finally {
            log.mockRestore()
        }
    })

    it('retries only response persistence and retains normalized and raw counts', async () => {
        mocks.update.mockRejectedValueOnce(new Error('temporary DB failure')).mockResolvedValue({})
        await finishHiModelsUsage(123n, { ...call, rawUsage: { usageMetadata: { totalTokenCount: 12 } }, status: 200, captureState: 'received' })
        expect(mocks.update).toHaveBeenCalledTimes(2)
        expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: 123n }, data: expect.objectContaining({ usage, rawUsage: { usageMetadata: { totalTokenCount: 12 } }, captureState: 'received' }) })
    })

    it('does not turn response-write failures into provider retries or fake zero usage', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.update.mockRejectedValue(new Error('DB down'))
        await expect(finishHiModelsUsage(123n, call)).resolves.toBeUndefined()
        expect(mocks.update).toHaveBeenCalledTimes(3)
        expect(error).toHaveBeenCalledWith(expect.stringContaining('remains incomplete'))
        expect(summarizeHiModelsCalls([row({ usage: null, captureState: 'pending', receivedAt: null })]).tokenUsage).toMatchObject({ totalTokens: null, incompleteCaptureCalls: 1, complete: false })
        error.mockRestore()
    })

    it('never reads another owner and includes batch child jobs', async () => {
        mocks.findMany.mockResolvedValue([row()])
        expect((await readHiModelsUsage(1n, { jobId: '2' })).tokenUsage).toMatchObject({ totalTokens: 12 })
        expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: 1n, OR: [{ jobId: 2n }, { parentJobId: 2n }] }, orderBy: { id: 'asc' } })
        await readHiModelsUsage(1n, { generationId: '4' })
        expect(mocks.findMany).toHaveBeenLastCalledWith({ where: { userId: 1n, generationId: 4n }, orderBy: { id: 'asc' } })
        mocks.findMany.mockRejectedValue(new Error('DB down'))
        expect(await readHiModelsUsage(1n, { jobId: '2' })).toEqual({ tokenUsage: null, tokenUsageCalls: [], himodelsUsageCalls: [], usageTrackingAvailable: false })
    })

    it('loads an episode in one query, separately from legacy final-result JSON', async () => {
        mocks.findMany.mockResolvedValue([row({ generationId: 4n }), row({ id: 124n, callId: 'other-call', generationId: 5n })])
        const result = await readHiModelsGenerationUsage(1n, [4n, 5n])
        expect(mocks.findMany).toHaveBeenCalledTimes(1)
        expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: 1n, generationId: { in: [4n, 5n] } }, orderBy: { id: 'asc' } })
        expect(result.get('4')?.tokenUsage?.totalTokens).toBe(12)
        expect(result.get('5')?.tokenUsage?.totalTokens).toBe(12)
    })
})

describe('HiModels operation identity', () => {
    const base = 'https://himodels.test/v1'
    it('deduplicates image replays even when only the later response has a provider ID', () => {
        const init = { headers: { 'Idempotency-Key': 'image-one' } }
        const first = hiModelsOperationKey(`${base}/images/generations`, init, 'call-1')
        expect(hiModelsOperationKey(`${base}/images/generations`, init, 'call-2', { id: 'image-result' })).toBe(first)
        expect(hiModelsOperationKey(`${base}/images/generations`, { headers: { 'Idempotency-Key': 'image-two' } }, 'call-3')).not.toBe(first)
    })
    it('groups video submission and encoded task polls but keeps separate text attempts', () => {
        const submitted = hiModelsOperationKey(`${base}/video/generations`, { method: 'POST' }, 'submit', { name: 'operations/task-one' })
        expect(hiModelsOperationKey(`${base}/video/generations/operations%2Ftask-one`, {}, 'poll-1')).toBe(submitted)
        expect(hiModelsOperationKey(`${base}/video/generations/operations%2Ftask-two`, {}, 'poll-2')).not.toBe(submitted)
        expect(hiModelsOperationKey(`${base}/chat/completions`, {}, 'text-1')).not.toBe(hiModelsOperationKey(`${base}/chat/completions`, {}, 'text-2'))
    })
})
