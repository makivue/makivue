import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
import { StaleReferenceMutationError, withActiveReferenceWrite } from './reference-persistence-guard'

describe('reference image late-result protection', () => {
    const source = { type: 'character' as const, id: 2n, projectId: 1n, operationVersion: 4, projectOperationVersion: 7, jobId: '9' }
    function transaction() {
        return {
            $queryRaw: vi.fn(),
            project: { findFirst: vi.fn().mockResolvedValue({ operationVersion: 7 }) },
            character: { findUnique: vi.fn().mockResolvedValue({ projectId: 1n, operationVersion: 4, deletedAt: null }) },
            scene: { findUnique: vi.fn().mockResolvedValue({ projectId: 1n, operationVersion: 4, deletedAt: null }) },
            refImageJob: { findFirst: vi.fn().mockResolvedValue({ id: 9n }) }
        }
    }
    beforeEach(() => vi.clearAllMocks())

    it.each(['character', 'scene'] as const)('commits an active %s result only after locking and matching its target', async type => {
        const tx = transaction()
        mocks.transaction.mockImplementation(callback => callback(tx))
        const write = vi.fn().mockResolvedValue('saved')
        expect(await withActiveReferenceWrite({ ...source, type }, write)).toBe('saved')
        expect(write).toHaveBeenCalledWith(tx)
        expect(tx.refImageJob.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: 9n, targetType: type, targetId: 2n, projectId: 1n, phase: { in: ['generating', 'running', 'writing_db'] } }) })
        )

    })

    it.each(['cancelled', 'edited', 'deleted', 'projectEdited', 'projectDeleted'])('discards a result after %s without touching reference selections', async reason => {
        const tx = transaction()
        if (reason === 'cancelled') tx.refImageJob.findFirst.mockResolvedValue(null)
        if (reason === 'edited') tx.character.findUnique.mockResolvedValue({ projectId: 1n, operationVersion: 5, deletedAt: null })
        if (reason === 'deleted') tx.character.findUnique.mockResolvedValue(null)
        if (reason === 'projectEdited') tx.project.findFirst.mockResolvedValue({ operationVersion: 8 })
        if (reason === 'projectDeleted') tx.project.findFirst.mockResolvedValue(null)
        mocks.transaction.mockImplementation(callback => callback(tx))
        const write = vi.fn()
        await expect(withActiveReferenceWrite(source, write)).rejects.toBeInstanceOf(StaleReferenceMutationError)
        expect(write).not.toHaveBeenCalled()
    })
})
