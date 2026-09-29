import { describe, expect, it } from 'vitest'
import { freshGenerationInstruction, resolveGenerationRequestId } from './generation-request'

describe('generation request identity', () => {
    it('keeps a valid id stable for safe retries', () => {
        expect(resolveGenerationRequestId('request_12345678')).toBe('request_12345678')
    })

    it('creates a fresh id when an older client omits one', () => {
        const first = resolveGenerationRequestId(undefined)
        const second = resolveGenerationRequestId(undefined)
        expect(first).not.toBe(second)
    })

    it('tells providers not to replay an older asset', () => {
        expect(freshGenerationInstruction('request_12345678')).toContain('do not replay or reuse')
    })
})
