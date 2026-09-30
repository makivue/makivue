import { describe, expect, it } from 'vitest'
import { applyCharacterReferenceResult } from './character-reference-result'

const sheet = (url: string, status = 'candidate') => ({ id: `asset:${url}`, role: 'full_body', stateKey: null, url, status, promptVersion: 'turnaround-sheet-v12' })
const character = {
    id: '101',
    name: '角色 A',
    referenceImageUrl: null as string | null,
    referenceCandidates: null as string | null,
    referenceAssetRows: [] as ReturnType<typeof sheet>[]
}
const result = {
    targetType: 'character' as const,
    targetId: '101',
    candidateUrl: '/new.png',
    referenceImageUrl: '/new.png',
    referenceCandidates: ['/new.png'],
    role: 'full_body',
    promptVersion: 'turnaround-sheet-v12'
}

describe('completed character reference results', () => {
    it('makes the first completed sheet renderable while other characters are unfinished', () => {
        const waitingCharacter = { ...character, id: '102', name: '角色 B' }
        const characters = [character, waitingCharacter].map(item => applyCharacterReferenceResult(item, 'job-1', result))

        expect(characters[0].referenceImageUrl).toBe('/new.png')
        expect(characters[0].referenceAssetRows).toEqual([expect.objectContaining({ url: '/new.png', status: 'selected', promptVersion: 'turnaround-sheet-v12' })])
        expect(characters[1]).toBe(waitingCharacter)
        expect(character.referenceAssetRows).toEqual([])
    })

    it('adds a regenerated candidate immediately and retains the approved image and earlier candidates', () => {
        const current = { ...character, referenceImageUrl: '/approved.png', referenceAssetRows: [sheet('/approved.png', 'selected'), sheet('/earlier.png')] }
        const updated = applyCharacterReferenceResult(current, 'job-1', {
            ...result,
            referenceImageUrl: '/approved.png',
            referenceCandidates: ['/new.png', '/approved.png', '/earlier.png']
        })

        expect(updated.referenceImageUrl).toBe('/approved.png')
        expect(updated.referenceAssetRows.map(asset => [asset.url, asset.status])).toEqual([
            ['/new.png', 'candidate'],
            ['/approved.png', 'selected'],
            ['/earlier.png', 'candidate']
        ])
        expect(JSON.parse(updated.referenceCandidates!)).toEqual(['/new.png', '/approved.png', '/earlier.png'])
    })

    it('updates the selected sheet when the completed job replaces it', () => {
        const current = { ...character, referenceImageUrl: '/old.png', referenceAssetRows: [sheet('/old.png', 'selected')] }
        const updated = applyCharacterReferenceResult(current, 'job-1', result)

        expect(updated.referenceImageUrl).toBe('/new.png')
        expect(updated.referenceAssetRows.map(asset => [asset.url, asset.status])).toEqual([
            ['/new.png', 'selected'],
            ['/old.png', 'candidate']
        ])
    })

    it('preserves a newer manual selection while still displaying the completed image', () => {
        const current = { ...character, referenceImageUrl: '/manual.png', referenceAssetRows: [sheet('/manual.png', 'selected')] }
        const updated = applyCharacterReferenceResult(current, 'job-1', result, true)

        expect(updated.referenceImageUrl).toBe('/manual.png')
        expect(updated.referenceAssetRows.map(asset => [asset.url, asset.status])).toEqual([
            ['/new.png', 'candidate'],
            ['/manual.png', 'selected']
        ])
    })

    it('does not duplicate a result already loaded by a project refresh', () => {
        const current = { ...character, referenceImageUrl: '/new.png', referenceAssetRows: [sheet('/new.png', 'selected')] }
        const once = applyCharacterReferenceResult(current, 'job-1', result)
        const twice = applyCharacterReferenceResult(once, 'job-1', result)

        expect(twice.referenceAssetRows).toHaveLength(1)
        expect(twice.referenceAssetRows[0].id).toBe('asset:/new.png')
    })
})
