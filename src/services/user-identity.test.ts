import { beforeEach, describe, expect, it, vi } from 'vitest'

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userIdentity: { upsert }
    }
}))

import { recordGoogleUserIdentity } from './user-identity'

describe('recordGoogleUserIdentity', () => {
    beforeEach(() => {
        upsert.mockReset()
        upsert.mockResolvedValue({ displayName: 'Alice', avatarUrl: 'https://example.com/avatar.png' })
    })

    it('creates or refreshes the verified Google identity snapshot', async () => {
        await recordGoogleUserIdentity(42n, {
            subject: 'google-user-123',
            email: ' ALICE@EXAMPLE.COM ',
            displayName: ' Alice ',
            avatarUrl: 'https://example.com/avatar.png'
        })

        expect(upsert).toHaveBeenCalledOnce()
        expect(upsert).toHaveBeenCalledWith({
            where: {
                userId_provider: {
                    userId: 42n,
                    provider: 'google'
                }
            },
            create: expect.objectContaining({
                userId: 42n,
                provider: 'google',
                providerSubject: 'google-user-123',
                email: 'alice@example.com',
                emailVerified: true,
                displayName: 'Alice',
                avatarUrl: 'https://example.com/avatar.png',
                lastLoginAt: expect.any(Date)
            }),
            update: expect.objectContaining({
                providerSubject: 'google-user-123',
                email: 'alice@example.com',
                emailVerified: true,
                displayName: 'Alice',
                avatarUrl: 'https://example.com/avatar.png',
                lastLoginAt: expect.any(Date)
            }),
            select: {
                displayName: true,
                avatarUrl: true
            }
        })
    })

    it('stores missing optional claims as null on create without clearing an existing identity snapshot', async () => {
        await recordGoogleUserIdentity(7n, {
            subject: 'google-user-456',
            email: 'user@example.com'
        })

        const args = upsert.mock.calls[0]?.[0]
        expect(args.create).toEqual(expect.objectContaining({ displayName: null, avatarUrl: null }))
        expect(args.update).not.toHaveProperty('displayName')
        expect(args.update).not.toHaveProperty('avatarUrl')
    })
})
