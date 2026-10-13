import type { EpisodeProductionStatus } from './episode-production-status'
import { getPollingDelay } from './polling'

export type ProjectEpisodePollingStatus = {
    status: string
    productionStatus?: EpisodeProductionStatus
    batchPhase?: string | null
}

/** Project details omit production fields; keep snapshots already loaded by the sidebar. */
export function mergeProjectEpisodeSummaries<T extends ProjectEpisodePollingStatus & { id: string }>(episodes: T[], previous: readonly T[]) {
    const previousById = new Map(previous.map(episode => [episode.id, episode]))
    return episodes.map(episode => {
        const cached = previousById.get(episode.id)
        return {
            ...episode,
            productionStatus: episode.productionStatus ?? cached?.productionStatus,
            batchPhase: episode.batchPhase === undefined ? cached?.batchPhase : episode.batchPhase
        }
    })
}

export function hasActiveProjectEpisode(episodes: readonly ProjectEpisodePollingStatus[]) {
    return episodes.some(episode => {
        // A detailed server snapshot overrides older episode/batch labels.
        if (episode.productionStatus) return ['queued', 'generating', 'merging'].includes(episode.productionStatus)
        return episode.batchPhase === 'running' || ['storyboarding', 'generating'].includes(episode.status)
    })
}

/** Poll only live production work; a terminal snapshot leaves no recurring timer. */
export function watchProjectEpisodeStatus<T extends ProjectEpisodePollingStatus>(options: {
    load: (signal: AbortSignal) => Promise<T[]>
    onUpdate: (episodes: T[]) => void
    hasLocalWork: () => boolean
    isTerminalError: (error: unknown) => boolean
    onError: (error: unknown) => void
}) {
    let disposed = false
    let blocked = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight: AbortController | undefined

    function clearTimer() {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
    }

    async function poll() {
        if (disposed || blocked || inFlight || document.visibilityState !== 'visible') return
        clearTimer()
        const controller = new AbortController()
        inFlight = controller
        let continuePolling = false
        try {
            const episodes = await options.load(controller.signal)
            if (disposed) return
            options.onUpdate(episodes)
            failures = 0
            continuePolling = hasActiveProjectEpisode(episodes) || options.hasLocalWork()
        } catch (error) {
            if (disposed) return
            failures += 1
            blocked = options.isTerminalError(error)
            // GET already has one quick retry. Bound background retries as well.
            continuePolling = !blocked && failures < 3
            if (!continuePolling) options.onError(error)
        } finally {
            inFlight = undefined
        }
        if (!disposed && continuePolling && document.visibilityState === 'visible') {
            timer = setTimeout(() => void poll(), getPollingDelay({ baseMs: 20_000, failureCount: failures }))
        }
    }

    function refreshWhenVisible() {
        if (disposed || blocked || document.visibilityState !== 'visible') return
        if (!inFlight) {
            failures = 0
            clearTimer()
            void poll()
        }
    }

    function visibilityChanged() {
        if (document.visibilityState === 'visible') refreshWhenVisible()
        else clearTimer()
    }

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', visibilityChanged)
    void poll()

    return {
        // A local submission or fresh episode detail can reactivate an idle watcher.
        // Ordinary snapshot updates must not bypass an already scheduled delay.
        resume() {
            if (timer === undefined && !inFlight) refreshWhenVisible()
        },
        stop() {
            disposed = true
            clearTimer()
            inFlight?.abort()
            window.removeEventListener('focus', refreshWhenVisible)
            document.removeEventListener('visibilitychange', visibilityChanged)
        }
    }
}
