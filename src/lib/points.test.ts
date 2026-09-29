import { describe, expect, it } from 'vitest'
import { formatPointAmount, formatPointBalance, wholePointAmount, wholePointBalance } from './points'

describe('whole wallet coins', () => {
    it.each([
        [1234.9, 1234],
        [8, 8],
        [0.1, 0]
    ])('rounds spendable balance %s down to %s', (value, expected) => {
        expect(wholePointBalance(value)).toBe(expected)
    })

    it.each([
        [34.38, 35],
        [-34.38, -35],
        [8, 8]
    ])('rounds ledger amount %s away from zero to %s', (value, expected) => {
        expect(wholePointAmount(value)).toBe(expected)
    })

    it('formats balances and signed ledger amounts without decimals', () => {
        expect(formatPointBalance(1234.9, 'en')).toBe('1,234')
        expect(formatPointAmount(-34.38, 'en')).toBe('-35')
    })
})
