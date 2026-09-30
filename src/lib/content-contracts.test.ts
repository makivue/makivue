import { describe, expect, it } from 'vitest'
import { countContentUnits, getChapterMinimumUnits, validateOutlineContract } from './content-contracts'

describe('basic content validation', () => {
    it('counts CJK characters and words for advisory length display', () => {
        expect(countContentUnits('你好 world again')).toBe(4)
        expect(getChapterMinimumUnits(2000)).toBe(1700)
    })
    it('accepts short outlines without narrative quality gates', () => {
        expect(validateOutlineContract([{ chapterNumber: 1, title: 'A key', synopsis: 'Amara finds a key.' }], [1])).toEqual([])
    })
    it('still rejects missing, duplicate, out-of-range and empty outline fields', () => {
        const issues = validateOutlineContract(
            [
                { chapterNumber: 1, title: '', synopsis: '' },
                { chapterNumber: 1, title: 'Key', synopsis: 'Found' },
                { chapterNumber: 3, title: 'End', synopsis: 'End' }
            ],
            [1, 2]
        )
        expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['required', 'duplicate', 'range', 'missing_chapter']))
        expect(validateOutlineContract([null] as never, [1]).length).toBeGreaterThan(0)
    })
})
