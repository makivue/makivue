import { describe, expect, it } from 'vitest'
import { findObsoleteExtractedEntityIds, shouldReplaceExtractedCollection } from './extract-commit-policy'

describe('extract commit overwrite policy', () => {
    it('replaces a collection when at least one selected item uses overwrite', () => {
        expect(shouldReplaceExtractedCollection([{ mode: 'add' }, { mode: 'overwrite' }])).toBe(true)
        expect(shouldReplaceExtractedCollection([{ mode: 'add' }, { mode: 'merge' }])).toBe(false)
    })

    it('removes active entities not retained by an overwrite commit', () => {
        const existing = [{ id: 1n }, { id: 2n }, { id: 3n }]
        expect(findObsoleteExtractedEntityIds(existing, new Set([2n, 3n]), true)).toEqual([1n])
    })

    it('never removes old entities during add or merge commits', () => {
        expect(findObsoleteExtractedEntityIds([{ id: 1n }], new Set<bigint>(), false)).toEqual([])
    })
})
