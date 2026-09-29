import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { verifySessionToken } from '@/lib/session-token'
import { hiModelsDiagnosticStore } from '@/lib/himodels-diagnostic-store.server'
import { hiModelsResponseDiagnosticsEnabled, sanitizeHiModelsRawResponse, type HiModelsDiagnosticEvent, type HiModelsResponseObserver } from '@/lib/himodels-response-diagnostics'
import { extractApiTokenUsage, extractRawTokenUsage } from '@/lib/api-token-usage'
import type { HiModelsUsageCall, HiModelsUsageObserver } from '@/lib/himodels-token-usage'
import { currentHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { finishHiModelsUsage, hiModelsOperationKey, startHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { finishModelCallBilling, prepareModelCallBilling } from './model-call-billing'
import { fetchWithProviderQuota } from '@/lib/provider-quota'

async function owner() {
    try {
        const authorization = (await headers()).get('authorization')
        const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
        return token ? (verifySessionToken(token)?.userId.toString() ?? null) : null
    } catch {
        return null // CLI / detached work must never inherit another user's logs.
    }
}

function parseBody(raw: string): unknown {
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

/** The only HTTP dispatch for authenticated HiModels model endpoints. */
export async function fetchHiModels(
    url: string,
    init: RequestInit,
    context: { model: string; apiKey: string; onResponse?: HiModelsResponseObserver; onUsage?: HiModelsUsageObserver; callId?: string; billingRequestBody?: unknown }
): Promise<Response> {
    const diagnostics = hiModelsResponseDiagnosticsEnabled()
    const id = context.callId ?? randomUUID()
    const started = Date.now()
    const scope = currentHiModelsUsageScope()
    const userId = scope?.userId?.toString() ?? (await owner())
    const call: HiModelsUsageCall = {
        id,
        provider: 'himodels',
        model: context.model,
        usage: null,
        operationKey: hiModelsOperationKey(url, init, id),
        endpoint: new URL(url).pathname.replace(/(\/v1\/video\/generations)\/.+$/, '$1/:taskId'),
        sentAt: new Date(started).toISOString(),
        captureState: 'pending'
    }
    const billingUserId = userId ? BigInt(userId) : null
    const billingInit = context.billingRequestBody === undefined ? init : { ...init, body: JSON.stringify(context.billingRequestBody) }
    const reservationPoints = await prepareModelCallBilling(call, billingUserId, url, billingInit)
    const ledgerId = await startHiModelsUsage(call, billingUserId, reservationPoints)
    const recordUsage = async () => {
        await finishHiModelsUsage(ledgerId, call)
        for (const observer of new Set([scope?.onUsage, context.onUsage])) {
            try {
                await observer?.(call)
            } catch {
                console.warn('[HiModels Usage] Usage observer failed; provider call will not be retried')
            }
        }
    }
    const safe = (value: unknown) => sanitizeHiModelsRawResponse(value, context.apiKey)
    const requestBody = safe(typeof init.body === 'string' ? parseBody(init.body) : null)
    const method = init.method ?? 'GET'
    const safeUrl = String(safe(url).response)
    const request = {
        method,
        url: safeUrl,
        body: requestBody.response,
        headers: safe(Object.fromEntries([...new Headers(init.headers)].filter(([key]) => ['authorization', 'content-type', 'idempotency-key'].includes(key)))).response,
        sentAt: new Date(started).toISOString(),
        truncated: requestBody.truncated
    }
    const publish = (event: HiModelsDiagnosticEvent) => {
        try {
            if (diagnostics && userId) hiModelsDiagnosticStore.append(userId, event)
        } catch {
            // Debug storage must not affect generation or its retry policy.
        }
    }
    publish({ id, phase: 'request', model: context.model, method, url: safeUrl, timestamp: request.sentAt, body: request.body, headers: request.headers, truncated: request.truncated })
    let response: Response
    try {
        response = await fetchWithProviderQuota(url, { ...init, signal: init.signal ?? AbortSignal.timeout(120_000) }, { provider: 'himodels', model: context.model })
    } catch (error) {
        call.captureState = 'network_error'
        call.receivedAt = new Date().toISOString()
        try {
            await finishModelCallBilling(call, billingUserId, null, method)
        } catch {
            console.error('[billing] failed attempt reservation release requires recovery')
        }
        await recordUsage()
        const body = safe(error instanceof Error ? { name: error.name, message: error.message } : String(error))
        publish({
            id,
            phase: 'error',
            model: context.model,
            method,
            url: safeUrl,
            timestamp: new Date().toISOString(),
            body: body.response,
            durationMs: Date.now() - started,
            truncated: body.truncated
        })
        throw error
    }
    let payload: unknown = null
    let binary = false
    let bodyReadError: unknown
    let bodyReadFailed = false
    try {
        const contentType = response.headers.get('content-type') ?? ''
        binary = /^(?:image|video|audio)\/|application\/octet-stream/i.test(contentType)
        let bytes: ArrayBuffer
        try {
            bytes = await response.arrayBuffer()
        } catch (error) {
            bodyReadFailed = true
            bodyReadError = error
            throw error
        }
        // Read the upstream stream once before awaiting usage persistence.
        // An abort during that await can invalidate an unread original even
        // after response.clone() has received the complete, billable result.
        const buffered = new Response(response.body === null ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
        Object.defineProperties(buffered, {
            url: { value: response.url },
            redirected: { value: response.redirected },
            type: { value: response.type }
        })
        response = buffered
        payload = binary ? { diagnostic: 'BINARY OMITTED', contentType, contentLength: response.headers.get('content-length') } : parseBody(Buffer.from(bytes).toString('utf8'))
        call.usage = extractApiTokenUsage(payload)
        if (call.usage) call.usage.raw = safe(call.usage.raw).response as NonNullable<HiModelsUsageCall['usage']>['raw']
        call.rawUsage = safe(extractRawTokenUsage(payload)).response
        call.operationKey = hiModelsOperationKey(url, init, id, response.ok ? payload : undefined)
        call.captureState = binary ? 'binary_without_usage' : 'received'
    } catch {
        call.captureState = 'body_error'
    }
    call.status = response.status
    call.receivedAt = new Date().toISOString()
    const rawRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? response.headers.get('x-trace-id')
    call.requestId = rawRequestId ? String(safe(rawRequestId).response) : null
    try {
        await finishModelCallBilling(call, billingUserId, payload, method)
    } catch {
        console.error('[billing] supplier cost capture failed; settlement requires recovery')
    }
    await recordUsage()
    if (bodyReadFailed) throw bodyReadError
    if (!diagnostics) return response
    try {
        const body = safe(payload)
        const receivedAt = new Date().toISOString()
        const durationMs = Date.now() - started
        const requestId = call.requestId
        publish({
            id,
            phase: 'response',
            model: context.model,
            method,
            url: safeUrl,
            timestamp: receivedAt,
            body: body.response,
            headers: safe(Object.fromEntries([...response.headers].filter(([key]) => ['content-type', 'content-length', 'x-request-id', 'request-id', 'x-trace-id', 'retry-after'].includes(key))))
                .response,
            status: response.status,
            requestId,
            durationMs,
            truncated: body.truncated || binary
        })
        await context.onResponse?.({ id, model: context.model, status: response.status, receivedAt, requestId, response: body.response, truncated: body.truncated || binary, request, durationMs })
    } catch {
        // Never retry a billable call just because reading/persisting diagnostics failed.
        console.warn('[HiModels Raw Response] Could not record response diagnostics')
    }
    return response
}
