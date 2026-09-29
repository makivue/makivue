/** Wallet balances are spendable whole coins; legacy fractional balances round down. */
export function wholePointBalance(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.floor(value)
}

/** Ledger amounts round away from zero so a fractional debit is never undercharged. */
export function wholePointAmount(value: number): number {
    if (!Number.isFinite(value)) return 0
    return value < 0 ? Math.floor(value) : Math.ceil(value)
}

export function formatPointBalance(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(wholePointBalance(value))
}

export function formatPointAmount(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(wholePointAmount(value))
}
