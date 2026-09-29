import type { ApiTokenUsage } from './api-token-usage'
import type { ModelCallBilling } from '@/services/model-call-billing'

export type TokenUsageProvider = 'himodels' | 'gemini' | 'openai' | 'azure-openai' | 'qwen' | 'volcengine' | 'kling'

export type HiModelsUsageCall = {
    id: string
    provider?: TokenUsageProvider
    model: string
    usage: ApiTokenUsage | null
    operationKey?: string
    endpoint?: string
    status?: number | null
    captureState?: string
    requestId?: string | null
    rawUsage?: unknown
    sentAt?: string
    receivedAt?: string | null
    billing?: ModelCallBilling
}
export type HiModelsUsageObserver = (call: HiModelsUsageCall) => void | Promise<void>
export type ProviderTokenUsageCall = HiModelsUsageCall
export type ProviderTokenUsageObserver = HiModelsUsageObserver
export type HiModelsUsageSummary = {
    source: 'himodels'
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    calls: number
    callsWithUsage: number
    missingUsageCalls: number
    operations: number
    missingUsageOperations: number
    incompleteCaptureCalls: number
    complete: boolean
    models: string[]
}

export type ProviderTokenUsageSummary = Omit<HiModelsUsageSummary, 'source'> & {
    source: TokenUsageProvider | 'mixed'
    providers: TokenUsageProvider[]
}

function summarizeCalls(records: HiModelsUsageCall[]) {
    const operations = new Map<string, ApiTokenUsage | null>()
    for (const call of [...records].sort((a, b) => (a.receivedAt ?? a.sentAt ?? '').localeCompare(b.receivedAt ?? b.sentAt ?? ''))) {
        const key = call.operationKey ?? call.id
        const previous = operations.get(key)
        if (!call.usage) {
            if (!operations.has(key)) operations.set(key, null)
            continue
        }
        operations.set(key, {
            inputTokens: call.usage.inputTokens ?? previous?.inputTokens ?? null,
            outputTokens: call.usage.outputTokens ?? previous?.outputTokens ?? null,
            totalTokens: call.usage.totalTokens ?? previous?.totalTokens ?? null,
            raw: { ...previous?.raw, ...call.usage.raw }
        })
    }
    const valuesByOperation = [...operations.values()]
    const sum = (key: 'inputTokens' | 'outputTokens' | 'totalTokens') => {
        const values = valuesByOperation.flatMap(usage => (typeof usage?.[key] === 'number' ? [usage[key]!] : []))
        return values.length ? values.reduce((total, value) => total + value, 0) : null
    }
    const callsWithUsage = records.filter(call => call.usage !== null).length
    const incompleteCaptureCalls = records.filter(call => call.captureState === 'pending' || call.captureState === 'body_error').length
    return {
        inputTokens: sum('inputTokens'),
        outputTokens: sum('outputTokens'),
        totalTokens: sum('totalTokens'),
        calls: records.length,
        callsWithUsage,
        missingUsageCalls: records.length - callsWithUsage,
        operations: operations.size,
        missingUsageOperations: valuesByOperation.filter(usage => usage === null).length,
        incompleteCaptureCalls,
        complete: incompleteCaptureCalls === 0 && operations.size > 0 && valuesByOperation.every(usage => usage?.inputTokens != null && usage.outputTokens != null && usage.totalTokens != null),
        models: [...new Set(records.map(call => call.model))]
    }
}

/** Aggregate direct-provider and HiModels calls without mislabelling their source. */
export function createProviderTokenUsageCollector() {
    const calls = new Map<string, ProviderTokenUsageCall>()
    const snapshot = (): { tokenUsage: ProviderTokenUsageSummary; tokenUsageCalls: ProviderTokenUsageCall[] } => {
        const records = [...calls.values()]
        const providers = [...new Set(records.map(call => call.provider ?? 'himodels'))]
        return {
            tokenUsage: {
                source: providers.length === 1 ? providers[0] : 'mixed',
                providers,
                ...summarizeCalls(records)
            },
            tokenUsageCalls: records
        }
    }
    return {
        record(call: ProviderTokenUsageCall) {
            calls.set(call.id, call)
        },
        snapshot
    }
}
