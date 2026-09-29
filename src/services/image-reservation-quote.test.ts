import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateAffordableBatch, quoteImageGenerationReservationPoints } from './image-reservation-quote'

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('reference image batch affordability', () => {
    const items = Array.from({ length: 91 }, (_, index) => ({ id: String(index + 1), reservationPoints: index === 3 ? 1970 : 1969 }))

    it('offers only the page-order prefix covered by the current spendable balance', () => {
        const result = calculateAffordableBatch(items, 11_579)

        expect(result.affordableItems.map(item => item.id)).toEqual(['1', '2', '3', '4', '5'])
        expect(result.affordablePoints).toBe(9_846)
        expect(result.requiredPoints).toBe(179_180)
        expect(result.minimumPoints).toBe(1_969)
    })

    it('returns no items when one reservation cannot be covered', () => {
        const result = calculateAffordableBatch(items, 1_968)

        expect(result.affordableItems).toEqual([])
        expect(result.affordablePoints).toBe(0)
        expect(result.minimumPoints).toBe(1_969)
    })

    it('returns the full batch when the balance covers every reservation', () => {
        const requiredPoints = items.reduce((sum, item) => sum + item.reservationPoints, 0)
        const result = calculateAffordableBatch(items, requiredPoints)

        expect(result.affordableItems).toHaveLength(91)
        expect(result.requiredPoints).toBe(requiredPoints)
    })

    it('uses the same maximum-output reservation pricing as the model dispatcher', async () => {
        vi.stubEnv('MODEL_COST_RATES_JSON', '')
        vi.stubEnv('NANO_BANANA_MODEL', 'gemini-3.1-flash-image')
        vi.stubEnv('NANO_BANANA_LOCATION', 'global')

        const reservationPoints = await quoteImageGenerationReservationPoints({
            provider: 'banana',
            prompt: 'cinematic empty mountain road location reference',
            referenceCount: 0,
            aspectRatio: '16:9',
            quality: 'clear'
        })

        expect(reservationPoints).toBeGreaterThanOrEqual(1_967)
        expect(reservationPoints).toBeLessThan(2_000)
    })

    it('uses the flat delivered-image reservation for Seedream', async () => {
        vi.stubEnv('MODEL_COST_RATES_JSON', '')

        await expect(
            quoteImageGenerationReservationPoints({
                provider: 'seedream-5-0-lite',
                prompt: 'empty parking garage',
                referenceCount: 0,
                aspectRatio: '16:9',
                quality: 'clear'
            })
        ).resolves.toBe(40)
    })
})
