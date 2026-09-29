// The local edition has no payment service or external currency synchronization.
export const RATE_SCALE = 1_000_000
export async function tryDailyFxSync(): Promise<boolean> {
    return false
}
export async function getFxRate(currency: string): Promise<number | null> {
    return currency === 'USD' ? RATE_SCALE : null
}
export function invalidateFxCache(): void {}
