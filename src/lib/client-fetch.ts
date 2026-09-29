import { clearAuthSession, getAuthToken } from './auth'
import { localeFromPathname } from '@/i18n/config'
import { redirectToHomepage } from './home-redirect'
import { pushToast } from '@/components/Toast'
import { notifyWalletBalanceInvalidated, notifyWalletRechargeRequired, WALLET_RECHARGE_REQUIRED_STATUS } from './wallet-gate'
import { logHiModelsDiagnosticEvent } from './himodels-browser-diagnostics'

export { extractApiTokenUsage } from './api-token-usage'

export type ClientFetchInit = RequestInit & { timeoutMs?: number; suppressRateLimitToast?: boolean }

const RATE_LIMIT_TOAST_DEDUPE_MS = 10_000
let lastRateLimitToastAt = Number.NEGATIVE_INFINITY
const observedWalletCompletions = new Set<string>()
const walletCompletionSnapshots = new Map<string, Set<string>>()
const WALLET_RECHARGE_MESSAGE_PATTERN =
    /(?:可用金币不足|金币不足|积分不足|余额不(?:足|够)|没有可用金币|insufficient\s+(?:available\s+)?(?:balance|coins?|points?|credits?)|not enough\s+(?:balance|coins?|points?|credits?))/i

const BILLABLE_MUTATION_PATHS = [
    /^\/api\/ai\/(?:chapter|expand-prompt|extract\/preview|novel|outline|script|setup|split-episodes|story-directions|storyboard)$/,
    /^\/api\/create\/(?:image|video)$/,
    /^\/api\/(?:characters|scenes)\/[^/]+\/reference$/,
    /^\/api\/projects\/[^/]+\/(?:character-references|scene-references|style-reference)$/,
    /^\/api\/storyboards\/[^/]+\/(?:compare-kling|compare-speech|compose|images\/generate|split-action|video\/generate)$/,
    /^\/api\/storyboards\/[^/]+\/middle-frames\/[^/]+$/,
    /^\/api\/episodes\/[^/]+\/(?:generate-all|merge)$/
]

const BILLABLE_STATUS_PATHS = [
    /^\/api\/ai\/[^/]+\/status\/[^/]+$/,
    /^\/api\/create\/(?:image\/status\/[^/]+|video\/status|video\/job\/[^/]+)$/,
    /^\/api\/generate\/poll$/,
    /^\/api\/projects\/import\/status\/[^/]+$/,
    /^\/api\/(?:characters|scenes)\/[^/]+\/reference\/status\/[^/]+$/,
    /^\/api\/projects\/[^/]+\/(?:character-references|scene-references|style-reference)\/status\/[^/]+$/,
    /^\/api\/episodes\/[^/]+\/generate-all\/status\/[^/]+$/,
    /^\/api\/storyboards\/[^/]+\/compare-(?:kling|speech)$/
]

const BILLABLE_SNAPSHOT_PATHS = [/^\/api\/episodes\/[^/]+$/]
const TERMINAL_JOB_STATES = new Set(['done', 'completed', 'error', 'failed', 'cancelled', 'canceled'])

/**
 * Browsers do not use one stable error shape when a fetch is cancelled. Some
 * runtimes report AbortSignal cancellations as "The user aborted a request."
 * even when the cancellation came from navigation or an internal deadline.
 */
export function isRequestAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    return name === 'AbortError' || name === 'TimeoutError' || /(?:aborted a request|request was aborted|operation was aborted|\btimeout\b|timed out)/i.test(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Each entry is one upstream call, not one status poll or one whole outline. */
function logHiModelsRawResponses(payload: unknown) {
    if (!isRecord(payload) || payload.success === false) return
    const data = isRecord(payload.data) ? payload.data : payload
    if (!Array.isArray(data.himodelsResponses) || data.himodelsResponses.length === 0) return
    for (const entry of data.himodelsResponses) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !Object.prototype.hasOwnProperty.call(entry, 'response')) continue
        const request = isRecord(entry.request) ? entry.request : null
        const common = {
            id: entry.id,
            model: String(entry.model),
            method: typeof request?.method === 'string' ? request.method : 'POST',
            url: typeof request?.url === 'string' ? request.url : '/v1/chat/completions'
        }
        const extra = { jobId: data.id, olderResponsesDropped: data.himodelsResponsesDropped ?? 0 }
        if (request)
            logHiModelsDiagnosticEvent(
                {
                    ...common,
                    phase: 'request',
                    timestamp: String(request.sentAt ?? ''),
                    body: request.body,
                    headers: request.headers,
                    truncated: request.truncated === true
                },
                extra
            )
        logHiModelsDiagnosticEvent(
            {
                ...common,
                phase: 'response',
                timestamp: String(entry.receivedAt ?? ''),
                body: entry.response,
                status: typeof entry.status === 'number' ? entry.status : undefined,
                requestId: typeof entry.requestId === 'string' ? entry.requestId : null,
                durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
                truncated: entry.truncated === true
            },
            extra
        )
    }
}

function requestUrl(input: RequestInfo | URL): URL | null {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input
    try {
        return new URL(raw, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
    } catch {
        return null
    }
}

function terminalStateVersion(record: Record<string, unknown>, field: string): string {
    if (field === 'frameStatus') {
        const illustrations = Array.isArray(record.illustrations)
            ? record.illustrations.map(item => (isRecord(item) && (typeof item.id === 'string' || typeof item.id === 'number') ? item.id : '')).join(',')
            : ''
        return [record.firstFrameUrl, record.lastFrameUrl, illustrations].join('|')
    }
    if (field === 'videoStatus') {
        const latestVideoRequest = isRecord(record.latestVideoRequest) ? record.latestVideoRequest : null
        return String(latestVideoRequest?.id ?? record.videoUrl ?? '')
    }
    if (field === 'audioStatus') return String(record.audioUrl ?? '')
    if (field === 'composeStatus') return String(record.composedVideoUrl ?? '')
    return ''
}

function collectTerminalWalletOperations(value: unknown, requestKey: string, path = 'data', output = new Set<string>(), depth = 0): Set<string> {
    if (depth > 8 || value === null || typeof value !== 'object') return output
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectTerminalWalletOperations(item, requestKey, `${path}.${index}`, output, depth + 1))
        return output
    }

    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : path
    for (const field of ['phase', 'status', 'frameStatus', 'videoStatus', 'audioStatus', 'composeStatus']) {
        const state = typeof record[field] === 'string' ? record[field].toLowerCase() : ''
        if (TERMINAL_JOB_STATES.has(state)) output.add(`${requestKey}:${id}:${field}:${state}:${terminalStateVersion(record, field)}`)
    }
    for (const [key, child] of Object.entries(record)) {
        if (key === 'error' || key === 'metadata' || key === 'requestBody' || key === 'himodelsResponses' || key === 'himodelsUsageCalls' || key === 'tokenUsage') continue
        collectTerminalWalletOperations(child, requestKey, `${path}.${key}`, output, depth + 1)
    }
    return output
}

function walletRechargeMessageFromErrorValue(value: unknown, depth = 0): string | null {
    if (depth > 8 || value === null || value === undefined) return null
    if (typeof value === 'string') return WALLET_RECHARGE_MESSAGE_PATTERN.test(value) ? value : null
    if (Array.isArray(value)) {
        for (const item of value) {
            const message = walletRechargeMessageFromErrorValue(item, depth + 1)
            if (message) return message
        }
        return null
    }
    if (!isRecord(value)) return null
    for (const child of Object.values(value)) {
        const message = walletRechargeMessageFromErrorValue(child, depth + 1)
        if (message) return message
    }
    return null
}

function findWalletRechargeMessage(value: unknown): string | null {
    if (!isRecord(value)) return null
    for (const key of ['error', 'errorMsg', 'errorMessage', 'message', 'reason', 'errors', 'latestErrors']) {
        const message = walletRechargeMessageFromErrorValue(value[key])
        if (message) return message
    }
    return null
}

function collectTerminalWalletFailures(value: unknown, requestKey: string, path = 'data', output = new Map<string, string>(), depth = 0): Map<string, string> {
    if (depth > 8 || value === null || typeof value !== 'object') return output
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectTerminalWalletFailures(item, requestKey, `${path}.${index}`, output, depth + 1))
        return output
    }

    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : path
    const message = findWalletRechargeMessage(record)
    if (message) {
        for (const field of ['phase', 'status', 'frameStatus', 'videoStatus', 'audioStatus', 'composeStatus']) {
            const state = typeof record[field] === 'string' ? record[field].toLowerCase() : ''
            if (TERMINAL_JOB_STATES.has(state)) output.set(`${requestKey}:${id}:${field}:${state}:${terminalStateVersion(record, field)}`, message)
        }
    }
    for (const [key, child] of Object.entries(record)) {
        if (key === 'metadata' || key === 'requestBody' || key === 'himodelsResponses' || key === 'himodelsUsageCalls' || key === 'tokenUsage') continue
        collectTerminalWalletFailures(child, requestKey, `${path}.${key}`, output, depth + 1)
    }
    return output
}

function observeWalletRechargeErrorResponse(response: Response) {
    if (typeof window === 'undefined' || response.ok) return
    const rechargeRequired = response.status === WALLET_RECHARGE_REQUIRED_STATUS
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
        if (rechargeRequired) notifyWalletRechargeRequired()
        return
    }
    void response
        .clone()
        .json()
        .then(payload => {
            const message = findWalletRechargeMessage(payload)
            if (rechargeRequired || message) notifyWalletRechargeRequired(message ?? undefined)
        })
        .catch(() => {
            if (rechargeRequired) notifyWalletRechargeRequired()
        })
}

function observeWalletResponse(input: RequestInfo | URL, method: string, response: Response) {
    if (typeof window === 'undefined' || !response.ok) return
    const url = requestUrl(input)
    if (!url || url.pathname === '/api/wallet/balance') return

    if (method === 'POST' && response.status !== 202 && BILLABLE_MUTATION_PATHS.some(pattern => pattern.test(url.pathname))) {
        notifyWalletBalanceInvalidated()
        return
    }

    const observesStatus = method === 'GET' && BILLABLE_STATUS_PATHS.some(pattern => pattern.test(url.pathname))
    const observesSnapshot = method === 'GET' && BILLABLE_SNAPSHOT_PATHS.some(pattern => pattern.test(url.pathname))
    const observesTerminalState = observesStatus || observesSnapshot
    if (!observesTerminalState || !(response.headers.get('content-type') ?? '').includes('json')) return

    const requestKey = `${url.pathname}${url.searchParams.size > 0 ? `?${url.searchParams.toString()}` : ''}`
    void response
        .clone()
        .json()
        .then(payload => {
            const completions = collectTerminalWalletOperations(payload, requestKey)
            const rechargeFailures = collectTerminalWalletFailures(payload, requestKey)
            if (observesSnapshot) {
                const previous = walletCompletionSnapshots.get(requestKey)
                walletCompletionSnapshots.set(requestKey, completions)
                if (previous) {
                    const newCompletions = [...completions].filter(completion => !previous.has(completion))
                    if (newCompletions.length > 0) notifyWalletBalanceInvalidated()
                    const rechargeFailure = newCompletions.map(completion => rechargeFailures.get(completion)).find((message): message is string => !!message)
                    if (rechargeFailure) notifyWalletRechargeRequired(rechargeFailure)
                }
                return
            }

            let hasNewCompletion = false
            let rechargeFailure: string | undefined
            for (const completion of completions) {
                if (observedWalletCompletions.has(completion)) continue
                observedWalletCompletions.add(completion)
                hasNewCompletion = true
                rechargeFailure ??= rechargeFailures.get(completion)
            }
            if (observedWalletCompletions.size > 2_000) observedWalletCompletions.clear()
            if (hasNewCompletion) notifyWalletBalanceInvalidated()
            if (rechargeFailure) notifyWalletRechargeRequired(rechargeFailure)
        })
        .catch(() => {})
}

function logOutlineDiagnostics(input: RequestInfo | URL, method: string, response: Response) {
    if (typeof window === 'undefined' || method !== 'GET' || !response.ok || response.status === 202 || !(response.headers.get('content-type') ?? '').includes('json')) return
    const url = requestUrl(input)
    if (!url || !/^\/api\/ai\/outline\/status\/[^/]+$/.test(url.pathname)) return

    void response
        .clone()
        .json()
        .then(logHiModelsRawResponses)
        .catch(() => {})
}

function showRateLimitToast() {
    const now = Date.now()
    if (now - lastRateLimitToastAt < RATE_LIMIT_TOAST_DEDUPE_MS) return
    lastRateLimitToastAt = now
    pushToast('error', '图片/视频生成请求过于频繁，请稍后再试。')
}

export async function readApiJson(response: Response) {
    const text = await response.text()
    if (!text.trim()) {
        if (response.status === 401) throw new Error('登录状态已失效，请重新登录')
        if (response.status === 429) throw new Error('请求过于频繁，请稍后重试')
        if (response.status === 502 || response.status === 503 || response.status === 504) {
            throw new Error('服务暂时不可用，请稍后重试')
        }
        throw new Error(response.ok ? '服务返回了空结果，请重试' : `请求失败（HTTP ${response.status}），请稍后重试`)
    }
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(response.ok ? '服务返回格式异常，请重试' : `请求失败（HTTP ${response.status}），请稍后重试`)
    }
}

function retryDelayMs(response: Response | null, attempt: number) {
    const raw = response?.headers.get('Retry-After')?.trim()
    if (raw) {
        const seconds = Number(raw)
        if (Number.isFinite(seconds)) return Math.min(15_000, Math.max(0, seconds * 1000))
        const date = Date.parse(raw)
        if (Number.isFinite(date)) return Math.min(15_000, Math.max(0, date - Date.now()))
    }
    return 250 * 2 ** attempt + Math.floor(Math.random() * 180)
}

function retryInput(input: RequestInfo | URL, attempt: number, method: string): RequestInfo | URL {
    if (method !== 'GET' || attempt === 0 || input instanceof Request) return input

    if (input instanceof URL) {
        const url = new URL(input)
        url.searchParams.set('__retry', String(attempt))
        return url
    }

    const separator = input.includes('?') ? '&' : '?'
    return `${input}${separator}__retry=${attempt}`
}

/**
 * Browser fetch that forwards the signed application session to API routes.
 */
export async function clientFetch(input: RequestInfo | URL, init?: ClientFetchInit): Promise<Response> {
    const { timeoutMs = 45_000, suppressRateLimitToast = false, ...fetchInit } = init ?? {}
    const headers = new Headers(fetchInit.headers)
    const token = getAuthToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (typeof window !== 'undefined') headers.set('x-app-locale', localeFromPathname(window.location.pathname))
    if (!headers.has('Content-Type') && fetchInit.body && !(fetchInit.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json')
    }
    const method = (fetchInit.method ?? 'GET').toUpperCase()
    // 失败请求会被网关/浏览器记录下来；重试过多会把一次数据库抖动放大成
    // 一屏 503/504。GET 只做一次快速重试，500（业务/代码错误）不重试，
    // 仅对网关暂时性错误和限流重试。
    const maxAttempts = method === 'GET' ? 2 : 1
    let lastError: unknown
    let retryResponse: Response | null = null

    if (method === 'GET') {
        headers.set('Cache-Control', 'no-cache')
        headers.set('Pragma', 'no-cache')
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const timeoutSignal = AbortSignal.timeout(timeoutMs)
            const signal = fetchInit.signal ? AbortSignal.any([fetchInit.signal, timeoutSignal]) : timeoutSignal
            // QUIC/HTTP3 偶发中断时，使用带重试标记的新 URL，避免浏览器复用失败的请求或缓存条目。
            const response = await fetch(retryInput(input, attempt, method), {
                ...fetchInit,
                headers,
                signal,
                cache: method === 'GET' ? (fetchInit.cache ?? 'no-store') : fetchInit.cache
            })
            logOutlineDiagnostics(input, method, response)
            observeWalletRechargeErrorResponse(response)
            observeWalletResponse(retryInput(input, attempt, method), method, response)
            const retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504
            if (response.status === 401) {
                clearAuthSession()
                redirectToHomepage()
            }
            if (!retryable || attempt === maxAttempts - 1) {
                if (response.status === 429 && !suppressRateLimitToast) showRateLimitToast()
                return response
            }
            retryResponse = response
        } catch (error) {
            lastError = error
            if (fetchInit.signal?.aborted || attempt === maxAttempts - 1) throw error
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs(retryResponse, attempt)))
    }

    throw lastError instanceof Error ? lastError : new Error('请求失败，请稍后重试')
}
