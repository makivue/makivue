import { extractHiModelsResponseDetails, sanitizeHiModelsRawResponse } from './himodels-response-diagnostics'

export const BROWSER_API_ERROR_EVENT = 'app:api-error'
const observed = new Set<string>()
const FAILED_STATES = new Set(['failed', 'error', 'unknown'])
const CONTAINERS = new Set(['data', 'result', 'response', 'items', 'shots', 'storyboards', 'episodes', 'generations', 'latestErrors', 'errors', 'latestVideoRequest', 'job'])

/** Successful reads report generation failures at info level; request failures remain errors. */
export function logBrowserApiErrors(payload: unknown, context: { endpoint: string; method: string; status?: number; headers?: Headers }) {
    const requestFailed =
        context.status === undefined || context.status < 200 || context.status >= 300 || (!!payload && typeof payload === 'object' && 'success' in payload && payload.success === false)
    const level = requestFailed ? 'Error' : 'Info'
    const log = requestFailed ? console.error : console.info
    const visited = new WeakSet<object>()
    let remaining = 500
    let logged = false
    const visit = (value: unknown, path: string, ownerId: string, depth: number) => {
        if (depth > 10 || remaining-- <= 0 || !value || typeof value !== 'object' || visited.has(value)) return
        visited.add(value)
        if (Array.isArray(value)) return value.forEach((child, index) => visit(child, `${path}.${index}`, ownerId, depth + 1))
        const record = value as Record<string, unknown>
        const id = String(record.id ?? record.jobId ?? record.storyboardId ?? ownerId)
        const failure = record.success === false || ['phase', 'status', 'frameStatus', 'videoStatus', 'audioStatus', 'composeStatus'].some(key => FAILED_STATES.has(String(record[key]).toLowerCase()))
        const error = record.errorDetail || record.errorMsg || record.errorMessage || record.error || (failure ? record.message || record.reason : null)
        if (error || (failure && !record.latestErrors) || (path === 'response' && context.status !== undefined && context.status >= 400)) {
            const rawMessage = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Request or generation failed'
            const message = String(sanitizeHiModelsRawResponse(rawMessage, '').response)
                .replace(/https?:\/\/[^\s"<>]+/gi, '[URL OMITTED]')
                .slice(0, 2000)
            const details = extractHiModelsResponseDetails(record, path === 'response' ? context.headers : undefined)
            const gwTraceId = details.gw_trace_id ?? message.match(/\bgw[_-]?trace[_-]?id\s*[=:：]\s*([a-z0-9._:/-]{1,160})/i)?.[1] ?? null
            const requestId = details.requestId ?? message.match(/(?:\brequest[_ -]?id|请求编号)\s*[=:：]\s*([a-z0-9._:/-]{1,160})/i)?.[1] ?? null
            const key = JSON.stringify([level, context.endpoint, id, path, record.createdAt ?? record.updatedAt, message, gwTraceId, requestId])
            if (!observed.has(key)) {
                observed.add(key)
                if (observed.size > 2000) observed.delete(observed.values().next().value!)
                log(`[API ${level}] ${context.method} ${context.endpoint} | gw_trace_id=${gwTraceId} | requestId=${requestId}`, {
                    endpoint: context.endpoint,
                    method: context.method,
                    status: context.status,
                    id,
                    path,
                    message,
                    gw_trace_id: gwTraceId,
                    requestId,
                    traceUnavailableReason: gwTraceId ? undefined : 'response did not include gw_trace_id',
                    page: typeof window === 'undefined' ? undefined : window.location.pathname
                })
                logged = true
            }
        }
        for (const [key, child] of Object.entries(record)) {
            // latestErrors is a map keyed by generation type.
            if (CONTAINERS.has(key) || path.endsWith('.latestErrors') || path.endsWith('.errors')) visit(child, `${path}.${key}`, id, depth + 1)
        }
    }
    visit(payload, 'response', '', 0)
    if (logged && typeof window !== 'undefined') window.dispatchEvent(new Event(BROWSER_API_ERROR_EVENT))
}

export function observeBrowserApiErrors(response: Response, endpoint: string, method: string) {
    if (typeof window === 'undefined' || !endpoint.startsWith('/api/')) return
    const context = { endpoint, method, status: response.status, headers: response.headers }
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
        if (!response.ok) logBrowserApiErrors({ success: false, error: `HTTP ${response.status}` }, context)
        return
    }
    void response
        .clone()
        .json()
        .then(payload => logBrowserApiErrors(payload, context))
        .catch(() => {
            logBrowserApiErrors({ success: false, error: 'Invalid JSON response' }, context)
        })
}
