/** Refresh unchanged fields while retaining text edited since the last snapshot. */
export function mergeEditorDraft<T extends object>(draft: T | undefined, previous: T | undefined, saved: T): T {
    if (!draft || !previous) return saved
    const keys = new Set([...Object.keys(previous), ...Object.keys(draft), ...Object.keys(saved)])
    return Object.fromEntries(
        [...keys].map(key => {
            const field = key as keyof T
            return [key, JSON.stringify(draft[field]) !== JSON.stringify(previous[field]) ? draft[field] : saved[field]]
        })
    ) as T
}
