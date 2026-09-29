import { describe, expect, it } from 'vitest'
import { issueDestructiveOperationToken, verifyDestructiveOperationToken } from './destructive-operation-token'

describe('destructive operation tokens', () => {
    it('binds the token to project, version, scope and expiry', () => {
        const token = issueDestructiveOperationToken({ projectId: 7n, operationVersion: 3, scope: 'outline-reset' }, 100)
        expect(verifyDestructiveOperationToken(token, { projectId: 7n, operationVersion: 3, scope: 'outline-reset' }, 200)).toBe(true)
        expect(verifyDestructiveOperationToken(token, { projectId: 7n, operationVersion: 4, scope: 'outline-reset' }, 200)).toBe(false)
        expect(verifyDestructiveOperationToken(token, { projectId: 7n, operationVersion: 3, scope: 'other' }, 200)).toBe(false)
        expect(verifyDestructiveOperationToken(token, { projectId: 7n, operationVersion: 3, scope: 'outline-reset' }, 701)).toBe(false)
    })
})
