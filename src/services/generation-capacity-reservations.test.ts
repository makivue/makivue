import { describe, expect, it } from 'vitest'
import { countReservedGenerationCapacity, releaseGenerationCapacityReservation, tryReserveGenerationCapacity, type GenerationCapacityReservations } from '@/lib/generation-capacity-reservations'

describe('generation capacity reservations', () => {
    it('lets only one storyboard reserve the final reported video slot', () => {
        const reservations: GenerationCapacityReservations = new Map()
        const capacity = { available: true, remaining: 1 }

        expect(tryReserveGenerationCapacity({ reservations, reservationId: 'shot-1:video', category: 'video', capacity })).toBe(true)
        expect(tryReserveGenerationCapacity({ reservations, reservationId: 'shot-2:video', category: 'video', capacity })).toBe(false)
        expect(countReservedGenerationCapacity(reservations, 'video')).toBe(1)
    })

    it('releases a reservation after submission or preparation failure', () => {
        const reservations: GenerationCapacityReservations = new Map()
        const capacity = { available: true, remaining: 1 }

        expect(tryReserveGenerationCapacity({ reservations, reservationId: 'shot-1:video', category: 'video', capacity })).toBe(true)
        releaseGenerationCapacityReservation(reservations, 'shot-1:video')
        expect(tryReserveGenerationCapacity({ reservations, reservationId: 'shot-2:video', category: 'video', capacity })).toBe(true)
    })

    it('tracks image and video capacity separately and supports multi-slot requests', () => {
        const reservations: GenerationCapacityReservations = new Map()

        expect(
            tryReserveGenerationCapacity({
                reservations,
                reservationId: 'shot-1:speech-comparison',
                category: 'video',
                capacity: { available: true, remaining: 2 },
                units: 2
            })
        ).toBe(true)
        expect(
            tryReserveGenerationCapacity({
                reservations,
                reservationId: 'shot-2:video',
                category: 'video',
                capacity: { available: true, remaining: 2 }
            })
        ).toBe(false)
        expect(
            tryReserveGenerationCapacity({
                reservations,
                reservationId: 'shot-2:image',
                category: 'image',
                capacity: { available: true, remaining: 1 }
            })
        ).toBe(true)
    })
})
