export type HiModelsRawResponse = {
    id: string
    model: string
    status: number
    receivedAt: string
    requestId: string | null
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
    durationMs?: number
    truncated: boolean
}

export type HiModelsResponseObserver = (response: HiModelsRawResponse) => void | Promise<void>

export const HIMODELS_RAW_RESPONSE_MAX_CHARS = 256_000
export const HIMODELS_RAW_RESPONSE_MAX_RECORDS = 20

/** Raw provider bodies contain generated content; production must explicitly opt in. */
export function hiModelsResponseDiagnosticsEnabled() {
    const configured = process.env.HIMODELS_RESPONSE_DIAGNOSTICS
    return configured === 'true' || (configured !== 'false' && process.env.NODE_ENV !== 'production')
}

/** Preserve provider fields (including usage) while removing reflected credentials. */
export function sanitizeHiModelsRawResponse(payload: unknown, apiKey: string): { response: unknown; truncated: boolean } {
    const sensitiveKey =
        /^(?:authorization|proxyAuthorization|apiKey|accessKey|accessKeyId|accessKeySecret|accessToken|refreshToken|idToken|token|secret|clientSecret|password|cookie|setCookie|credentials?)$/i
    const redact = (value: string) => {
        const withoutKey = apiKey ? value.replaceAll(apiKey, '[REDACTED]') : value
        return withoutKey
            .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
            .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/([?&](?:key|api[_-]?key|token|access_token|signature|x-goog-signature|x-amz-signature|ossaccesskeyid)=)[^&#\s]+/gi, '$1[REDACTED]')
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
