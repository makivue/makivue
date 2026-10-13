import { AsyncLocalStorage } from 'node:async_hooks'
import { GENERATION_MAX_RETRIES } from './generation-retry-policy'

export type GenerationRetryBudget = { remaining: number }
const retryStorage = new AsyncLocalStorage<GenerationRetryBudget>()

/** Transport recovery and editorial repairs of the same content share one retry. */
export function withGenerationRetryBudget<T>(work: () => T, budget?: GenerationRetryBudget): T {
    return retryStorage.run(budget ?? retryStorage.getStore() ?? { remaining: GENERATION_MAX_RETRIES }, work)
}

export function generationRetriesRemaining(): number {
    return retryStorage.getStore()?.remaining ?? GENERATION_MAX_RETRIES
}

export function takeAutomaticGenerationRetry(): void {
    const budget = retryStorage.getStore()
    if (budget && budget.remaining <= 0) throw new Error('生成已达到一次自动重试的上限，请手动重试')
    if (budget) budget.remaining -= 1
}
