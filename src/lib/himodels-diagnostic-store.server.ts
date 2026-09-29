import { randomUUID } from 'node:crypto'
import type { HiModelsDiagnosticEvent } from './himodels-response-diagnostics'

const TTL_MS = 15 * 60_000
type Entry = { sequence: number; at: number; bytes: number; event: HiModelsDiagnosticEvent; userId: string }

/** A short-lived, user-isolated debug buffer, not a billing/audit ledger. */
export function createHiModelsDiagnosticStore(maxBytes = 32 * 1024 * 1024, maxUserBytes = 4 * 1024 * 1024) {
    const instance = randomUUID()
    let sequence = 0
    let bytes = 0
    const entries: Entry[] = []
    const userBytes = new Map<string, number>()
    function remove(index: number) {
        const [entry] = entries.splice(index, 1)
        bytes -= entry.bytes
        const remaining = (userBytes.get(entry.userId) ?? 0) - entry.bytes
        if (remaining <= 0) userBytes.delete(entry.userId)
        else userBytes.set(entry.userId, remaining)
    }
    function expire(now: number) {
        while (entries.length && entries[0].at < now - TTL_MS) remove(0)
    }
    return {
        append(userId: string, event: HiModelsDiagnosticEvent, now = Date.now()) {
            expire(now)
            const size = Buffer.byteLength(JSON.stringify(event))
            if (size > maxUserBytes || size > maxBytes) return
            while ((userBytes.get(userId) ?? 0) + size > maxUserBytes) remove(entries.findIndex(entry => entry.userId === userId))
            while (bytes + size > maxBytes || entries.length >= 2_000) remove(0)
            entries.push({ sequence: ++sequence, at: now, bytes: size, event, userId })
            bytes += size
            userBytes.set(userId, (userBytes.get(userId) ?? 0) + size)
        },
        read(userId: string, cursor: string | null, since: number, now = Date.now()) {
            expire(now)
            const [cursorInstance, cursorSequence] = (cursor ?? '').split(':')
            const after = cursorInstance === instance && /^\d+$/.test(cursorSequence ?? '') ? Number(cursorSequence) : 0
            const matches = entries.filter(entry => entry.userId === userId && entry.sequence > after && entry.at >= since)
            const page = matches.slice(0, 8)
            return {
                events: page.map(entry => entry.event),
                cursor: `${instance}:${page.at(-1)?.sequence ?? sequence}`,
                hasMore: matches.length > page.length,
                retentionMs: TTL_MS
            }
        }
    }
}

const diagnosticGlobal = globalThis as typeof globalThis & { hiModelsDiagnosticStore?: ReturnType<typeof createHiModelsDiagnosticStore> }
export const hiModelsDiagnosticStore = (diagnosticGlobal.hiModelsDiagnosticStore ??= createHiModelsDiagnosticStore())
