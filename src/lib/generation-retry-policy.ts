// One initial attempt plus at most one automatic retry. Callers with their own
// retry loop must disable transport retries to avoid multiplying attempts.
export const GENERATION_MAX_RETRIES = 1
export const GENERATION_MAX_ATTEMPTS = 1 + GENERATION_MAX_RETRIES

export function generationAttemptLimit(requested = GENERATION_MAX_ATTEMPTS): number {
    return Number.isFinite(requested) ? Math.max(1, Math.min(GENERATION_MAX_ATTEMPTS, Math.floor(requested))) : GENERATION_MAX_ATTEMPTS
}

/** Shared by image quality, provider fallback and transport recovery. */
export type GenerationAttemptBudget = { remaining: number }

export function takeGenerationAttempt(budget: GenerationAttemptBudget): void {
    if (budget.remaining <= 0) throw new Error('生成已达到一次自动重试的上限，请手动重试')
    budget.remaining -= 1
}
