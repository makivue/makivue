import { createHash } from 'node:crypto'
import type { TokenUsageProvider } from '@/lib/himodels-token-usage'
import { meterModelRequest } from '@/lib/model-pricing'

interface ProviderQuotaRule {
    concurrency: number
    requestsPerMinute: number
    tokensPerMinute?: number
}
export interface ProviderQuotaBudget extends ProviderQuotaRule {
    key: string
    tokens: number
}

function rule(value: unknown, fallback: ProviderQuotaRule): ProviderQuotaRule {
    if (value === undefined) return fallback
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROVIDER_QUOTAS_JSON 配额格式无效')
    const record = value as Record<string, unknown>
    const result = { ...fallback }
    for (const key of ['concurrency', 'requestsPerMinute', 'tokensPerMinute'] as const) {
        if (record[key] === undefined) continue
        const number = Number(record[key])
        if (!Number.isSafeInteger(number) || number < 1) throw new Error(`PROVIDER_QUOTAS_JSON ${key} 必须是正整数`)
        result[key] = number
    }
    return result
}

export function providerQuotaBudgets(url: string, init: RequestInit, provider: TokenUsageProvider, model: string, settings = process.env.PROVIDER_QUOTAS_JSON): ProviderQuotaBudget[] {
    let config: Record<string, unknown> = {}
    if (settings?.trim()) {
        try {
            config = JSON.parse(settings)
        } catch {
            throw new Error('PROVIDER_QUOTAS_JSON 不是有效 JSON')
        }
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('PROVIDER_QUOTAS_JSON 必须是配置对象')
    }
    const endpoint = new URL(url)
    const headers = new Headers(init.headers)
    // Vertex bearer tokens rotate; its project remains the quota principal.
    const vertexProject = provider === 'gemini' ? endpoint.pathname.match(/\/projects\/([^/]+)/)?.[1] : undefined
    let credential = vertexProject
        ? `vertex-project:${vertexProject}`
        : (headers.get('authorization') ?? headers.get('api-key') ?? headers.get('x-goog-api-key') ?? endpoint.searchParams.get('key') ?? endpoint.origin)
    if (provider === 'kling' && /^Bearer /i.test(credential)) {
        try {
            // Our server mints a fresh JWT for each Kling request. Its issuer
            // is the stable access key; exp/nbf and the signature rotate.
            const payload = JSON.parse(Buffer.from(credential.slice(7).split('.')[1], 'base64url').toString('utf8'))
            if (typeof payload.iss === 'string' && payload.iss) credential = `kling-access:${payload.iss}`
        } catch {
            // Invalid tokens will be rejected by the supplier; still rate-limit them.
        }
    }
    const principal = createHash('sha256').update(`${provider}:${credential}`).digest('hex')
    const polling = (init.method ?? 'GET').toUpperCase() === 'GET'
    const normalizedModel = model.replace(/^gemini:/, '')
    const names = polling ? [`${provider}:poll`] : [provider, `${provider}:${normalizedModel}`]
    return names
        .map((name, index) => {
            const defaults = polling ? { concurrency: 32, requestsPerMinute: 600 } : index === 0 ? { concurrency: 16, requestsPerMinute: 120 } : { concurrency: 8, requestsPerMinute: 60 }
            const limits = rule(config[name], defaults)
            let tokens = 0
            if (!polling && limits.tokensPerMinute) {
                if (typeof init.body !== 'string') throw new Error('Token 配额需要 JSON 模型请求')
                let body: unknown
                try {
                    body = JSON.parse(init.body)
                } catch {
                    throw new Error('Token 配额需要 JSON 模型请求')
                }
                const meter = meterModelRequest(body)
                tokens = Math.ceil(meter.inputTokenBudget + meter.maxOutputTokens)
                if (tokens > limits.tokensPerMinute) throw new Error('单次模型请求的 Token 预算超过供应商分钟配额，请缩短输入或调整配额')
            }
            return { key: createHash('sha256').update(`${principal}:${name}`).digest('hex'), ...limits, tokens }
        })
        .sort((left, right) => left.key.localeCompare(right.key))
}
