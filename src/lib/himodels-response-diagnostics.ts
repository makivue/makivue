import { extractContentFilterDetails } from './content-filter-error'

export type HiModelsRawResponse = {
    id: string
    model: string
    status: number
    receivedAt: string
    requestId: string | null
    gw_trace_id?: string | null
    response: unknown
    truncated: boolean
    request?: { method: string; url: string; body: unknown; headers: unknown; sentAt: string; truncated: boolean }
    durationMs?: number
}

export type HiModelsDiagnosticEvent = {
    id: string
    phase: 'request' | 'response' | 'error'
    model: string
    method: string
    url: string
    timestamp: string
    body: unknown
    headers?: unknown
    status?: number
    requestId?: string | null
    gw_trace_id?: string | null
    failureReason?: string
    summaryOnly?: boolean
    durationMs?: number
    truncated: boolean
}

export type HiModelsResponseObserver = (response: HiModelsRawResponse) => void | Promise<void>

export const HIMODELS_RAW_RESPONSE_MAX_CHARS = 256_000
export const HIMODELS_RAW_RESPONSE_MAX_RECORDS = 20

export const HIMODELS_TRACE_HEADERS = ['gw_trace_id', 'gw-trace-id', 'x-gw-trace-id', 'x-gw_trace_id', 'x-request-id', 'request-id', 'x-trace-id', 'trace-id', 'trace_id', 'cf-ray'] as const

/** Error messages survive persisted jobs and API boundaries where headers do not. */
export function retainHiModelsErrorTrace(error: unknown, details: { gw_trace_id: string | null; requestId: string | null }) {
    if (!(error instanceof Error)) return
    for (const [key, value] of Object.entries(details)) {
        if (value && /^[a-z0-9._:/-]{1,160}$/i.test(value) && !error.message.includes(`${key}=`)) error.message += ` | ${key}=${value}`
    }
}

/** Inspect provider envelopes only; never search generated text or image bytes. */
export function extractHiModelsResponseDetails(payload: unknown, headers?: Headers) {
    const values: Record<string, string> = {}
    const finishes = new Set<string>()
    const blocks = new Set<string>()
    let failed = false
    const visited = new WeakSet<object>()
    let remaining = 100
    const visit = (value: unknown, depth: number) => {
        if (depth > 6 || remaining-- <= 0 || !value || typeof value !== 'object' || visited.has(value)) return
        visited.add(value)
        if (Array.isArray(value)) {
            value.slice(0, 12).forEach(child => visit(child, depth + 1))
            return
        }
        const record = value as Record<string, unknown>
        if (typeof record.error === 'string' && record.error.trim() && !values.errormessage) values.errormessage = record.error.slice(0, 600)
        if (record.success === false || (record.error && (typeof record.error === 'string' || typeof record.error === 'object'))) failed = true
        for (const [key, child] of Object.entries(record)) {
            const normalized = key.replace(/[_-]/g, '').toLowerCase()
            if (
                (typeof child === 'string' || typeof child === 'number') &&
                ['gwtraceid', 'requestid', 'traceid', 'errorcode', 'code', 'status', 'errormsg', 'errormessage', 'message'].includes(normalized)
            ) {
                const text = String(child)
                    .trim()
                    .slice(0, normalized.includes('message') || normalized === 'errormsg' ? 600 : 160)
                if (text && !values[normalized]) values[normalized] = text
                if (['errorcode', 'code'].includes(normalized) && text && !/^(?:0|2\d\d|OK|SUCCESS|SUCCEEDED)$/i.test(text)) failed = true
                if (normalized === 'status' && /^(?:failed|error|cancelled|canceled|unknown)$/i.test(text)) failed = true
            }
            if (typeof child === 'string' && ['finishreason', 'stopreason'].includes(normalized)) {
                finishes.add(child.slice(0, 120))
                if (!/^(?:STOP|end_turn|stop_sequence|tool_use|tool_calls)$/i.test(child)) failed = true
            }
            if (typeof child === 'string' && normalized === 'blockreason' && child.trim()) {
                blocks.add(child.slice(0, 120))
                failed = true
            }
        }
        for (const key of ['error', 'errors', 'data', 'result', 'response', 'output', 'metadata', 'meta', 'cause', 'promptFeedback', 'prompt_feedback', 'candidates', 'choices', 'message'])
            visit(record[key], depth + 1)
    }
    visit(payload, 0)
    const header = (...names: string[]) => names.map(name => headers?.get(name)?.trim()).find(Boolean) ?? null
    const gwTraceId = header('gw_trace_id', 'gw-trace-id', 'x-gw-trace-id', 'x-gw_trace_id') ?? values.gwtraceid ?? null
    const traceId = header('x-trace-id', 'trace-id', 'trace_id') ?? values.traceid ?? null
    const cfRay = header('cf-ray')
    return {
        gw_trace_id: gwTraceId,
        requestId: header('x-request-id', 'request-id') ?? values.requestid ?? gwTraceId ?? traceId ?? cfRay,
        traceId,
        cfRay,
        errorCode: values.errorcode ?? values.code ?? null,
        providerStatus: values.status ?? null,
        providerMessage: values.errormsg ?? values.errormessage ?? values.message ?? null,
        finishReasons: [...finishes],
        blockReasons: [...blocks],
        moderation: extractContentFilterDetails(payload, headers, finishes.has('content_filter') || finishes.has('refusal') ? 'output' : 'unknown'),
        failed
    }
}

/** Raw provider bodies contain generated content; production must explicitly opt in. */
export function hiModelsResponseDiagnosticsEnabled() {
    const configured = process.env.HIMODELS_RESPONSE_DIAGNOSTICS
    return configured === 'true' || (configured !== 'false' && process.env.NODE_ENV !== 'production')
}

/** Preserve provider fields (including usage) while removing reflected credentials. */
export function sanitizeHiModelsRawResponse(payload: unknown, apiKey: string): { response: unknown; truncated: boolean } {
    const sensitiveKey =
        /^(?:authorization|proxyAuthorization|apiKey|xApiKey|accessKey|accessKeyId|accessKeySecret|accessToken|refreshToken|idToken|token|secret|clientSecret|password|cookie|setCookie|credentials?)$/i
    const redact = (value: string) => {
        const withoutKey = apiKey ? value.replaceAll(apiKey, '[REDACTED]') : value
        return withoutKey
            .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
            .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/([?&](?:key|api[_-]?key|token|access_token|signature|x-goog-signature|x-amz-signature|x-tos-(?:signature|credential|security-token)|ossaccesskeyid)=)[^&#\s]+/gi, '$1[REDACTED]')
    }
    let truncated = false
    let textBudget = HIMODELS_RAW_RESPONSE_MAX_CHARS - 16_000
    const serialized =
        JSON.stringify(payload, (key, value) => {
            if (sensitiveKey.test(key.replace(/[_-]/g, ''))) return '[REDACTED]'
            if (typeof value !== 'string') return value
            if (/^data:(?:image|video|audio)\//i.test(value) || (/^(?:b64_json|base64|data)$/i.test(key) && value.length > 512 && /^[A-Za-z0-9+/_=-]+$/.test(value))) {
                truncated = true
                return `[BINARY OMITTED: ${value.length} base64/data-url characters]`
            }
            const safe = redact(value)
            const allowed = Math.max(0, Math.min(safe.length, textBudget))
            textBudget -= allowed
            if (allowed < safe.length) {
                truncated = true
                return `${safe.slice(0, allowed)}\n[TRUNCATED: ${safe.length - allowed} characters omitted]`
            }
            return safe
        }) ?? 'null'
    if (serialized.length > HIMODELS_RAW_RESPONSE_MAX_CHARS) {
        // Pathological many-field payloads still need a hard cap.
        return { response: `${serialized.slice(0, HIMODELS_RAW_RESPONSE_MAX_CHARS)}\n[TRUNCATED: response exceeds diagnostic limit]`, truncated: true }
    }
    return { response: JSON.parse(serialized), truncated }
}
