import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { issueSessionToken } from '@/lib/session-token'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), generations: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { walletTransaction: { findMany: mocks.findMany }, generation: { findMany: mocks.generations } } }))

function request(query = '', authenticated = true) {
    const headers = authenticated ? { Authorization: `Bearer ${issueSessionToken({ userId: 7n, email: 'wallet@example.test' })}` } : undefined
    return new NextRequest(`https://studio.test/api/wallet/transactions${query}`, { headers })
}

function row(id: bigint, createdAt: Date) {
    return {
        id,
        userId: 7n,
        type: 'usage',
        amountPoints: -12.2,
        balanceAfterPoints: 987.9,
        status: 'completed',
        sourceType: 'generation',
        sourceId: id.toString(),
        idempotencyKey: `usage-${id}`,
        description: '测试消费',
        metadata: null,
        createdAt
    }
}

beforeEach(() => {
    vi.stubEnv('APP_SESSION_SECRET', 'wallet-transaction-route-test-secret')
    mocks.findMany.mockReset().mockResolvedValue([])
    mocks.generations.mockReset().mockResolvedValue([])
})

afterEach(() => vi.unstubAllEnvs())

describe('wallet transaction history', () => {
    it('requires an authenticated application session', async () => {
        expect((await GET(request('', false))).status).toBe(401)
        expect(mocks.findMany).not.toHaveBeenCalled()
    })

    it('rejects malformed cursors before querying the database', async () => {
        expect((await GET(request('?cursor=not-a-cursor'))).status).toBe(400)
        expect(mocks.findMany).not.toHaveBeenCalled()
    })

    it('includes the resolved destination in the API response', async () => {
        mocks.findMany.mockResolvedValue([row(50n, new Date('2026-09-18T00:00:00Z'))])
        mocks.generations.mockResolvedValue([{ id: 50n, storyboard: { id: 30n, episode: { id: 20n, projectId: 10n } } }])
        const response = await GET(request())
        expect((await response.json()).data.transactions[0].destinationPath).toBe('/projects/10/episodes/20#shot-30')
    })

    it('returns 30 rows and a stable time-and-id cursor for the next page', async () => {
        const createdAt = new Date('2026-09-16T10:00:00.123Z')
        mocks.findMany.mockResolvedValue(Array.from({ length: 31 }, (_, index) => row(BigInt(100 - index), createdAt)))

        const response = await GET(request())
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.transactions).toHaveLength(30)
        expect(body.data.transactions[0]).toMatchObject({ id: '100', amountPoints: -13, balanceAfterPoints: 987 })
        expect(body.data.nextCursor).toEqual(expect.any(String))
        expect(mocks.findMany).toHaveBeenCalledWith({
            where: { userId: 7n },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 31
        })

        mocks.findMany.mockReset().mockResolvedValue([])
        await GET(request(`?cursor=${encodeURIComponent(body.data.nextCursor)}`))
        expect(mocks.findMany).toHaveBeenCalledWith({
            where: {
                userId: 7n,
                OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 71n } }]
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 31
        })
    })
})
