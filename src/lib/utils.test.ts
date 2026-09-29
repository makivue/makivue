import { describe, expect, it } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { apiError, apiErrorWithDetails, apiResponse } from './utils'

describe('JSON API cache policy', () => {
    it.each([apiResponse({ id: '1' }), apiError('failed'), apiErrorWithDetails('failed', 409, { code: 'STALE' })])('prevents mutable API responses from being cached', response => {
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    })
})

describe('decimal media metrics in JSON responses', () => {
    it('keeps media durations and scores numeric without losing monetary precision', async () => {
        const response = apiResponse({
            id: 9007199254740993n,
            trailerDuration: new Prisma.Decimal('12.345678'),
            generations: [{ plannedDuration: new Prisma.Decimal('10.5'), actualDuration: null }],
            merges: [{ duration: new Prisma.Decimal('20.25') }],
            review: { score: new Prisma.Decimal('0') },
            paymentAmountUsd: new Prisma.Decimal('12345678.123456')
        })
        expect((await response.json()).data).toEqual({
            id: '9007199254740993',
            trailerDuration: 12.345678,
            generations: [{ plannedDuration: 10.5, actualDuration: null }],
            merges: [{ duration: 20.25 }],
            review: { score: 0 },
            paymentAmountUsd: '12345678.123456'
        })
    })

    it('preserves existing numbers, strings, null values and timestamps', async () => {
        const response = apiResponse({ score: 'manual', duration: 3.5, trailerDuration: null, createdAt: new Date('2026-09-18T00:00:00Z') })
        expect((await response.json()).data).toEqual({ score: 'manual', duration: 3.5, trailerDuration: null, createdAt: '2026-09-18T00:00:00.000Z' })
    })
})
