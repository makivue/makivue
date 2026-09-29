import { randomUUID } from 'node:crypto'
import { extractApiTokenUsage, extractRawTokenUsage } from './api-token-usage'
import { currentHiModelsUsageScope } from './himodels-usage-context.server'
import type { ProviderTokenUsageObserver, TokenUsageProvider } from './himodels-token-usage'
import { finishHiModelsUsage, hiModelsOperationKey, startHiModelsUsage } from './himodels-usage-ledger.server'
import type { HiModelsUsageCall } from './himodels-token-usage'
import { prepareModelCallBilling, finishModelCallBilling } from '@/services/model-call-billing'
import { fetchWithProviderQuota } from '@/lib/provider-quota'

const meteredResponses = new WeakMap<Response, HiModelsUsageCall>()

/** Reserve before dispatch and persist the response before returning it to business code. */
export async function fetchMeteredProvider(
    url: string,
    init: RequestInit,
    context: { provider: TokenUsageProvider; model: string; fetchImpl?: typeof fetch; billingRequestBody?: unknown }
): Promise<Response> {
    const scope = currentHiModelsUsageScope()
    const fetchImpl = (requestUrl: string, requestInit: RequestInit) => fetchWithProviderQuota(requestUrl, requestInit, context)
    if (scope?.userId === undefined) return fetchImpl(url, init)
    const id = randomUUID()
    const call: HiModelsUsageCall = {
        id,
        provider: context.provider,
        model: context.model,
        usage: null,
        operationKey: hiModelsOperationKey(url, init, id),
        endpoint: new URL(url).pathname.replace(/(\/tasks|\/videos\/image2video)\/[^/]+$/, '$1/:taskId'),
        sentAt: new Date().toISOString(),
        captureState: 'pending'
    }
    const billingInit = context.billingRequestBody === undefined ? init : { ...init, body: JSON.stringify(context.billingRequestBody) }
    const reservationPoints = await prepareModelCallBilling(call, scope.userId, url, billingInit)
    const ledgerId = await startHiModelsUsage(call, scope.userId, reservationPoints)
    let result: Response
    let payload: unknown
    try {
        const response = await fetchImpl(url, init)
        const bytes = await response.arrayBuffer()
        result = new Response(response.body === null ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
        Object.defineProperty(result, 'url', { value: response.url })
        try {
            payload = JSON.parse(Buffer.from(bytes).toString('utf8'))
        } catch {
            payload = null
        }
        call.status = response.status
        call.operationKey = hiModelsOperationKey(url, init, id, response.ok ? payload : undefined)
        call.usage = extractApiTokenUsage(payload)
        call.rawUsage = extractRawTokenUsage(payload)
        call.captureState = 'received'
        call.requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? response.headers.get('x-goog-request-id')
        call.receivedAt = new Date().toISOString()
    } catch (error) {
        call.captureState = 'network_error'
        call.receivedAt = new Date().toISOString()
        try {
            await finishModelCallBilling(call, scope.userId, null, init.method ?? 'GET')
        } catch {
            console.error('[billing] failed attempt reservation release requires recovery')
        }
        await finishHiModelsUsage(ledgerId, call)
        throw error
    }
    try {
        await finishModelCallBilling(call, scope.userId, payload, init.method ?? 'GET')
    } catch {
        console.error('[billing] supplier cost capture failed; settlement requires recovery')
    }
    await finishHiModelsUsage(ledgerId, call)
    meteredResponses.set(result, call)
    try {
        await scope.onUsage?.(call)
    } catch {
        console.warn('[Provider Usage] observer failed')
    }
    return result
}

export async function reportProviderTokenUsage(params: {
    provider: TokenUsageProvider
    model: string
    endpoint: string
    response: Response
    payload: unknown
    sentAt: string
    observer?: ProviderTokenUsageObserver
    operationKey?: string
}) {
    const scope = currentHiModelsUsageScope()
    const metered = meteredResponses.get(params.response)
    if (metered) {
        try {
            await params.observer?.(metered)
        } catch {
            console.warn('[Provider Usage] observer failed')
        }
        return
    }
    const observers = new Set([scope?.onUsage, params.observer].filter((observer): observer is ProviderTokenUsageObserver => observer !== undefined))
    if (observers.size === 0 && scope?.userId === undefined) return
    const id = randomUUID()
    const requestId = params.response.headers.get('x-request-id') ?? params.response.headers.get('request-id') ?? params.response.headers.get('x-goog-request-id')
    const call = {
        id,
        provider: params.provider,
        model: params.model,
        usage: extractApiTokenUsage(params.payload),
        rawUsage: extractRawTokenUsage(params.payload),
        operationKey: params.operationKey ?? `call:${id}`,
        endpoint: params.endpoint,
        status: params.response.status,
        captureState: 'received',
        requestId,
        sentAt: params.sentAt,
        receivedAt: new Date().toISOString()
    }
    if (scope?.userId !== undefined) {
        try {
            const ledgerId = await startHiModelsUsage(call, scope.userId)
            await finishHiModelsUsage(ledgerId, call)
        } catch {
            // The provider response has already been received. Never turn a
            // usage-ledger failure into a retry of a billable model call.
            console.warn(`[Provider Usage] ${params.provider} usage persistence failed; provider call will not be retried`)
        }
    }
    for (const observer of observers) {
        try {
            await observer(call)
        } catch {
            // Usage diagnostics must never retry a successful, billable response.
            console.warn(`[Provider Usage] ${params.provider} usage observer failed; provider call will not be retried`)
        }
    }
}
