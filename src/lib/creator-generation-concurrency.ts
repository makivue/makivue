import { localTransactionLock } from '@/lib/local-store'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { newTextJobLease } from '@/lib/text-job-lease'
import type { ProjectAiJobKind } from '@/lib/projectAiJobStore'

export type CreatorGenerationCategory = 'image' | 'video'

// AI 创作台使用自己的任务表和并发池，不读取影视流程的 Generation 表。
export const CREATOR_GENERATION_LIMITS = {
    image: 30,
    video: 20
} as const

const CREATOR_ACTIVE_PHASES = ['generating', 'writing_db'] as const

function creatorJobKind(category: CreatorGenerationCategory): Extract<ProjectAiJobKind, 'creator_image' | 'creator_video'> {
    return category === 'image' ? 'creator_image' : 'creator_video'
}

function categoryLabel(category: CreatorGenerationCategory) {
    return category === 'image' ? '图片' : '视频'
}

export class CreatorGenerationCapacityError extends Error {
    constructor(
        message: string,
        readonly category: CreatorGenerationCategory,
        readonly limit: number,
        readonly reason: 'full' | 'lock_busy'
    ) {
        super(message)
        this.name = 'CreatorGenerationCapacityError'
    }
}

/**
 * Atomically reserves one AI Creator slot for an account.
 *
 * Creator jobs deliberately live in ProjectAiJob with creator-only kinds.
 * Film-production limits use Generation rows, so neither pool can consume the
 * other's capacity. The MySQL lock keeps the creator limit correct across pods.
 */
export async function createCreatorGenerationJob(userId: bigint, category: CreatorGenerationCategory) {
    const kind = creatorJobKind(category)
    const limit = CREATOR_GENERATION_LIMITS[category]
    const lockName = `creator-generation:${userId}:${category}`
    const now = new Date()

    const reservation = await prisma.$transaction(async tx => {
        const rows = await localTransactionLock(lockName)
        if (Number(rows[0]?.acquired ?? 0) !== 1) {
            throw new CreatorGenerationCapacityError(
                `AI 创作台${categoryLabel(category)}任务正在检查可用名额，请稍后重试。`,
                category,
                limit,
                'lock_busy'
            )
        }

        try {
            // Browser polling refreshes the lease for long-running creator
            // videos. Abandoned tabs therefore release their own pool without
            // touching any film-production task.
            await tx.projectAiJob.updateMany({
                where: {
                    projectId: userId,
                    kind,
                    phase: { in: [...CREATOR_ACTIVE_PHASES] },
                    leaseExpiresAt: { lt: now }
                },
                data: {
                    phase: 'error',
                    error: 'AI 创作台任务超时，已自动释放生成名额',
                    activeKey: null,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    updatedAt: now
                }
            })

            const active = await tx.projectAiJob.count({
                where: {
                    projectId: userId,
                    kind,
                    phase: { in: [...CREATOR_ACTIVE_PHASES] }
                }
            })
            if (active >= limit) {
                return { admitted: false as const, active }
            }

            const id = genId()
            await tx.projectAiJob.create({
                data: {
                    id,
                    projectId: userId,
                    kind,
                    phase: 'generating',
                    attempts: 0,
                    progress: 0,
                    total: 1,
                    activeKey: `creator-generation:${userId}:${category}:${id}`,
                    ...newTextJobLease('creator-generation')
                }
            })
            return { admitted: true as const, id: id.toString(), active: active + 1 }
        } finally {
            // The enclosing local-file transaction releases its exclusive workspace lock.
        }
    })

    if (!reservation.admitted) {
        throw new CreatorGenerationCapacityError(
            `AI 创作台${categoryLabel(category)}生成任务已满（${reservation.active}/${limit}），请等待已有任务完成后再试。`,
            category,
            limit,
            'full'
        )
    }
    return { id: reservation.id, active: reservation.active, limit }
}
