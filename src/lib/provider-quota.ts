import { inlineLocalMediaRequest } from '@/lib/local-fetch'
import { providerQuotaBudgets } from '@/lib/provider-quota-policy'
import { tryAcquireProviderQuota, renewProviderQuota, releaseProviderQuota } from '@/lib/provider-quota-store'
import type { TokenUsageProvider } from '@/lib/himodels-token-usage'

type Admission = { waiting: Array<() => void> }
const admissions = new Map<string, Admission>()

async function enterAdmission(key: string, signal?: AbortSignal | null): Promise<() => void> {
    signal?.throwIfAborted()
    const existing = admissions.get(key)
    const state = existing ?? { waiting: [] }
    if (!existing) admissions.set(key, state)
    else
        await new Promise<void>((resolve, reject) => {
            const ready = () => {
                signal?.removeEventListener('abort', abort)
                resolve()
            }
            const abort = () => {
                const index = state.waiting.indexOf(ready)
                if (index >= 0) state.waiting.splice(index, 1)
                reject(signal?.reason ?? new Error('请求已取消'))
            }
            state.waiting.push(ready)
            signal?.addEventListener('abort', abort, { once: true })
        })
    return () => {
        const next = state.waiting.shift()
        if (next) next()
        else admissions.delete(key)
    }
}

function sleep(ms: number, signal?: AbortSignal | null) {
    signal?.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer)
            reject(signal?.reason ?? new Error('请求已取消'))
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort)
            resolve()
        }, ms)
        signal?.addEventListener('abort', abort, { once: true })
    })
}

/** Caps HTTP request concurrency (including body reads) and submission rate, not async video task lifetime. */
export async function fetchWithProviderQuota(url: string, init: RequestInit, context: { provider: TokenUsageProvider; model: string; fetchImpl?: typeof fetch }): Promise<Response> {
    init = await inlineLocalMediaRequest(init)
    const dispatch = context.fetchImpl ?? fetch
    if (process.env.PROVIDER_QUOTA_ENABLED === '0' || (process.env.VITEST && process.env.PROVIDER_QUOTA_ENABLED !== '1')) return dispatch(url, init)
    const budgets = providerQuotaBudgets(url, init, context.provider, context.model)
    const key = budgets.map(budget => budget.key).join(':')
    const waitMs = Math.max(1_000, Math.min(120_000, Number(process.env.PROVIDER_QUOTA_WAIT_MS) || 120_000))
    const deadline = Date.now() + waitMs
    const waiting = AbortSignal.timeout(waitMs)
    const admissionSignal = init.signal ? AbortSignal.any([init.signal, waiting]) : waiting
    const leaveAdmission = await enterAdmission(key, admissionSignal)
    let ids: bigint[] = []
    try {
        while (Date.now() < deadline) {
            admissionSignal.throwIfAborted()
            const attempt = await tryAcquireProviderQuota(budgets)
            if (attempt.ids.length > 0) {
                ids = attempt.ids
                break
            }
            // One waiter per scope and process polls MySQL, without a held connection.
            await sleep(Math.min(10_000, Math.max(250, attempt.retryAfterMs)) + Math.floor(Math.random() * 250), admissionSignal)
        }
        if (ids.length === 0) throw new Error('供应商请求繁忙，等待配额超时，请稍后重试')
    } finally {
        leaveAdmission()
    }
    const controller = new AbortController()
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
    let renewing = false
    const heartbeat = setInterval(() => {
        if (renewing) return
        renewing = true
        void renewProviderQuota(ids)
            .then(renewed => {
                if (!renewed) controller.abort(new Error('供应商配额租约已失效，已停止当前请求'))
            })
            .catch(() => controller.abort(new Error('供应商配额续租失败，已停止当前请求')))
            .finally(() => {
                renewing = false
            })
    }, 15_000)
    heartbeat.unref?.()
    try {
        signal.throwIfAborted()
        const response = await dispatch(url, { ...init, signal })
        let body: BodyInit | null
        try {
            const bytes = await response.arrayBuffer()
            body = response.body === null ? null : bytes
        } catch (error) {
            // Preserve fetch's header/body error boundary so metering still sees
            // the supplier's HTTP status when a billable response is interrupted.
            body = new ReadableStream({
                start(stream) {
                    stream.error(error)
                }
            })
        }
        const buffered = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
        Object.defineProperties(buffered, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } })
        return buffered
    } finally {
        clearInterval(heartbeat)
        // Cleanup must never turn a completed, billable request into a retry.
        await releaseProviderQuota(ids).catch(() => console.warn('[provider-quota] release failed; lease will expire'))
    }
}
