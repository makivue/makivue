import type { AppSession } from './session-token'

/** One workspace belongs to the current machine; cloud identity is not used. */
export function currentUserId(_request: Request): bigint {
    void _request

    return 1n
}
export function currentSession(_request: Request): AppSession {
    void _request

    return { userId: 1n, email: 'local@localhost', userType: 1, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }
}
