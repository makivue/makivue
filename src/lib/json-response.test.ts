import { describe, expect, it } from 'vitest'
import { extractBalancedJsonObjects } from './json-response'

describe('extractBalancedJsonObjects', () => {
    it('separates concatenated JSON objects', () => {
        const raw = '{"chapters":[{"chapterNumber":1}]}{"chapters":[{"chapterNumber":2}]}'
        expect(extractBalancedJsonObjects(raw)).toEqual(['{"chapters":[{"chapterNumber":1}]}', '{"chapters":[{"chapterNumber":2}]}'])
    })

    it('ignores braces and escaped quotes inside JSON strings', () => {
        const raw = '说明：{"synopsis":"门上写着 \\"{不要进入}\\"","value":{"ok":true}} trailing'
        expect(extractBalancedJsonObjects(raw)).toEqual(['{"synopsis":"门上写着 \\"{不要进入}\\"","value":{"ok":true}}'])
    })

    it('does not return an incomplete object', () => {
        expect(extractBalancedJsonObjects('{"chapters":[')).toEqual([])
    })
})
