import { localTransactionLock } from '@/lib/local-store'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { newTextJobLease } from '@/lib/text-job-lease'
import type { ProjectAiJobKind } from '@/lib/projectAiJobStore'
import type { Prisma } from '@/generated/prisma/client'

export type CreatorGenerationCategory = 'image' | 'video' | 'video_plan' | 'video_merge'

// AI 创作台使用自己的任务表和并发池，不读取影视流程的 Generation 表。
export const CREATOR_GENERATION_LIMITS = {
    image: 30,
    video: 20
} as const

const CREATOR_ACTIVE_PHASES = ['generating', 'writing_db'] as const

function creatorJobKind(category: CreatorGenerationCategory): Extract<ProjectAiJobKind, 'creator_image' | 'creator_video' | 'creator_video_plan' | 'creator_video_merge'> {
    return category === 'video_plan' ? 'creator_video_plan' : category === 'video_merge' ? 'creator_video_merge' : category === 'image' ? 'creator_image' : 'creator_video'
}

function categoryLabel(category: CreatorGenerationCategory) {
    return category === 'video_plan' ? '主题策划' : category === 'video_merge' ? '拼接' : category === 'image' ? '图片' : '视频'
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
 * other's capacity. The JSON workspace transaction lock keeps local reservations atomic.
 */
export async function createCreatorGenerationJob(userId: bigint, category: CreatorGenerationCategory, queuedInput?: Prisma.InputJsonObject) {
    const kind = creatorJobKind(category)
    const limit = category === 'video_plan' || category === 'video_merge' ? 2 : CREATOR_GENERATION_LIMITS[category]
    const activePhases = category === 'video_merge' ? ['queued', ...CREATOR_ACTIVE_PHASES] : [...CREATOR_ACTIVE_PHASES]
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
            if (category === 'video_merge' && typeof queuedInput?.requestKey === 'string') {
                const jobs = await tx.projectAiJob.findMany({ where: { projectId: userId, kind }, orderBy: { createdAt: 'desc' }, take: 100 })
                const existing = jobs.find(job => (job.result as Prisma.JsonObject | null)?.requestKey === queuedInput.requestKey)
                if (existing) {
                    const previous = (existing.result as Prisma.JsonObject).input
                    if (JSON.stringify(previous) !== JSON.stringify(queuedInput.input)) throw new Error('拼接请求编号已用于其它内容')
                    return { admitted: true as const, id: existing.id.toString(), active: 0 }
                }
            }
            // Browser polling refreshes the lease for long-running creator
            // videos. Abandoned tabs therefore release their own pool without
            // touching any film-production task.
            if (category !== 'video_merge') await tx.projectAiJob.updateMany({
                where: {
                    projectId: userId,
                    kind,
                    phase: { in: activePhases },
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
                    phase: { in: activePhases }
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
                    phase: category === 'video_merge' ? 'queued' : 'generating',
                    attempts: 0,
                    progress: 0,
                    total: 1,
                    activeKey: `creator-generation:${userId}:${category}:${id}`,
                    ...newTextJobLease('creator-generation'),
                    ...(queuedInput ? { result: queuedInput } : {}),
                    ...(category === 'video_merge' ? { leaseOwner: null, leaseExpiresAt: null } : {})
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
