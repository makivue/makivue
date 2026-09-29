import { describe, expect, it } from 'vitest'
import { genId, getSonyflakeMachineId } from './id'

describe('Sonyflake ids', () => {
    it('keeps ids unique across rapid calls and encodes the effective machine id', () => {
        const machineId = BigInt(getSonyflakeMachineId().machineId)
        const ids = Array.from({ length: 1_000 }, () => genId())
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.every(id => id > 0n && (id & 65_535n) === machineId)).toBe(true)
    })
})
