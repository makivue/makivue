import { Prisma } from '@/generated/prisma/client'

// These media metrics remain JSON numbers after their storage changes to DECIMAL.
// Monetary decimals retain their existing exact string representation.
const NUMERIC_MEDIA_FIELDS = new Set(['trailerDuration', 'plannedDuration', 'actualDuration', 'duration', 'score'])

// Prisma BigInt columns can't be serialised by the default JSON codec.
// Coerce every BigInt to a decimal string before handing the body to
// Response.json — the client can consume ids as strings just as it did
// with cuid.
function bigintReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
    // JSON.stringify invokes Decimal.toJSON before the replacer; inspect the source value.
    const original = this[key]
    if (NUMERIC_MEDIA_FIELDS.has(key) && Prisma.Decimal.isDecimal(original)) return original.toNumber()
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') {
        // 确保字符串不包含无效的 JSON 字符
        return value
    }
    return value
}

function serialiseBody<T>(body: { success: boolean; data?: T; error?: string } & Record<string, unknown>): string {
    try {
        return JSON.stringify(body, bigintReplacer)
    } catch (err) {
        // 如果序列化失败，尝试清理数据后重试
        console.error('JSON serialization failed, attempting cleanup:', err)
        const cleaned = cleanForSerialization(body)
        return JSON.stringify(cleaned, bigintReplacer)
    }
}

function cleanForSerialization(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj
    if (obj instanceof Date) return obj.toISOString()
    if (typeof obj === 'string') {
        // 尝试解析 JSON 字符串，如果失败就保留原始字符串
        try {
            return JSON.parse(obj)
        } catch {
            return obj
        }
    }
    if (typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
        return obj.map(cleanForSerialization)
    }
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        try {
            cleaned[key] = cleanForSerialization(value)
        } catch {
            cleaned[key] = null
        }
    }
    return cleaned
}

const JSON_API_HEADERS = {
    'Content-Type': 'application/json',
    // API payloads are user-specific or mutable. Keep browsers, reverse proxies
    // and CDNs from replaying a pre-save snapshot after a successful mutation.
    'Cache-Control': 'private, no-store, max-age=0'
}

export function apiResponse<T>(data: T, status = 200) {
    return new Response(serialiseBody({ success: true, data }), {
        status,
        headers: JSON_API_HEADERS
    })
}

export function apiError(message: string, status = 400) {
    return new Response(serialiseBody({ success: false, error: message }), {
        status,
        headers: JSON_API_HEADERS
    })
}

export function apiErrorWithDetails<T extends Record<string, unknown>>(message: string, status: number, details: T) {
    return new Response(serialiseBody({ success: false, error: message, ...details }), {
        status,
        headers: JSON_API_HEADERS
    })
}

export function handleApiError(e: unknown, fallback: string, status = 500) {
    const message = e instanceof Error ? e.message : fallback
    return apiError(message, status)
}
