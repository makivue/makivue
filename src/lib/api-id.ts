const POSITIVE_ID = /^[1-9]\d{0,18}$/

export function parseApiId(value: unknown): bigint | null {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
    const raw = String(value).trim()
    if (!POSITIVE_ID.test(raw)) return null
    try {
        const id = BigInt(raw)
        return id <= 9223372036854775807n ? id : null
    } catch {
        return null
    }
}

export function parseApiIds(value: unknown): bigint[] | null {
    if (!Array.isArray(value)) return null
    const ids = value.map(parseApiId)
    return ids.every((id): id is bigint => id !== null) ? [...new Set(ids)] : null
}
