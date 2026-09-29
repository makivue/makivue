// Retry job-row creation when a legacy deployment still produces the same
// Sonyflake PRIMARY key. Secondary unique conflicts are returned immediately
// so the caller can reuse the row addressed by activeKey.
import { randomInt } from 'node:crypto'

const MAX_PRIMARY_KEY_ATTEMPTS = 8

type RetryOptions = {
    maxAttempts?: number
    sleep?: (delayMs: number) => Promise<void>
    randomDelayMs?: (attempt: number) => number
}

function p2002Target(error: unknown): unknown {
    if (!error || typeof error !== 'object' || !('meta' in error)) return undefined
    const meta = error.meta
    if (!meta || typeof meta !== 'object') return undefined
    if ('target' in meta) return meta.target
    if ('constraint' in meta) return meta.constraint
    if ('driverAdapterError' in meta && meta.driverAdapterError && typeof meta.driverAdapterError === 'object' && 'cause' in meta.driverAdapterError) {
        const cause = meta.driverAdapterError.cause
        if (cause && typeof cause === 'object' && 'constraint' in cause) {
            const constraint = cause.constraint
            if (constraint && typeof constraint === 'object' && 'index' in constraint) return constraint.index
            return constraint
        }
    }
    return undefined
}

function constraintHint(error: unknown): string | undefined {
    const target = p2002Target(error)
    if (target !== undefined) return Array.isArray(target) ? target.join(',') : String(target)
    const message = error instanceof Error ? error.message : String(error)
    return message.match(/constraint:\s*([^\s\n]+)/i)?.[1] ?? message.match(/key\s+['`"]([^'`"]+)/i)?.[1]
}

export function isP2002Error(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export function isPrimaryKeyP2002(error: unknown): boolean {
    if (!isP2002Error(error)) return false
    const hint = constraintHint(error)
    return hint !== undefined && (/primary/i.test(hint) || /(^|,)id($|,)/i.test(hint.replace(/[\[\]'"\s]/g, '')))
}

function shouldRetryAsPrimaryKey(error: unknown) {
    if (!isP2002Error(error)) return false
    return constraintHint(error) === undefined || isPrimaryKeyP2002(error)
}

function defaultRandomDelayMs(attempt: number) {
    // Sonyflake time advances in 10ms units, so always cross at least one
    // timestamp bucket and add full jitter to stop replicas retrying in sync.
    const cap = Math.min(250, 20 * 2 ** attempt)
    return randomInt(11, cap + 1)
}

export async function retryP2002<T>(create: () => PromiseLike<T>, label: string, options: RetryOptions = {}): Promise<T> {
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_PRIMARY_KEY_ATTEMPTS))
    const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))
    const randomDelayMs = options.randomDelayMs ?? defaultRandomDelayMs
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const result = await create()
            return result
        } catch (error) {
            if (!shouldRetryAsPrimaryKey(error) || attempt === maxAttempts - 1) throw error
            const delayMs = Math.max(1, Math.floor(randomDelayMs(attempt)))
            console.warn(`[${label}] Sonyflake PRIMARY collision; retrying with a new id in ${delayMs}ms (attempt ${attempt + 2}/${maxAttempts})`)
            await sleep(delayMs)
        }
    }
    throw new Error(`${label}: unreachable`)
}
