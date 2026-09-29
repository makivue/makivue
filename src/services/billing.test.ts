import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import {
    BillingError,
    DEFAULT_BILLING_POINT_RATES,
    NEW_USER_BONUS_POINTS,
    RECHARGE_TIERS_USD,
    estimateTextTokens,
    fallbackVideoCostUsd,
    grantNewUserBonus,
    getCountryRechargeTiers,
    quoteGenerationCostUsd,
    quoteGenerationPoints,
    quoteLlmTokenPoints,
    validateRechargeRequest,
    walletBillingEnabled
} from './billing'

const walletMocks = vi.hoisted(() => ({
    accountUpsert: vi.fn(),
    accountUpdate: vi.fn(),
    transactionFindUnique: vi.fn(),
    transactionCreate: vi.fn(),
    transaction: vi.fn()
}))

vi.mock('./fx-rates', () => ({ getFxRate: vi.fn(async (currency: string) => (currency === 'NGN' ? 1_323_440_030 : 1_000_000)) }))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        countryRechargeSku: {
            findMany: vi.fn().mockResolvedValue([])
        },
        walletAccount: {
            upsert: walletMocks.accountUpsert,
            update: walletMocks.accountUpdate
        },
        walletTransaction: {
            findUnique: walletMocks.transactionFindUnique,
            create: walletMocks.transactionCreate
        },
        $transaction: walletMocks.transaction
    }
}))

const walletTransaction = (userId: bigint, balanceAfterPoints: number) => ({ userId, balanceAfterPoints })

describe('new-user wallet bonus', () => {
    beforeEach(() => {
        for (const mock of Object.values(walletMocks)) mock.mockReset()
        walletMocks.transactionFindUnique.mockResolvedValue(null)
        walletMocks.accountUpdate.mockResolvedValue({ balancePoints: NEW_USER_BONUS_POINTS })
        walletMocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
            callback({
                walletAccount: { upsert: walletMocks.accountUpsert, update: walletMocks.accountUpdate },
                walletTransaction: { findUnique: walletMocks.transactionFindUnique, create: walletMocks.transactionCreate }
            })
        )
    })
    afterEach(() => vi.clearAllMocks())

    it('credits 3000 coins and records an idempotent bonus ledger entry', async () => {
        await expect(grantNewUserBonus(42n)).resolves.toMatchObject({ granted: true, balancePoints: NEW_USER_BONUS_POINTS })
        expect(walletMocks.accountUpsert).toHaveBeenCalledWith({ where: { userId: 42n }, update: {}, create: expect.objectContaining({ userId: 42n }) })
        expect(walletMocks.accountUpdate).toHaveBeenCalledWith({ where: { userId: 42n }, data: { balancePoints: { increment: NEW_USER_BONUS_POINTS } } })
        expect(walletMocks.transactionCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: 42n,
                type: 'bonus',
                amountPoints: NEW_USER_BONUS_POINTS,
                sourceType: 'welcome_bonus',
                idempotencyKey: 'welcome-bonus:42'
            })
        })
        expect(walletMocks.transaction).toHaveBeenCalledWith(expect.any(Function), BILLING_TRANSACTION_OPTIONS)
    })

    it('does not credit the wallet again when the bonus ledger already exists', async () => {
        walletMocks.transactionFindUnique.mockResolvedValue(walletTransaction(42n, NEW_USER_BONUS_POINTS))

        await expect(grantNewUserBonus(42n)).resolves.toEqual({ granted: false, balancePoints: NEW_USER_BONUS_POINTS })
        expect(walletMocks.transaction).not.toHaveBeenCalled()
        expect(walletMocks.accountUpdate).not.toHaveBeenCalled()
    })

    it('preserves existing coins and paid top-ups when crediting a missing welcome bonus', async () => {
        walletMocks.accountUpdate.mockResolvedValue({ balancePoints: 8_000 })

        await expect(grantNewUserBonus(42n)).resolves.toEqual({ granted: true, balancePoints: 8_000 })

        expect(walletMocks.accountUpdate).toHaveBeenCalledWith({ where: { userId: 42n }, data: { balancePoints: { increment: 3_000 } } })
        expect(walletMocks.transactionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ amountPoints: 3_000, balanceAfterPoints: 8_000 }) })
    })

    it('skips the credit if another login records the bonus before the transaction check', async () => {
        walletMocks.transactionFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(walletTransaction(42n, 3_000))

        await expect(grantNewUserBonus(42n)).resolves.toEqual({ granted: false, balancePoints: 3_000 })

        expect(walletMocks.accountUpdate).not.toHaveBeenCalled()
        expect(walletMocks.transactionCreate).not.toHaveBeenCalled()
    })

    it('recognizes a concurrent successful bonus after a unique-key conflict rolls back', async () => {
        walletMocks.transactionFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(walletTransaction(42n, 3_000))
        walletMocks.transactionCreate.mockRejectedValueOnce({ code: 'P2002' })

        await expect(grantNewUserBonus(42n)).resolves.toEqual({ granted: false, balancePoints: 3_000 })

        expect(walletMocks.transaction).toHaveBeenCalledOnce()
        expect(walletMocks.transactionCreate).toHaveBeenCalledOnce()
    })

    it('propagates a unique-key failure when no successful bonus exists', async () => {
        const error = { code: 'P2002' }
        walletMocks.transactionCreate.mockRejectedValueOnce(error)

        await expect(grantNewUserBonus(42n)).rejects.toBe(error)
    })

    it('can retry a failed ledger write without marking the bonus as completed', async () => {
        const error = new Error('Database unavailable')
        walletMocks.transactionCreate.mockRejectedValueOnce(error)

        await expect(grantNewUserBonus(42n)).rejects.toBe(error)
        await expect(grantNewUserBonus(42n)).resolves.toEqual({ granted: true, balancePoints: 3_000 })
    })

    it('rejects a bonus key associated with a different user', async () => {
        walletMocks.transactionFindUnique.mockResolvedValue(walletTransaction(99n, 3_000))

        await expect(grantNewUserBonus(42n)).rejects.toMatchObject({ status: 409 })
        expect(walletMocks.transaction).not.toHaveBeenCalled()
    })
})

describe('billing rates', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('exposes only the approved recharge tiers', () => {
        expect(RECHARGE_TIERS_USD).toEqual([5, 50, 100, 500, 1000])
    })

    it('does not bill the illustration orchestration record twice', () => {
        expect(quoteGenerationPoints('illustrations', 'banana', 10)).toBe(0)
        expect(quoteGenerationPoints('first_frame', 'banana', 10)).toBe(DEFAULT_BILLING_POINT_RATES.first_frame.flatPoints)
    })

    it.each(['image', 'reference', 'first_frame', 'middle_frame', 'last_frame'])('converts the Seedream price per delivered %s to 40 coins', type => {
        for (const provider of ['seedream-5-0-lite', 'doubao']) {
            expect(quoteGenerationCostUsd(type, provider)).toBe(0.04)
            expect(quoteGenerationPoints(type, provider)).toBe(40)
            expect(quoteGenerationPoints(type, provider, 12)).toBe(40)
        }
        expect(quoteGenerationPoints(type, 'banana')).toBe(5)
    })

    it('keeps Seedream orchestration free and allows explicit price overrides', () => {
        expect(quoteGenerationPoints('illustrations', 'seedream-5-0-lite')).toBe(0)
        vi.stubEnv('BILLING_POINT_RATE_OVERRIDES_JSON', JSON.stringify({ 'image:seedream-5-0-lite': { flatPoints: 24 } }))
        expect(quoteGenerationPoints('image', 'seedream-5-0-lite')).toBe(24)
        expect(quoteGenerationPoints('image', 'doubao')).toBe(24)
        expect(quoteGenerationCostUsd('image', 'seedream-5-0-lite')).toBe(0.04)
    })

    it('quotes video directly in points and supports point-rate overrides', () => {
        expect(quoteGenerationPoints('video', 'seedance', 10)).toBe(80)
        expect(quoteGenerationPoints('video_speech_comparison', 'seedance', 10)).toBe(80)
        expect(quoteGenerationPoints('video_speech_comparison', 'wanx', 10)).toBe(120)
        expect(quoteGenerationPoints('video', 'wan3', 10)).toBe(84)
        expect(quoteGenerationPoints('video', 'wan3prime', 10)).toBe(252)
        expect(quoteGenerationPoints('video_comparison', 'kling', 6)).toBe(80)
        expect(quoteGenerationPoints('merge', 'ffmpeg')).toBe(0)
        vi.stubEnv('BILLING_POINT_RATE_OVERRIDES_JSON', JSON.stringify({ 'video:seedance': { perSecondPoints: 10 } }))
        expect(quoteGenerationPoints('video', 'seedance', 10)).toBe(100)
        expect(quoteGenerationPoints('video_speech_comparison', 'seedance', 10)).toBe(100)
    })

    it('keeps provider-cost telemetry separate from wallet point rates', () => {
        vi.stubEnv('BILLING_POINT_RATE_OVERRIDES_JSON', JSON.stringify({ 'video:seedance': { perSecondPoints: 10 } }))
        vi.stubEnv('PRODUCTION_COST_RATES_JSON', JSON.stringify({ 'video:seedance': { perSecondUsd: 0.03 } }))
        expect(quoteGenerationPoints('video', 'seedance', 10)).toBe(100)
        expect(quoteGenerationCostUsd('video', 'seedance', 10)).toBe(0.3)
    })

    it('uses the measured delivered duration only for per-second video pricing', () => {
        const entry = {
            price: { kind: 'video_seconds' as const, second: 0.42, usdPerCurrency: 1 / 7, version: 'test', source: 'test', currency: 'CNY' as const },
            meter: { inputVideoSeconds: 3, inputImages: 0 }
        }
        expect(fallbackVideoCostUsd(entry, 8)).toBe(0.66)
        expect(fallbackVideoCostUsd({ ...entry, price: { ...entry.price, kind: 'video_tokens' as const } }, 8)).toBeNull()
        expect(fallbackVideoCostUsd(entry, 0)).toBeNull()
    })

    it('rounds each complete generation quote up to whole coins', () => {
        expect(quoteGenerationPoints('video', 'wan3', 6)).toBe(51)
        expect(quoteGenerationPoints('video', 'wan3prime', 6)).toBe(152)
        expect(quoteGenerationPoints('compose', 'ffmpeg')).toBe(0)
        vi.stubEnv('BILLING_POINT_RATE_OVERRIDES_JSON', JSON.stringify({ 'video:wan3': { perSecondPoints: 115.5175 } }))
        expect(quoteGenerationPoints('video', 'wan3', 10)).toBe(1156)
    })

    it('keeps rate precision and adds components before rounding', () => {
        vi.stubEnv('BILLING_POINT_RATE_OVERRIDES_JSON', JSON.stringify({ compose: { flatPoints: 0.3, perSecondPoints: 0.07 }, image: { flatPoints: 1.00001 } }))
        expect(quoteGenerationPoints('compose', 'ffmpeg', 10)).toBe(1)
        expect(quoteGenerationPoints('image', 'banana')).toBe(2)
        expect(quoteLlmTokenPoints(6_000, 1_500)).toBe(3)
    })

    it('does not add a coin because of binary floating-point multiplication', () => {
        vi.stubEnv('BILLING_POINT_RATE_OVERRIDES_JSON', JSON.stringify({ 'video:seedance': { perSecondPoints: 0.07 } }))
        expect(quoteGenerationPoints('video', 'seedance', 100)).toBe(7)
    })

    it('accepts only fixed recharge amounts with a reusable idempotency format', () => {
        expect(validateRechargeRequest(5, 'wallet:test-123456')).toBe(5)
        expect(validateRechargeRequest(500, 'wallet:test-123456')).toBe(500)
        expect(() => validateRechargeRequest(25, 'wallet:test-123456')).toThrow(BillingError)
        expect(() => validateRechargeRequest(10_000, 'wallet:test-123456')).toThrow(BillingError)
        expect(() => validateRechargeRequest(50, 'short')).toThrow(BillingError)
    })

    it('estimates CJK and Latin token usage and applies the minimum charge', () => {
        expect(estimateTextTokens('短剧生成')).toBe(4)
        expect(estimateTextTokens('short drama')).toBeGreaterThanOrEqual(2)
        expect(quoteLlmTokenPoints(100, 100)).toBe(1)
    })

    it('enables wallet billing by default and keeps an emergency bypass', () => {
        vi.stubEnv('WALLET_BILLING_ENABLED', '')
        expect(walletBillingEnabled()).toBe(false)
        vi.stubEnv('WALLET_BILLING_ENABLED', 'false')
        expect(walletBillingEnabled()).toBe(false)
        vi.stubEnv('WALLET_BILLING_ENABLED', 'true')
        expect(walletBillingEnabled()).toBe(false)
    })
})

describe('country recharge tiers', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('offers five canonical tiers with no configured labels', async () => {
        const tiers = await getCountryRechargeTiers('US')
        expect(tiers.map(tier => tier.amountUsdCents)).toEqual([500, 5000, 10000, 50000, 100000])
        expect(tiers.map(tier => tier.points)).toEqual([5000, 50000, 100000, 500000, 1000000])
        expect(tiers.every(tier => tier.label === null)).toBe(true)
    })

    it('uses the actual exchange rate and identical coin credits for Nigeria', async () => {
        const tiers = await getCountryRechargeTiers('NG')
        expect(tiers[0]).toMatchObject({ amountUsdCents: 500, amountLocalCents: 661721, currency: 'NGN', points: 5000 })
        expect(tiers[4].points).toBe(1000000)
    })

    it('uses database rows only for labels and preserves the required amounts', async () => {
        vi.mocked(prisma.countryRechargeSku.findMany).mockResolvedValueOnce([
            { amountUsdCents: 500, points: 3, label: 'Starter' },
            { amountUsdCents: 30000, points: 999999, label: null }
        ] as never)
        const tiers = await getCountryRechargeTiers('US')
        expect(tiers).toHaveLength(5)
        expect(tiers[0]).toMatchObject({ points: 5000, label: 'Starter' })
        expect(tiers.some(t => t.amountUsdCents === 30000)).toBe(false)
    })

    it('still offers recharge if merchandising rows are unavailable', async () => {
        vi.mocked(prisma.countryRechargeSku.findMany).mockRejectedValueOnce(new Error('unavailable'))
        expect(await getCountryRechargeTiers('US')).toHaveLength(5)
    })
})
