type EpisodeRevision = { id: string; statusVersion?: string }

/** Only server snapshots belong here; optimistic workspace edits must not acquire a server revision. */
export function createEpisodeNavigationLoader<T extends EpisodeRevision>(options: {
    fetchDetail: (id: string) => Promise<T>
    fetchStatus: (id: string) => Promise<{ id: string; version: string }>
    getScope?: () => string | null
}) {
    const entries = new Map<string, { data: T; detailAt: number; prefetchedAt: number | null }>()
    const pending = new Map<string, { token: symbol; promise: Promise<T>; handoff: boolean }>()
    let scope: string | null | undefined
    const prefetchLifetimeMs = 5_000
    const detailLifetimeMs = 120_000

    function request(id: string, mode: 'navigation' | 'prefetch' | 'refresh'): Promise<T> {
        const requestScope = options.getScope?.()
        if (scope !== requestScope) {
            entries.clear()
            pending.clear()
            scope = requestScope
        }
        const cached = entries.get(id)
        if (mode !== 'refresh') {
            const inFlight = pending.get(id)
            if (inFlight) {
                if (mode === 'navigation') inFlight.handoff = false
                return inFlight.promise
            }
            // A hover/touch request can hand its verified result to the destination page.
            if (cached?.prefetchedAt !== null && cached?.prefetchedAt !== undefined && Date.now() - cached.prefetchedAt < prefetchLifetimeMs) {
                if (mode === 'navigation') cached.prefetchedAt = null
                return Promise.resolve(cached.data)
            }
        }

        const token = Symbol(id)
        const promise = Promise.resolve().then(async () => {
            try {
                let data: T | undefined
                if (mode !== 'refresh' && cached?.data.statusVersion && Date.now() - cached.detailAt < detailLifetimeMs) {
                    const status = await options.fetchStatus(id)
                    if (status.id === id && status.version === cached.data.statusVersion) data = cached.data
                }
                data ??= await options.fetchDetail(id)
                if (options.getScope?.() !== requestScope) throw new Error('登录状态已失效，请重新登录')
                if (data.id !== id) throw new Error('服务返回格式异常，请重试')
                if (pending.get(id)?.token === token) {
                    entries.delete(id)
                    entries.set(id, {
                        data,
                        detailAt: data === cached?.data ? cached.detailAt : Date.now(),
                        prefetchedAt: pending.get(id)?.handoff ? Date.now() : null
                    })
                    // Large storyboard payloads should not grow with every episode visited.
                    if (entries.size > 8) entries.delete(entries.keys().next().value!)
                }
                return data
            } finally {
                if (pending.get(id)?.token === token) pending.delete(id)
            }
        })
        pending.set(id, { token, promise, handoff: mode === 'prefetch' })
        return promise
    }

    return {
        load: (id: string) => request(id, 'navigation'),
        prefetch: (id: string) => request(id, 'prefetch'),
        // Mutations and polling deliberately bypass a speculative or older request.
        refresh: (id: string) => request(id, 'refresh')
    }
}
