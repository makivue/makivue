import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { abortEpJobControllers } from '@/lib/episodeJobStore'
import { resetFollowingContinuousMediaInTransaction, resetStoryboardMediaInTransaction } from '@/services/artifacts'

const ACTIVE_JOB_PHASES = ['queued', 'running', 'generating', 'analyzing', 'filling', 'merging', 'writing_db', 'processing']
const CANCELLED_TEXT_JOB = { activeKey: null, leaseOwner: null, leaseExpiresAt: null } as const

export async function cancelProjectOperations(projectId: bigint, reason: string, options: { deleteProject?: boolean } = {}) {
    const result = await prisma.$transaction(tx => cancelProjectOperationsInTransaction(tx, projectId, reason, options))
    abortEpJobControllers(result.epJobIds)
    return result
}

export async function cancelProjectOperationsInTransaction(tx: Prisma.TransactionClient, projectId: bigint, reason: string, options: { deleteProject?: boolean } = {}) {

    const episodes = await tx.episode.findMany({ where: { projectId, deletedAt: null }, select: { id: true } })
    const episodeIds = episodes.map(item => item.id)
    const storyboards = episodeIds.length ? await tx.storyboard.findMany({ where: { episodeId: { in: episodeIds }, deletedAt: null }, select: { id: true } }) : []
    const storyboardIds = storyboards.map(item => item.id)
    const epJobs = episodeIds.length ? await tx.epJob.findMany({ where: { episodeId: { in: episodeIds }, phase: { in: ACTIVE_JOB_PHASES } }, select: { id: true } }) : []

    await tx.project.update({
        where: { id: projectId },
        data: {
            operationVersion: { increment: 1 },
            ...(options.deleteProject ? { deletedAt: new Date() } : {})
        }
    })
    if (episodeIds.length) {
        await tx.episode.updateMany({ where: { id: { in: episodeIds } }, data: { operationVersion: { increment: 1 } } })
        await tx.videoMerge.updateMany({
            where: { episodeId: { in: episodeIds }, status: { in: ['pending', 'processing'] } },
            data: { status: 'cancelled', activeKey: null, errorMsg: reason }
        })
        await tx.chapterJob.updateMany({ where: { episodeId: { in: episodeIds }, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
        await tx.scriptJob.updateMany({ where: { episodeId: { in: episodeIds }, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
        await tx.storyboardJob.updateMany({ where: { episodeId: { in: episodeIds }, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
        await tx.batchJob.updateMany({ where: { episodeId: { in: episodeIds }, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', errorMsg: reason } })
        await tx.epJob.updateMany({ where: { episodeId: { in: episodeIds }, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', errorMsg: reason } })
    }
    if (storyboardIds.length) {
        await tx.storyboard.updateMany({ where: { id: { in: storyboardIds } }, data: { operationVersion: { increment: 1 } } })
        await tx.generation.updateMany({
            where: { storyboardId: { in: storyboardIds }, status: { in: ['queued', 'processing'] } },
            data: { status: 'cancelled', activeKey: null, errorMsg: reason }
        })
    }
    await tx.projectAiJob.updateMany({ where: { projectId, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
    await tx.extractJob.updateMany({ where: { projectId, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
    await tx.outlineJob.updateMany({ where: { projectId, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
    await tx.refImageJob.updateMany({ where: { projectId, phase: { in: ACTIVE_JOB_PHASES } }, data: { phase: 'cancelled', error: reason, ...CANCELLED_TEXT_JOB } })
    return { episodeIds, storyboardIds, epJobIds: epJobs.map(job => job.id) }
}

export async function cancelStoryboardOperations(storyboardId: bigint, reason: string, deleted = false) {
    return prisma.$transaction(
        async tx => {
            const current = await tx.storyboard.findUnique({ where: { id: storyboardId } })
            if (!current || current.deletedAt) return current
            if (deleted) {
                const result = await resetStoryboardMediaInTransaction(tx, current, ['frame', 'audio'], reason, { patch: { deletedAt: new Date() } })
                await tx.characterStateEvent.updateMany({ where: { storyboardId, status: 'active' }, data: { status: 'superseded' } })
                await resetFollowingContinuousMediaInTransaction(tx, current.episodeId, current.order)
                return result
            }

            await tx.generation.updateMany({
                where: { storyboardId, status: { in: ['queued', 'processing'] } },
                data: { status: 'cancelled', activeKey: null, errorMsg: reason }
            })
            return tx.storyboard.update({
                where: { id: storyboardId },
                data: { operationVersion: { increment: 1 }, ...(deleted ? { deletedAt: new Date() } : {}) }
            })
        },
        { timeout: 60_000 }
    )
}
