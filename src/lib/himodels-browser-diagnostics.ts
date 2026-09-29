import { extractApiTokenUsage } from './api-token-usage'
import type { HiModelsDiagnosticEvent } from './himodels-response-diagnostics'

const observed = new Set<string>()

/** Shared by the live debug feed and persisted outline responses. */
export function logHiModelsDiagnosticEvent(event: HiModelsDiagnosticEvent, extra: Record<string, unknown> = {}) {
    const key = `${event.id}:${event.phase}`
    if (observed.has(key)) return
    observed.add(key)
    if (observed.size > 4_000) observed.delete(observed.values().next().value!)
    const name = event.phase === 'request' ? 'Request' : event.phase === 'response' ? 'Raw Response' : 'Request Error'
    const usage = event.phase === 'response' ? extractApiTokenUsage(event.body) : null
    console.info(`[HiModels ${name}] ${event.model} | call=${event.id} | ${event.method} ${event.url}${event.status !== undefined ? ` | HTTP ${event.status}` : ''}`, event.body, {
        ...extra,
        callId: event.id,
        model: event.model,
        status: event.status,
        requestId: event.requestId,
        timestamp: event.timestamp,
        durationMs: event.durationMs,
        headers: event.headers,
        truncated: event.truncated,
        ...(event.phase === 'response'
            ? { tokenUsageReturned: usage !== null, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null }
            : {})
    })
}
