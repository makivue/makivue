export type GenerationCapacityReservationCategory = 'image' | 'video'

export interface GenerationCapacitySnapshot {
    available: boolean
    remaining: number
}

interface GenerationCapacityReservation {
    category: GenerationCapacityReservationCategory
    units: number
}

export type GenerationCapacityReservations = Map<string, GenerationCapacityReservation>

function normalizeUnits(units: number) {
    return Math.max(1, Math.floor(units))
}

export function countReservedGenerationCapacity(reservations: GenerationCapacityReservations, category: GenerationCapacityReservationCategory) {
    let total = 0
    for (const reservation of reservations.values()) {
        if (reservation.category === category) total += reservation.units
    }
    return total
}

/**
 * Reserve capacity reported by the server while the client prepares and submits
 * the generation request. This closes the gap where several storyboard cards
 * can all observe the same remaining slot before any POST reaches the server.
 */
export function tryReserveGenerationCapacity(params: {
    reservations: GenerationCapacityReservations
    reservationId: string
    category: GenerationCapacityReservationCategory
    capacity: GenerationCapacitySnapshot
    units?: number
}) {
    const { reservations, reservationId, category, capacity } = params
    if (reservations.has(reservationId)) return false

    const units = normalizeUnits(params.units ?? 1)
    const alreadyReserved = countReservedGenerationCapacity(reservations, category)
    if (!capacity.available || capacity.remaining < alreadyReserved + units) return false

    reservations.set(reservationId, { category, units })
    return true
}

export function releaseGenerationCapacityReservation(reservations: GenerationCapacityReservations, reservationId: string) {
    reservations.delete(reservationId)
}
