import { describe, expect, it, vi } from 'vitest'
import { isPrimaryKeyP2002, retryP2002 } from './jobStoreRetry'

function p2002(target?: string) {
    return Object.assign(new Error(target ? `Unique constraint failed on the constraint: ${target}` : 'Unique constraint failed'), {
        code: 'P2002',
        meta: target === undefined ? undefined : { target }
    })
}

describe('retryP2002', () => {
    it('reissues ids after PRIMARY collisions with randomized backoff', async () => {
        const create = vi.fn().mockRejectedValueOnce(p2002('PRIMARY')).mockRejectedValueOnce(p2002('PRIMARY')).mockResolvedValue('created')
        const delays: number[] = []
        await expect(
            retryP2002(create, 'test.create', {
                sleep: async delay => {
                    delays.push(delay)
                },
                randomDelayMs: attempt => 10 + attempt
            })
        ).resolves.toBe('created')
        expect(create).toHaveBeenCalledTimes(3)
        expect(delays).toEqual([10, 11])
    })

    it('does not retry an active-key collision that the caller must deduplicate', async () => {
        const error = p2002('uk_ref_image_job_active_key')
        const create = vi.fn().mockRejectedValue(error)
        await expect(retryP2002(create, 'test.create', { sleep: vi.fn() })).rejects.toBe(error)
        expect(create).toHaveBeenCalledTimes(1)
    })

    it('retains a safe retry for drivers that omit the conflicting target', async () => {
        const create = vi.fn().mockRejectedValueOnce(p2002()).mockResolvedValue('created')
        await expect(retryP2002(create, 'test.create', { sleep: async () => undefined, randomDelayMs: () => 1 })).resolves.toBe('created')
        expect(create).toHaveBeenCalledTimes(2)
    })

    it('recognizes formatted PRIMARY errors and ignores other failures', () => {
        expect(isPrimaryKeyP2002(p2002('PRIMARY'))).toBe(true)
        expect(isPrimaryKeyP2002(Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['id'] } }))).toBe(true)
        expect(
            isPrimaryKeyP2002(
                Object.assign(new Error('Unique constraint failed'), {
                    code: 'P2002',
                    meta: { driverAdapterError: { cause: { constraint: { index: 'PRIMARY' } } } }
                })
            )
        ).toBe(true)
        expect(isPrimaryKeyP2002(Object.assign(new Error('Unique constraint failed on the constraint: PRIMARY'), { code: 'P2002' }))).toBe(true)
        expect(isPrimaryKeyP2002(p2002('active_key'))).toBe(false)
        expect(isPrimaryKeyP2002(new Error('PRIMARY'))).toBe(false)
    })
})
