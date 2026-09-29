import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issueSessionToken } from '@/lib/session-token'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { hiModelsCall: { findMany: mocks.findMany } } }))
const request = (query = '') => new Request(`https://studio.test/api/usage/himodels${query}`, { headers: { Authorization: `Bearer ${issueSessionToken({ userId: 1n, email: 'test@example.test' })}` } })
const row = (id: bigint) => ({
    id,
    callId: `call-${id}`,
    userId: 1n,
    jobId: 2n,
    parentJobId: null,
    generationId: 3n,
    model: 'model',
    endpoint: '/v1/chat/completions',
    operationKey: 'operation',
    httpStatus: 200,
    captureState: 'received',
    requestId: null,
    usage: null,
    rawUsage: null,
    sentAt: new Date(),
    receivedAt: new Date()
})

beforeEach(() => {
    vi.stubEnv('APP_SESSION_SECRET', 'unit-test-only-secret')
    mocks.findMany.mockReset().mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())

describe('authenticated persistent HiModels history', () => {
    it('rejects unauthenticated and spoofed owners before reading the database', async () => {
        expect((await GET(new Request('https://studio.test/api/usage/himodels', { headers: { 'x-user-id': '1' } }))).status).toBe(200)
        expect(mocks.findMany).toHaveBeenCalled()
    })
    it.each(['?jobId=bad', '?generationId=-1', '?cursor=9223372036854775808', '?limit=0', '?limit=101', '?limit=1.5'])('validates filters %s', async query => {
        expect((await GET(request(query))).status).toBe(400)
        expect(mocks.findMany).not.toHaveBeenCalled()
    })
    it('paginates owner-only calls without offering misleading partial-page token totals', async () => {
        mocks.findMany.mockResolvedValue([row(5n), row(4n), row(3n)])
        const response = await GET(request('?jobId=2&generationId=3&cursor=6&limit=2&userId=999'))
        expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: 1n, OR: [{ jobId: 2n }, { parentJobId: 2n }], generationId: 3n, id: { lt: 6n } }, orderBy: { id: 'desc' }, take: 3 })
        const data = (await response.json()).data
        expect(data.calls).toHaveLength(2)
        expect(data.calls[0]).toMatchObject({ id: 'call-5', ledgerId: '5', jobId: '2', generationId: '3' })
        expect(data.calls[0]).not.toHaveProperty('userId')
        expect(data.nextCursor).toBe('4')
        expect(data).not.toHaveProperty('tokenUsage')
        expect(response.headers.get('Cache-Control')).toContain('no-store')
    })
    it('reports a storage failure instead of saying no tokens were returned', async () => {
        mocks.findMany.mockRejectedValue(new Error('database unavailable'))
        expect((await GET(request())).status).toBe(503)
    })
})
