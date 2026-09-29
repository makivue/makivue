import type { NextRequest } from 'next/server'
import { bearerToken, verifySessionToken, type AppSession } from './session-token'

/**
 * Verify the application Bearer token and derive the identity from its signed
 * payload. x-user-id is deliberately ignored because clients can forge it.
 */
export function currentUserId(req: NextRequest | Request): bigint | null {
    return currentSession(req)?.userId ?? null
}

export function currentSession(req: NextRequest | Request): AppSession | null {
    const token = bearerToken(req)
    return token ? verifySessionToken(token) : null
}
