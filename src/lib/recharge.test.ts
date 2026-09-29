import { describe, expect, it } from 'vitest'
import { normalizeRechargeAmount, POINTS_PER_USD, RECHARGE_TIERS_USD, usdCentsToPoints, usdToPoints } from './recharge'

describe('wallet recharge amounts', () => {
    it('exposes the requested fixed amounts', () => {
        expect(RECHARGE_TIERS_USD).toEqual([5, 50, 100, 500, 1000])
    })

    it('converts USD credits to whole points by rounding up', () => {
        expect(POINTS_PER_USD).toBe(1_000)
        expect(usdToPoints(1)).toBe(1_000)
        expect(usdToPoints(5)).toBe(5_000)
        expect(usdToPoints(0.005)).toBe(5)
        expect(usdToPoints(0.0000001)).toBe(1)
    })

    it.each([
        [500, 5_000],
        [10_000, 100_000],
        [30_000, 300_000],
        [50_000, 500_000],
        [137, 1_370],
        [318, 3_180]
    ])('converts a %s-cent SKU to %s coins', (cents, coins) => {
        expect(usdCentsToPoints(cents)).toBe(coins)
    })

    it('accepts only the fixed recharge tiers', () => {
        expect(normalizeRechargeAmount('5')).toBe(5)
        expect(normalizeRechargeAmount(100)).toBe(100)
        expect(normalizeRechargeAmount('50')).toBe(50)
        expect(normalizeRechargeAmount(1000)).toBe(1000)
        expect(normalizeRechargeAmount(300)).toBeNull()
        expect(normalizeRechargeAmount(500)).toBe(500)
    })

    it('rejects custom and invalid amounts', () => {
        expect(normalizeRechargeAmount('')).toBeNull()
        expect(normalizeRechargeAmount('4.99')).toBeNull()
        expect(normalizeRechargeAmount('25')).toBeNull()
        expect(normalizeRechargeAmount('10000')).toBeNull()
        expect(normalizeRechargeAmount('not-a-number')).toBeNull()
    })
})
