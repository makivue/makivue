import { describe, expect, it } from 'vitest'
import { parseApiId, parseApiIds } from './api-id'

describe('API ids', () => {
    it('accepts canonical signed BIGINT positive ids', () => {
        expect(parseApiId('123')).toBe(123n)
        expect(parseApiId('9223372036854775807')).toBe(9223372036854775807n)
    })

    it('rejects malformed and out-of-range ids without throwing', () => {
        for (const value of ['', '0', '-1', '1.0', ' 1x', '9223372036854775808', null]) {
            expect(parseApiId(value)).toBeNull()
        }
        expect(parseApiIds(['1', 'bad'])).toBeNull()
    })
})
