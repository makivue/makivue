import { prisma } from '@/lib/prisma'
import { normalizeProfileAvatarUrl, normalizeProfileDisplayName } from '@/lib/profile'

const GOOGLE_PROVIDER = 'google'

type GoogleIdentityClaims = {
    subject: string
    email: string
    displayName?: string
    avatarUrl?: string
}

export async function recordGoogleUserIdentity(userId: bigint, google: GoogleIdentityClaims) {
    const email = google.email.trim().toLowerCase()
    const displayName = normalizeProfileDisplayName(google.displayName)
    const avatarUrl = normalizeProfileAvatarUrl(google.avatarUrl)
    const lastLoginAt = new Date()

    return prisma.userIdentity.upsert({
        where: {
            userId_provider: {
                userId,
                provider: GOOGLE_PROVIDER
            }
        },
        create: {
            userId,
            provider: GOOGLE_PROVIDER,
            providerSubject: google.subject,
            email,
            emailVerified: true,
            displayName,
            avatarUrl,
            lastLoginAt
        },
        update: {
            providerSubject: google.subject,
            email,
            emailVerified: true,
            ...(displayName ? { displayName } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            lastLoginAt
        },
        select: {
            displayName: true,
            avatarUrl: true
        }
    })
}
