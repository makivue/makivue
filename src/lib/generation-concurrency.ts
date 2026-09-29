import { localTransactionLock } from '@/lib/local-store'
import { prisma } from '@/lib/prisma'
import type { Generation, Prisma } from '@/generated/prisma/client'
import { REF_IMAGE_STALE_WINDOW_MS } from '@/lib/reference-generation-progress'
import { GENERATION_CONCURRENCY_LIMITS, MAX_ACTIVE_PROJECTS_PER_USER } from '@/lib/generation-concurrency-policy'

export { GENERATION_CONCURRENCY_LIMITS, MAX_ACTIVE_PROJECTS_PER_USER } from '@/lib/generation-concurrency-policy'

export type GenerationCategory = 'image' | 'video'

const STALE_PROCESSING_MINUTES = 45
const STALE_STOPPING_MINUTES = 10
const QUEUE_POLL_INTERVAL_MS = 2_000
const QUEUE_WAIT_TIMEOUT_MS = 45 * 60 * 1_000
const REFERENCE_QUEUE_WAIT_TIMEOUT_MS = 20 * 60 * 1_000

const IMAGE_GENERATION_TYPES = ['illustrations', 'first_frame', 'middle_frame', 'last_frame']
const VIDEO_GENERATION_TYPES = ['video', 'video_comparison', 'video_speech_comparison']
const ACTIVE_REFERENCE_IMAGE_PHASES = ['generating', 'writing_db']

export function getGenerationCategory(type: string): GenerationCategory {
    if (IMAGE_GENERATION_TYPES.includes(type)) return 'image'
    if (VIDEO_GENERATION_TYPES.includes(type)) return 'video'
    throw new Error(`Unsupported generation type: ${type}`)
}

function categoryTypes(category: GenerationCategory) {
    if (category === 'image') return IMAGE_GENERATION_TYPES
    return VIDEO_GENERATION_TYPES
}

export class GenerationQueueFullError extends Error {
    readonly code = 'GENERATION_QUEUE_FULL'

    constructor(
        message: string,
        readonly category: GenerationCategory,
        readonly limit: number
    ) {
        super(message)
        this.name = 'GenerationQueueFullError'
    }
}

export type GenerationQueueAdmissionAttempt =
    | {
          admitted: true
          generation: Generation
          queued: number
          limit: number
      }
    | {
          admitted: false
          reason: 'queue_full' | 'lock_busy'
          queued?: number
          limit: number
      }

type QueuedGenerationData = Omit<Prisma.GenerationUncheckedCreateInput, 'status'>

export function getGenerationConcurrencyLimitMessage(category: GenerationCategory) {
    if (category === 'image') return '当前账号最多同时处理 15 个图片生成任务，请等待正在处理的图片完成后再试。'
    return '当前账号最多同时处理 10 个视频生成任务，请等待正在处理的视频完成后再试。'
}

export async function cleanupStaleGenerationSlots(userId: bigint, category: GenerationCategory) {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1_000)
    const stoppingStaleBefore = new Date(Date.now() - STALE_STOPPING_MINUTES * 60 * 1_000)
    await prisma.generation.updateMany({
        where: {
            type: { in: categoryTypes(category) },
            status: 'processing',
            // Video tasks with an upstream task ID can be resumed by the
            // durable worker after a process restart; do not discard that
            // checkpoint merely to release a slot.
            ...(category === 'video' ? { taskId: null } : {}),
            OR: [{ updatedAt: { lt: staleBefore } }, { errorMsg: '任务已暂停，该镜头尚未完成', updatedAt: { lt: stoppingStaleBefore } }],
            storyboard: { episode: { project: { userId } } }
        },
        data: {
            status: 'failed',
            activeKey: null,
            errorMsg: `任务超时未更新，已自动释放并发槽（>${STALE_PROCESSING_MINUTES}分钟）`
        }
    })
    if (category === 'image') {
        const projectIds = (await prisma.project.findMany({ where: { userId }, select: { id: true } })).map(project => project.id)
        if (projectIds.length > 0) {
            const now = new Date()
            const legacyStaleBefore = new Date(now.getTime() - REF_IMAGE_STALE_WINDOW_MS)
            await prisma.refImageJob.updateMany({
                where: {
                    projectId: { in: projectIds },
                    phase: { in: ACTIVE_REFERENCE_IMAGE_PHASES },
                    OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null, updatedAt: { lt: legacyStaleBefore } }]
                },
                data: {
                    phase: 'error',
                    activeKey: null,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    error: '图片任务超过 2 分钟没有心跳，已自动回收，请重试'
                }
            })
        }
    }
}

export async function getUserGenerationCapacity(userId: bigint, category: GenerationCategory) {
    await cleanupStaleGenerationSlots(userId, category)
    const projectIds = category === 'image' ? (await prisma.project.findMany({ where: { userId }, select: { id: true } })).map(project => project.id) : []
    const [active, activeReferences] = await Promise.all([
        prisma.generation.findMany({
            where: {
                type: { in: categoryTypes(category) },
                status: 'processing',
                storyboard: { episode: { project: { userId } } }
            },
            distinct: ['storyboardId'],
            select: { storyboardId: true }
        }),
        category === 'image' && projectIds.length > 0 ? prisma.refImageJob.count({ where: { projectId: { in: projectIds }, phase: { in: ACTIVE_REFERENCE_IMAGE_PHASES } } }) : Promise.resolve(0)
    ])
    const activeCount = active.length + activeReferences
    const limit = GENERATION_CONCURRENCY_LIMITS[category].user
    return {
        category,
        active: activeCount,
        limit,
        remaining: Math.max(0, limit - activeCount),
        available: activeCount < limit
    }
}

type SlotClaimResult = 'claimed' | 'waiting' | 'cancelled'

export async function tryClaimGenerationSlot(params: { userId: bigint; projectId: bigint; category: GenerationCategory; generationId: bigint }): Promise<SlotClaimResult> {
    const { userId, projectId, category, generationId } = params
    const limits = GENERATION_CONCURRENCY_LIMITS[category]
    const types = categoryTypes(category)
    // The user/category lock serializes both user-wide and project-level
    // counters across pods. A project belongs to one user, so one lock covers
    // both dimensions without deadlocks.
    const lockName = `studio-slot:${userId}:${category}`
    return prisma.$transaction(async tx => {
        const rows = await localTransactionLock(lockName)
        if (Number(rows[0]?.acquired ?? 0) !== 1) return 'waiting'

        try {
            const current = await tx.generation.findUnique({
                where: { id: generationId },
                select: { status: true }
            })
            if (current?.status !== 'queued') return 'cancelled'

            const userProjectIds = (await tx.project.findMany({ where: { userId }, select: { id: true } })).map(project => project.id)

            // A storyboard is one logical workload. Illustration parents and
            // their child frame records can overlap in processing state, so
            // distinct storyboard IDs prevent one workflow consuming two slots.
            const [active, activeReferences] = await Promise.all([
                tx.generation.findMany({
                    where: {
                        type: { in: types },
                        status: 'processing',
                        storyboard: { episode: { project: { userId } } }
                    },
                    distinct: ['storyboardId'],
                    select: {
                        storyboardId: true,
                        storyboard: { select: { episode: { select: { projectId: true } } } }
                    }
                }),
                category === 'image' && userProjectIds.length > 0
                    ? tx.refImageJob.findMany({
                          where: { projectId: { in: userProjectIds }, phase: { in: ACTIVE_REFERENCE_IMAGE_PHASES } },
                          select: { projectId: true }
                      })
                    : Promise.resolve([])
            ])
            const projectActive = active.filter(item => item.storyboard.episode.projectId === projectId).length + activeReferences.filter(item => item.projectId === projectId).length
            const userActive = active.length + activeReferences.length
            if (projectActive >= limits.project || userActive >= limits.user) return 'waiting'

            const activeProjectRows = await tx.generation.findMany({
                where: {
                    status: 'processing',
                    storyboard: { episode: { project: { userId } } }
                },
                distinct: ['storyboardId'],
                select: { storyboard: { select: { episode: { select: { projectId: true } } } } }
            })
            const activeProjectIds = new Set(activeProjectRows.map(item => item.storyboard.episode.projectId.toString()))
            if (userProjectIds.length > 0) {
                const referenceProjectRows = await tx.refImageJob.findMany({
                    where: { projectId: { in: userProjectIds }, phase: { in: ACTIVE_REFERENCE_IMAGE_PHASES } },
                    distinct: ['projectId'],
                    select: { projectId: true }
                })
                for (const item of referenceProjectRows) activeProjectIds.add(item.projectId.toString())
            }
            if (!activeProjectIds.has(projectId.toString()) && activeProjectIds.size >= MAX_ACTIVE_PROJECTS_PER_USER) return 'waiting'

            const claimed = await tx.generation.updateMany({
                where: { id: generationId, status: 'queued' },
                data: { status: 'processing' }
            })
            return claimed.count === 1 ? 'claimed' : 'cancelled'
        } finally {
            // The enclosing local-file transaction releases its exclusive workspace lock.
        }
    })
}

export async function waitForGenerationSlot(
    params: {
        userId: bigint
        projectId: bigint
        category: GenerationCategory
        generationId: bigint
    },
    shouldCancel?: () => boolean | Promise<boolean>
) {
    const deadline = Date.now() + QUEUE_WAIT_TIMEOUT_MS
    let nextStaleCleanupAt = Date.now() + 30_000
    while (Date.now() < deadline) {
        if (await shouldCancel?.()) return false
        if (Date.now() >= nextStaleCleanupAt) {
            await cleanupStaleGenerationSlots(params.userId, params.category)
            nextStaleCleanupAt = Date.now() + 30_000
        }
        const result = await tryClaimGenerationSlot(params)
        if (result === 'claimed') return true
        if (result === 'cancelled') return false
        await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_INTERVAL_MS))
    }
    const label = params.category === 'image' ? '图片' : '视频'
    throw new GenerationQueueFullError(`${label}生成队列等待超时：任务进入队列后等待执行名额超过 45 分钟，请稍后继续。`, params.category, GENERATION_CONCURRENCY_LIMITS[params.category].user)
}

export async function tryClaimReferenceImageSlot(params: { userId: bigint; projectId: bigint; jobId: bigint }): Promise<SlotClaimResult> {
    const { userId, projectId, jobId } = params
    const limits = GENERATION_CONCURRENCY_LIMITS.image
    const lockName = `studio-slot:${userId}:image`

    return prisma.$transaction(async tx => {
        const rows = await localTransactionLock(lockName)
        if (Number(rows[0]?.acquired ?? 0) !== 1) return 'waiting'

        try {
            const current = await tx.refImageJob.findUnique({ where: { id: jobId }, select: { phase: true } })
            if (current?.phase !== 'queued') return 'cancelled'

            const userProjectIds = (await tx.project.findMany({ where: { userId }, select: { id: true } })).map(project => project.id)
            if (!userProjectIds.some(id => id === projectId)) return 'cancelled'

            const [activeFrames, activeReferences] = await Promise.all([
                tx.generation.findMany({
                    where: {
                        type: { in: IMAGE_GENERATION_TYPES },
                        status: 'processing',
                        storyboard: { episode: { project: { userId } } }
                    },
                    distinct: ['storyboardId'],
                    select: {
                        storyboardId: true,
                        storyboard: { select: { episode: { select: { projectId: true } } } }
                    }
                }),
                tx.refImageJob.findMany({
                    where: { projectId: { in: userProjectIds }, phase: { in: ACTIVE_REFERENCE_IMAGE_PHASES } },
                    select: { projectId: true }
                })
            ])
            const projectActive = activeFrames.filter(item => item.storyboard.episode.projectId === projectId).length + activeReferences.filter(item => item.projectId === projectId).length
            if (projectActive >= limits.project || activeFrames.length + activeReferences.length >= limits.user) return 'waiting'

            const activeProjectRows = await tx.generation.findMany({
                where: {
                    status: 'processing',
                    storyboard: { episode: { project: { userId } } }
                },
                distinct: ['storyboardId'],
                select: { storyboard: { select: { episode: { select: { projectId: true } } } } }
            })
            const activeProjectIds = new Set(activeProjectRows.map(item => item.storyboard.episode.projectId.toString()))
            for (const item of activeReferences) activeProjectIds.add(item.projectId.toString())
            if (!activeProjectIds.has(projectId.toString()) && activeProjectIds.size >= MAX_ACTIVE_PROJECTS_PER_USER) return 'waiting'

            const now = new Date()
            const claimed = await tx.refImageJob.updateMany({
                where: { id: jobId, phase: 'queued' },
                data: {
                    phase: 'generating',
                    leaseOwner: `ref:${process.pid}`,
                    heartbeatAt: now,
                    leaseExpiresAt: new Date(now.getTime() + REF_IMAGE_STALE_WINDOW_MS)
                }
            })
            return claimed.count === 1 ? 'claimed' : 'cancelled'
        } finally {
            // The enclosing local-file transaction releases its exclusive workspace lock.
        }
    })
}

export async function waitForReferenceImageSlot(params: { userId: bigint; projectId: bigint; jobId: bigint }) {
    const deadline = Date.now() + REFERENCE_QUEUE_WAIT_TIMEOUT_MS
    let nextMaintenanceAt = Date.now() + 30_000
    while (Date.now() < deadline) {
        if (Date.now() >= nextMaintenanceAt) {
            await cleanupStaleGenerationSlots(params.userId, 'image')
            const now = new Date()
            await prisma.refImageJob.updateMany({ where: { id: params.jobId, phase: 'queued' }, data: { heartbeatAt: now, updatedAt: now } })
            nextMaintenanceAt = Date.now() + 30_000
        }
        const result = await tryClaimReferenceImageSlot(params)
        if (result === 'claimed') return true
        if (result === 'cancelled') return false
        await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_INTERVAL_MS))
    }
    throw new GenerationQueueFullError('图片生成队列等待超时：参考图等待执行名额超过 20 分钟，请稍后重试。', 'image', GENERATION_CONCURRENCY_LIMITS.image.user)
}

/** Atomically reserve one account queue position and create its generation. */
export async function tryCreateQueuedGeneration(params: { userId: bigint; category: GenerationCategory; data: QueuedGenerationData }): Promise<GenerationQueueAdmissionAttempt> {
    const { userId, category, data } = params
    const limit = GENERATION_CONCURRENCY_LIMITS[category].queued
    const lockName = `studio-queue:${userId}:${category}`

    return prisma.$transaction(async tx => {
        const rows = await localTransactionLock(lockName)
        if (Number(rows[0]?.acquired ?? 0) !== 1) {
            return { admitted: false, reason: 'lock_busy', limit }
        }

        try {
            const queued = await tx.generation.count({
                where: {
                    type: { in: categoryTypes(category) },
                    status: 'queued',
                    storyboard: { episode: { project: { userId } } }
                }
            })
            if (queued >= limit) return { admitted: false, reason: 'queue_full', queued, limit }

            const generation = await tx.generation.create({
                data: { ...data, status: 'queued' }
            })
            return { admitted: true, generation, queued, limit }
        } finally {
            // The enclosing local-file transaction releases its exclusive workspace lock.
        }
    })
}

export async function waitForGenerationQueueAdmission(
    params: {
        userId: bigint
        category: GenerationCategory
        data: QueuedGenerationData
    },
    shouldCancel?: () => boolean | Promise<boolean>,
    onWaiting?: (state: { category: GenerationCategory; reason: 'queue_full' | 'lock_busy'; queued?: number; limit: number }) => void | Promise<void>
): Promise<Generation | null> {
    const deadline = Date.now() + QUEUE_WAIT_TIMEOUT_MS
    let lastWaitingKey = ''
    let lastQueued: number | undefined

    while (Date.now() < deadline) {
        if (await shouldCancel?.()) return null
        const attempt = await tryCreateQueuedGeneration(params)
        if (attempt.admitted) return attempt.generation

        lastQueued = attempt.queued ?? lastQueued
        const waitingKey = `${attempt.reason}:${attempt.queued ?? 'unknown'}:${attempt.limit}`
        if (waitingKey !== lastWaitingKey) {
            lastWaitingKey = waitingKey
            await onWaiting?.({ category: params.category, reason: attempt.reason, queued: attempt.queued, limit: attempt.limit })
        }
        await new Promise(resolve => setTimeout(resolve, QUEUE_POLL_INTERVAL_MS))
    }

    const label = params.category === 'image' ? '图片' : params.category === 'video' ? '视频' : '音频'
    const queueUsage = lastQueued === undefined ? '' : `当前账号已有 ${lastQueued} 个${label}任务排队，`
    throw new GenerationQueueFullError(
        `${label}生成队列等待超时：${queueUsage}队列上限为 ${GENERATION_CONCURRENCY_LIMITS[params.category].queued}；一键生成等待 45 分钟仍无空位，请稍后继续。`,
        params.category,
        GENERATION_CONCURRENCY_LIMITS[params.category].queued
    )
}

export async function assertGenerationQueueCapacity(userId: bigint, category: GenerationCategory, requestedSlots = 1) {
    const limit = GENERATION_CONCURRENCY_LIMITS[category].queued
    const queued = await prisma.generation.count({
        where: {
            type: { in: categoryTypes(category) },
            status: 'queued',
            storyboard: { episode: { project: { userId } } }
        }
    })
    const safeRequestedSlots = Math.max(1, Math.round(requestedSlots))
    if (queued + safeRequestedSlots > limit) {
        const label = category === 'image' ? '图片' : '视频'
        throw new GenerationQueueFullError(`当前账号已有 ${queued} 个${label}任务排队，本次还需 ${safeRequestedSlots} 个名额，队列上限为 ${limit}；请等待或取消部分任务后再提交。`, category, limit)
    }
}

export function getGenerationConcurrencySummary(category: GenerationCategory) {
    const limits = GENERATION_CONCURRENCY_LIMITS[category]
    return {
        category,
        projectMaxConcurrent: limits.project,
        userMaxConcurrent: limits.user,
        userMaxQueued: limits.queued,
        maxActiveProjects: MAX_ACTIVE_PROJECTS_PER_USER
    }
}
