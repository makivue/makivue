import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
import { withActiveOutlineWrite } from './outline-persistence-guard'

describe('outline checkpoint reset protection', () => {
    beforeEach(() => vi.resetAllMocks())

    it.each(['reset', 'cancelled', 'deleted'] as const)('rejects a delayed outline write after %s', async state => {
        const tx = {
            $queryRaw: vi.fn(),
            project: { findUnique: vi.fn().mockResolvedValue({ operationVersion: state === 'reset' ? 2 : 1, deletedAt: state === 'deleted' ? new Date() : null }) },
            outlineJob: { findFirst: vi.fn().mockResolvedValue(state === 'cancelled' ? null : { id: 3n }) }
        }
        mocks.transaction.mockImplementation(callback => callback(tx))
        const write = vi.fn()
        await expect(withActiveOutlineWrite(1n, 1, '3', write)).rejects.toThrow('停止写入')
        expect(write).not.toHaveBeenCalled()
    })

    it('persists an active checkpoint within the locked transaction', async () => {
        const tx = {
            $queryRaw: vi.fn(),
            project: { findUnique: vi.fn().mockResolvedValue({ operationVersion: 1, deletedAt: null }) },
            outlineJob: { findFirst: vi.fn().mockResolvedValue({ id: 3n }) }
        }
        mocks.transaction.mockImplementation(callback => callback(tx))
        const write = vi.fn().mockResolvedValue('saved')
        expect(await withActiveOutlineWrite(1n, 1, '3', write)).toBe('saved')
        expect(write).toHaveBeenCalledWith(tx)

    })
})
