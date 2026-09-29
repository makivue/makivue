export function shouldReplaceExtractedCollection(items: ReadonlyArray<{ mode?: unknown }>): boolean {
    return items.some(item => item.mode === 'overwrite')
}

export function findObsoleteExtractedEntityIds<T>(existing: ReadonlyArray<{ id: T }>, retainedIds: ReadonlySet<T>, replace: boolean): T[] {
    if (!replace) return []
    return existing.filter(entity => !retainedIds.has(entity.id)).map(entity => entity.id)
}
