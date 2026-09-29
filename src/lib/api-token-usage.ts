export type ApiTokenUsage = {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    raw: Record<string, number | string | boolean>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function flattenUsage(value: unknown, prefix = '', output: ApiTokenUsage['raw'] = {}) {
    if (!isRecord(value) && !Array.isArray(value)) return output
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (typeof child === 'number' && Number.isFinite(child)) output[path] = child
        else if (typeof child === 'boolean') output[path] = child
        else if (typeof child === 'string' && /^-?\d+(?:\.\d+)?$/.test(child.trim())) output[path] = child.trim()
        else if (isRecord(child) || Array.isArray(child)) flattenUsage(child, path, output)
    }
    return output
}

function numericUsageValue(usage: ApiTokenUsage['raw'], aliases: string[]) {
    // HiModels may return input_tokens=0 alongside valid prompt_tokens.
    // Use a defined precedence, not the provider's JSON property order, and
    // never add aliases or modality/reasoning breakdowns to the same total.
    let zero: number | null = null
    for (const alias of aliases) {
        const entries = Object.entries(usage).filter(([key]) => key.split('.').at(-1)?.toLowerCase() === alias.toLowerCase() && !/\.\d+\.|details\./i.test(key))
        entries.sort(([a], [b]) => a.split('.').length - b.split('.').length)
        for (const [, value] of entries) {
            const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
            if (Number.isFinite(numeric) && numeric > 0) return numeric
            if (numeric === 0) zero = 0
        }
    }
    return zero
}

/** Only traverse provider/envelope wrappers, never choices, assets or historical jobs. */
export function extractRawTokenUsage(payload: unknown): Record<string, unknown> | null {
    const blocks: Record<string, unknown> = {}
    const visit = (value: unknown, path: string, depth: number) => {
        if (depth > 6) return
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}${index}.`, depth + 1))
            return
        }
        if (!isRecord(value)) return
        for (const key of ['usage', 'usageMetadata', 'usage_metadata', 'tokenUsage', 'token_usage', 'himodelsUsage', 'billing_usage']) {
            if (isRecord(value[key]) || Array.isArray(value[key])) blocks[`${path}${key}`] = value[key]
        }
        const counters = Object.fromEntries(
            Object.entries(value).filter(([key]) =>
                /^(?:(?:prompt|completion|input|output|total)_tokens|(?:prompt|completion|input|output|total)Tokens|(?:prompt|candidates|input|output|total)TokenCount)$/.test(key)
            )
        )
        if (Object.keys(counters).length) blocks[`${path}counters`] = counters
        for (const key of ['data', 'result', 'response', 'output']) visit(value[key], `${path}${key}.`, depth + 1)
    }
    visit(payload, '', 0)
    return Object.keys(blocks).length ? blocks : null
}

/** Inspect only the current response/job envelope, never historical generations. */
export function extractApiTokenUsage(payload: unknown): ApiTokenUsage | null {
    const record = extractRawTokenUsage(payload)
    if (!record) return null
    // Our job/generation summary is authoritative. Its counters already include
    // every upstream operation; legacy result.usage describes only one call.
    const summary = Object.values(record).find(value => isRecord(value) && ['himodels', 'gemini', 'openai', 'azure-openai', 'mixed'].includes(String(value.source)) && typeof value.calls === 'number')
    if (isRecord(summary)) {
        const counter = (key: string) => (typeof summary[key] === 'number' && Number.isFinite(summary[key]) && summary[key] >= 0 ? summary[key] : null)
        const inputTokens = counter('inputTokens'),
            outputTokens = counter('outputTokens'),
            totalTokens = counter('totalTokens')
        return inputTokens === null && outputTokens === null && totalTokens === null ? null : { inputTokens, outputTokens, totalTokens, raw: flattenUsage(summary) }
    }
    // Keep the public raw keys compatible with single usage envelopes.
    const raw = flattenUsage(Object.values(record).length === 1 ? Object.values(record)[0] : record)
    const inputTokens = numericUsageValue(raw, ['prompt_tokens', 'promptTokens', 'promptTokenCount', 'inputTokens', 'input_tokens', 'inputTokenCount'])
    const outputTokens = numericUsageValue(raw, ['completion_tokens', 'completionTokens', 'candidatesTokenCount', 'outputTokens', 'output_tokens', 'outputTokenCount'])
    const reportedTotal = numericUsageValue(raw, ['total_tokens', 'totalTokens', 'totalTokenCount', 'tokens', 'token_count', 'tokenCount'])
    if (inputTokens === null && outputTokens === null && reportedTotal === null) return null
    return { inputTokens, outputTokens, totalTokens: reportedTotal ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null), raw }
}
