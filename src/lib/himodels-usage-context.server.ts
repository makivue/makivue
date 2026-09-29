import { AsyncLocalStorage } from 'node:async_hooks'
import type { HiModelsUsageObserver } from './himodels-token-usage'

export type HiModelsUsageScope = { userId?: bigint; jobId?: string; parentJobId?: string; generationId?: string; billingKey?: string; onUsage?: HiModelsUsageObserver }
const usageGlobal = globalThis as typeof globalThis & { hiModelsUsageScope?: AsyncLocalStorage<HiModelsUsageScope> }
const scopeStorage = (usageGlobal.hiModelsUsageScope ??= new AsyncLocalStorage<HiModelsUsageScope>())

export function currentHiModelsUsageScope() {
    return scopeStorage.getStore()
}

/** Bind inside after(), not just around the HTTP handler that schedules it. */
export function withHiModelsUsageScope<T>(scope: HiModelsUsageScope, work: () => T): T {
    const parent = scopeStorage.getStore()
    return scopeStorage.run(
        {
            ...parent,
            ...(parent?.jobId && scope.jobId && scope.jobId !== parent.jobId ? { parentJobId: parent.jobId } : {}),
            ...scope
        },
        work
    )
}
