import { getGenerationErrorGuidance } from './generation-error-guidance'

export class ScriptRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly retryable?: boolean
    ) {
        super(message)
    }
}

export interface ScriptBatchIssue {
    episodeId: string
    episodeNumber: number
    attempts: number
    reason: string
    remainingCount: number
}

function canRetryScript(error: unknown, reason: string) {
    if (error instanceof ScriptRequestError && error.retryable === false) return false
    if (error instanceof ScriptRequestError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) return false
    return getGenerationErrorGuidance(reason).kind !== 'credentials'
}

/** Retry each predecessor before moving on; a later episode gets its own budget. */
export async function runScriptBatch<T extends { id: string; episodeNumber: number }>(options: {
    episodes: T[]
    generate: (episode: T) => Promise<void>
    onAttempt: (episode: T) => void
    onComplete: (episode: T) => Promise<void>
    onRetry: (issue: ScriptBatchIssue) => void
}): Promise<ScriptBatchIssue | null> {
    const episodes = [...options.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
    for (const [index, episode] of episodes.entries()) {
        for (let attempts = 1; attempts <= 3; attempts++) {
            options.onAttempt(episode)
            try {
                await options.generate(episode)
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                const issue = { episodeId: episode.id, episodeNumber: episode.episodeNumber, attempts, reason, remainingCount: episodes.length - index - 1 }
                if (attempts === 3 || !canRetryScript(error, reason)) return issue
                options.onRetry(issue)
                await new Promise(resolve => setTimeout(resolve, 3000 * attempts))
                continue
            }
            // A refresh failure must never re-submit an already completed generation.
            await options.onComplete(episode)
            break
        }
    }
    return null
}
