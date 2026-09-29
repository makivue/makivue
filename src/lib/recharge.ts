export const RECHARGE_TIERS_USD = [5, 50, 100, 500, 1000] as const
export const POINTS_PER_USD = 1_000

export function usdToPoints(value: number): number {
    return Math.ceil(value * POINTS_PER_USD)
}

/** SKU prices are stored in USD cents; local payment currency never sets coin credit. */
export function usdCentsToPoints(value: number): number {
    return usdToPoints(value / 100)
}

export function normalizeRechargeAmount(value: unknown): number | null {
    const amount = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(amount)) return null
    return RECHARGE_TIERS_USD.find(tier => tier === amount) ?? null
}

export type RechargeTier = {
    skuCode: string
    amountUsdCents: number
    amountLocalCents: number
    displayAmount: string
    points: number
    currency: string
    currencySymbol: string
    label: string | null
}

export function formatLocalCurrency(amountCents: number, currencyCode: string, locale = 'en'): string {
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currencyCode
        }).format(amountCents / 100)
    } catch {
        return `${currencyCode} ${(amountCents / 100).toFixed(2)}`
    }
}

export function validateSkuRechargeAmount(skuCode: string, amountUsdCents: number, tiers: RechargeTier[]): RechargeTier | null {
    if (skuCode) {
        return tiers.find(t => t.skuCode === skuCode && t.amountUsdCents === amountUsdCents) ?? null
    }
    return tiers.find(t => t.amountUsdCents === amountUsdCents) ?? null
}
