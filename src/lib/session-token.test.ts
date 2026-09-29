import { afterEach, describe, expect, it } from 'vitest'
import { currentSession, currentUserId } from './current-user'
import { issueSessionToken, verifySessionToken } from './session-token'

const originalSecret = process.env.APP_SESSION_SECRET

afterEach(() => {
    if (originalSecret === undefined) delete process.env.APP_SESSION_SECRET
    else process.env.APP_SESSION_SECRET = originalSecret
})

describe('application session token', () => {
    it('derives user identity only from a valid signed bearer token', () => {
        process.env.APP_SESSION_SECRET = 'test-secret-with-enough-randomness'
        const token = issueSessionToken({ userId: '12345', email: 'Admin@Example.com', userType: 2 })
        const request = new Request('https://example.com/api/projects', {
            headers: { authorization: `Bearer ${token}`, 'x-user-id': '99999' }
        })
        expect(currentUserId(request)).toBe(12345n)
        expect(currentSession(request)?.email).toBe('admin@example.com')
    })

    it('rejects forged, expired, and x-user-id-only identities', () => {
        process.env.APP_SESSION_SECRET = 'test-secret-with-enough-randomness'
        const token = issueSessionToken({ userId: '12345', email: 'admin@example.com' }, 1_000)
        expect(verifySessionToken(`${token.slice(0, -1)}x`, 1_001)).toBeNull()
        expect(verifySessionToken(token, 1_000 + 8 * 24 * 60 * 60)).toBeNull()
        expect(currentUserId(new Request('https://example.com', { headers: { 'x-user-id': '12345' } }))).toBeNull()
    })
})
