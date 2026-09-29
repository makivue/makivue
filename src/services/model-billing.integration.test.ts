import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { reserveModelPoints, releaseModelReservations, recoverTerminalModelReservations } from './wallet-reservations'
import { chargeModelUsage, chargeLlmUsage } from './billing'
import { updateJob } from '@/lib/projectAiJobStore'
import { meterModelRequest, resolveModelPrice } from '@/lib/model-pricing'
import { startHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { fetchMeteredProvider } from '@/lib/provider-token-usage.server'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'

// Isolated ephemeral IDs: this test must not share a Sonyflake worker with services.
vi.mock('@/lib/id', () => ({ genId: () => BigInt(`0x${randomBytes(8).toString('hex')}`) & ((1n << 63n) - 1n) }))

const enabled = process.env.BILLING_DB_INTEGRATION === 'true'
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
const userId = BigInt(`0x${randomBytes(8).toString('hex')}`) & ((1n << 63n) - 1n)
const jobId = userId.toString()
const scopeKey = `job:${jobId}`
const charge = { userId, scopeKey, idempotencyKey: `usage:test:${userId}`, sourceType: 'billing_test', sourceId: jobId, description: 'Temporary integration test' }
let created = false

describe.skipIf(!enabled)('wallet reservations against shared test MariaDB', () => {
    beforeAll(async () => {
        const url = new URL(process.env.DATABASE_URL ?? '')
        if (!url.hostname.includes('-test.') || process.env.APP_ENV !== 'test') throw new Error('Billing integration tests require the explicit test database')
        await prisma.walletAccount.create({ data: { id: userId, userId, balancePoints: 100 } })
        created = true
    })
    beforeEach(async () => {
        await prisma.projectAiJob.deleteMany({ where: { id: userId } })
        await prisma.walletTransaction.deleteMany({ where: { userId } })
        await prisma.walletReservation.deleteMany({ where: { userId } })
        await prisma.hiModelsCall.deleteMany({ where: { userId } })
        await prisma.walletAccount.update({ where: { userId }, data: { balancePoints: 100, lifetimeSpentPoints: 0 } })
    })
    afterAll(async () => {
        if (!created) return
        await prisma.projectAiJob.deleteMany({ where: { id: userId } })
        await prisma.walletTransaction.deleteMany({ where: { userId } })
        await prisma.walletReservation.deleteMany({ where: { userId } })
        await prisma.hiModelsCall.deleteMany({ where: { userId } })
        await prisma.walletAccount.delete({ where: { userId } })
    })
    async function balance() {
        return Number((await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balancePoints)
    }
    async function cost(key: string, usd: number | null) {
        const meter = meterModelRequest({ prompt: 'fixture' })
        const price = resolveModelPrice('himodels', 'gemini-3.7-flash', meter, 'https://api.himodels.ai/v1/chat/completions')!
        const callId = randomUUID()
        await prisma.hiModelsCall.create({
            data: {
                id: BigInt(`0x${randomBytes(8).toString('hex')}`) & ((1n << 63n) - 1n),
                callId,
                userId,
                jobId: userId,
                model: 'gemini-3.7-flash',
                endpoint: '/test',
                operationKey: callId,
                captureState: 'received',
                httpStatus: 200,
                billing: { scopeKey, reservationKey: key, meter, price, state: usd === null ? 'missing_usage' : 'priced', costUsd: usd }
            }
        })
    }
    it('keeps media result settlement atomic when result bookkeeping exceeds five seconds', async () => {
        await reserveModelPoints(userId, scopeKey, `media:${userId}`, 20)
        await cost(`media:${userId}`, 0.0131)
        await prisma.$transaction(async tx => {
            await chargeModelUsage({ ...charge, tx })
            await new Promise(resolve => setTimeout(resolve, 5500))
            expect(await tx.walletTransaction.count({ where: { userId } })).toBe(1)
        }, BILLING_TRANSACTION_OPTIONS)
        expect(await balance()).toBe(86)
        expect(await prisma.walletReservation.count({ where: { userId, status: 'reserved' } })).toBe(0)
    })
    it('admits only one concurrent request against the last available coins', async () => {
        await prisma.walletAccount.update({ where: { userId }, data: { balancePoints: 20 } })
        const results = await Promise.allSettled([reserveModelPoints(userId, scopeKey, `a:${userId}`, 13), reserveModelPoints(userId, scopeKey, `b:${userId}`, 13)])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        expect(await balance()).toBe(7)
        await Promise.all([releaseModelReservations(scopeKey, userId), releaseModelReservations(scopeKey, userId)])
        expect(await balance()).toBe(20)
    })
    it('reserves an idempotent attempt only once', async () => {
        await Promise.all([reserveModelPoints(userId, scopeKey, `a:${userId}`, 40), reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)])
        expect(await balance()).toBe(60)
    })
    it("admits a funded batch after wallet contention exceeds Prisma's old five-second deadline", async () => {
        const meter = meterModelRequest({ prompt: 'fixture' })
        const price = resolveModelPrice('himodels', 'gemini-3.7-flash', meter, 'https://api.himodels.ai/v1/chat/completions')!
        let locked!: () => void
        let unlock!: () => void
        const lockAcquired = new Promise<void>(resolve => {
            locked = resolve
        })
        const releaseLock = new Promise<void>(resolve => {
            unlock = resolve
        })
        const holder = prisma.$transaction(
            async tx => {
                await tx.walletAccount.update({ where: { userId }, data: { balancePoints: { increment: 0 } } })
                locked()
                await releaseLock
            },
            { timeout: 20_000, maxWait: 10_000 }
        )
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([lockAcquired, holder])
            const admissions = Array.from({ length: 6 }, (_, i) =>
                withHiModelsUsageScope({ userId, jobId }, () =>
                    startHiModelsUsage(
                        {
                            id: randomUUID(),
                            model: 'gemini-3.7-flash',
                            endpoint: '/test',
                            operationKey: randomUUID(),
                            sentAt: new Date().toISOString(),
                            usage: null,
                            billing: { scopeKey, reservationKey: `queued:${userId}:${i}`, meter, price, state: 'pending', costUsd: null }
                        },
                        userId,
                        10
                    )
                )
            )
            timer = setTimeout(unlock, 6_000)
            const results = await Promise.allSettled(admissions)
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(6)
            expect(await balance()).toBe(40)
            expect(await prisma.hiModelsCall.count({ where: { userId } })).toBe(6)
            expect(await prisma.walletReservation.count({ where: { userId, status: 'reserved' } })).toBe(6)
        } finally {
            if (timer) clearTimeout(timer)
            unlock()
            await holder
        }
        await releaseModelReservations(scopeKey, userId)
        expect(await balance()).toBe(100)
    })
    it('settles real costs and releases excess budget exactly once under concurrent completion', async () => {
        await reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)
        await reserveModelPoints(userId, scopeKey, `b:${userId}`, 10)
        await cost(`a:${userId}`, 0.03438)
        await cost(`a:${userId}`, 0.03438) // repeated poll, same paid operation
        await cost(`b:${userId}`, 0.001)
        await Promise.all([chargeModelUsage(charge), chargeModelUsage(charge)])
        expect(await balance()).toBe(64)
        const rows = await prisma.walletTransaction.findMany({ where: { userId } })
        expect(rows).toHaveLength(1)
        expect(Number(rows[0].amountPoints)).toBe(-36)
        expect(Number((await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).lifetimeSpentPoints)).toBe(36)
        await releaseModelReservations(scopeKey, userId)
        expect(await balance()).toBe(64)
    })
    it('does not invent a charge when the supplier omitted usage', async () => {
        await reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)
        await cost(`a:${userId}`, null)
        await expect(chargeModelUsage(charge)).rejects.toMatchObject({ status: 503 })
        expect(await balance()).toBe(60)
        expect(await prisma.walletTransaction.count({ where: { userId } })).toBe(0)
        await releaseModelReservations(scopeKey, userId)
        expect(await balance()).toBe(100)
    })
    it('settles a delivered image once after an optional inspection loses its response', async () => {
        await reserveModelPoints(userId, scopeKey, `image:${userId}`, 40)
        await cost(`image:${userId}`, 0.025)
        const failure = new Error('optional inspection timed out')
        await expect(
            withHiModelsUsageScope({ userId, jobId }, () =>
                fetchMeteredProvider(
                    'https://aiplatform.googleapis.com/v1/projects/test/locations/global/publishers/google/models/gemini-2.5-pro:generateContent',
                    { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'inspect image' }] }], generationConfig: { maxOutputTokens: 100 } }) },
                    { provider: 'gemini', model: 'gemini:gemini-2.5-pro', fetchImpl: vi.fn().mockRejectedValue(failure) }
                )
            )
        ).rejects.toBe(failure)
        const failed = await prisma.hiModelsCall.findFirstOrThrow({ where: { userId, captureState: 'network_error' } })
        expect(failed.billing).toMatchObject({ state: 'failed', costUsd: null })
        await chargeModelUsage(charge)
        await chargeModelUsage(charge)
        expect(await balance()).toBe(75)
        expect(await prisma.walletTransaction.count({ where: { userId } })).toBe(1)
        expect(await prisma.walletReservation.count({ where: { userId, status: 'reserved' } })).toBe(0)
    })
    it('settles once when two result transactions already hold older read snapshots', async () => {
        await reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)
        await cost(`a:${userId}`, 0.025)
        let snapshots = 0
        let ready!: () => void
        const bothReady = new Promise<void>(resolve => {
            ready = resolve
        })
        const complete = () =>
            prisma.$transaction(
                async tx => {
                    await tx.walletTransaction.findMany({ where: { userId } })
                    if (++snapshots === 2) ready()
                    await bothReady
                    await chargeModelUsage({ ...charge, tx })
                },
                { timeout: 30_000, maxWait: 30_000 }
            )
        await Promise.all([complete(), complete()])
        expect(await balance()).toBe(75)
        expect(await prisma.walletTransaction.count({ where: { userId } })).toBe(1)
        expect(Number((await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).lifetimeSpentPoints)).toBe(25)
    })
    it('rolls back the charge with a failed result write', async () => {
        await reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)
        await cost(`a:${userId}`, 0.025)
        await expect(
            prisma.$transaction(async tx => {
                await chargeModelUsage({ ...charge, tx })
                throw new Error('result write failed')
            })
        ).rejects.toThrow('result write failed')
        expect(await balance()).toBe(60)
        expect(await prisma.walletTransaction.count({ where: { userId } })).toBe(0)
        await releaseModelReservations(scopeKey, userId)
        expect(await balance()).toBe(100)
    })
    it('rolls back a reservation when the pre-dispatch ledger insert fails', async () => {
        const meter = meterModelRequest({ prompt: 'fixture' })
        const price = resolveModelPrice('himodels', 'gemini-3.7-flash', meter, 'https://api.himodels.ai/v1/chat/completions')!
        const call = {
            id: randomUUID(),
            model: 'gemini-3.7-flash',
            endpoint: '/test',
            operationKey: randomUUID(),
            sentAt: new Date().toISOString(),
            usage: null,
            billing: { scopeKey, reservationKey: `atomic:${userId}`, meter, price, state: 'pending' as const, costUsd: null }
        }
        await withHiModelsUsageScope({ userId, jobId }, () => startHiModelsUsage(call, userId, 30))
        expect(await balance()).toBe(70)
        const duplicateCall = { ...call, billing: { ...call.billing, reservationKey: `rollback:${userId}` } }
        await expect(withHiModelsUsageScope({ userId, jobId }, () => startHiModelsUsage(duplicateCall, userId, 25))).rejects.toMatchObject({ status: 503 })
        expect(await balance()).toBe(70)
        expect(await prisma.walletReservation.count({ where: { userId } })).toBe(1)
    })

    it('rolls back job delivery when metered LLM settlement fails', async () => {
        await prisma.projectAiJob.create({ data: { id: userId, projectId: userId, kind: 'story_directions', phase: 'generating' } })
        await reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)
        await cost(`a:${userId}`, null)
        await expect(
            prisma.$transaction(async tx => {
                await updateJob(jobId, { phase: 'done', result: { text: 'fixture' } }, tx)
                await chargeLlmUsage({ userId, jobId, task: 'fixture', input: '', output: 'fixture', tx })
            })
        ).rejects.toMatchObject({ status: 503 })
        expect((await prisma.projectAiJob.findUniqueOrThrow({ where: { id: userId } })).phase).toBe('generating')
        expect(await balance()).toBe(60)
        expect(await prisma.walletTransaction.count({ where: { userId } })).toBe(0)
        await prisma.projectAiJob.update({ where: { id: userId }, data: { phase: 'error' } })
        await recoverTerminalModelReservations(userId)
        expect(await balance()).toBe(100)
    })

    it('does not charge a cancelled result and atomically settles a live result', async () => {
        await prisma.projectAiJob.create({ data: { id: userId, projectId: userId, kind: 'story_directions', phase: 'cancelled' } })
        await reserveModelPoints(userId, scopeKey, `a:${userId}`, 40)
        await cost(`a:${userId}`, 0.025)
        const complete = () =>
            prisma.$transaction(async tx => {
                await updateJob(jobId, { phase: 'done', result: { text: 'fixture' } }, tx)
                await chargeLlmUsage({ userId, jobId, task: 'fixture', input: '', output: 'fixture', tx })
            })
        await expect(complete()).rejects.toThrow('任务已取消')
        expect(await prisma.walletTransaction.count({ where: { userId } })).toBe(0)
        expect(await balance()).toBe(60)
        await prisma.projectAiJob.update({ where: { id: userId }, data: { phase: 'generating' } })
        await complete()
        expect(await balance()).toBe(75)
        expect((await prisma.projectAiJob.findUniqueOrThrow({ where: { id: userId } })).phase).toBe('done')
        expect(await prisma.walletReservation.count({ where: { userId, status: 'reserved' } })).toBe(0)
    })
})
