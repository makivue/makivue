/** Missing versions support older servers during rollout; known old text is never reused. */
export function isEpisodeContentCurrent(summary: { sourceVersion?: number }, content: { sourceVersion?: number } | undefined): boolean {
    if (!content) return false
    if (summary.sourceVersion === undefined || content.sourceVersion === undefined) return true
    return content.sourceVersion >= summary.sourceVersion
}

/** A newer version may load while an earlier request is still in flight. */
export function createEpisodeContentRequestTracker() {
    const pending = new Map<string, { token: symbol; version?: number }>()
    return {
        start(id: string, version?: number, force = false) {
            if (!force && pending.has(id) && pending.get(id)?.version === version) return null
            const token = Symbol(id)
            pending.set(id, { token, version })
            return token
        },
        isCurrent(id: string, token: symbol) {
            return pending.get(id)?.token === token
        },
        finish(id: string, token: symbol) {
            if (pending.get(id)?.token !== token) return false
            pending.delete(id)
            return true
        },
        clear() {
            pending.clear()
        }
    }
}
