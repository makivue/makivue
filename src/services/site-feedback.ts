import 'server-only'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { feedbackQuota, type FeedbackAttachment } from '@/lib/site-feedback'
import type { Prisma } from '@/generated/prisma/client'

type FeedbackInput = { userId: bigint; email: string; content: string; pageName: string; attachments: FeedbackAttachment[] }

function timestamps(value: unknown): number[] {
    if (!Array.isArray(value) || value.some(item => !Number.isFinite(item))) throw new Error('Invalid feedback cooldown')
    return value as number[]
}

export async function readFeedbackQuota(userId: bigint) {
    const row = await prisma.siteFeedbackCooldown.findUnique({ where: { userId } })
    return feedbackQuota(row ? timestamps(row.submissions) : [], Date.now())
}

export async function submitSiteFeedback(input: FeedbackInput) {
    // The file-store transaction serializes quota checks and saves together.
    return prisma.$transaction(async tx => {
        const row = await tx.siteFeedbackCooldown.findUnique({ where: { userId: input.userId } })
        const now = new Date()
        const quota = feedbackQuota(row ? timestamps(row.submissions) : [], now.getTime())
        if (!quota.allowed) return { status: 'rate-limited' as const, retryAfterSeconds: quota.retryAfterSeconds }
        const feedback = await tx.siteFeedback.create({
            data: { id: genId(), ...input, attachments: input.attachments as Prisma.InputJsonValue, createdAt: now, updatedAt: now },
            select: { id: true }
        })
        const submissions = [...quota.timestamps, now.getTime()]
        await tx.siteFeedbackCooldown.upsert({ where: { userId: input.userId }, create: { userId: input.userId, submissions }, update: { submissions } })
        return { status: 'created' as const, id: feedback.id.toString(), retryAfterSeconds: feedbackQuota(submissions, now.getTime()).retryAfterSeconds }
    })
}
