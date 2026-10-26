import { describe, expect, it } from 'vitest'
import { parseCreatorMergeInput } from './creator-video-merge'

const input = { assetIds: ['11', '12'], ratio: '9:16', title: ' My video ', requestKey: 'ecfd7869-8a98-44bf-99a8-68e4d6e7bc0f' }

describe('creator merge input validation', () => {
    it('preserves clip order and trims the title', () => {
        expect(parseCreatorMergeInput({ ...input, assetIds: ['12', '11'] })).toEqual({ ...input, assetIds: ['12', '11'], title: 'My video' })
    })
    it.each([
        null,
        { ...input, assetIds: ['11'] },
        { ...input, assetIds: Array.from({ length: 21 }, (_, i) => String(i + 1)) },
        { ...input, assetIds: ['11', '11'] },
        { ...input, assetIds: ['11', 'invalid'] },
        { ...input, assetIds: [11, 12] },
        { ...input, title: '' },
        { ...input, title: 'x'.repeat(121) },
        { ...input, ratio: ['9:16'] },
        { ...input, requestKey: 'untrusted' }
    ])('rejects invalid submissions: %j', raw => {
        expect(() => parseCreatorMergeInput(raw)).toThrow()
    })
})
