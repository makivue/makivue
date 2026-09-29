import type { Prisma } from '@/generated/prisma/client'
import { clearEpisodeMergedVideoInTransaction, invalidationPatch, resetFollowingContinuousMediaInTransaction, type StoryboardInvalidationScope } from './artifacts'

export type ContentStaleScope = 'outline' | 'chapter' | 'script' | 'storyboard' | 'frame' | 'video' | 'audio' | 'compose' | 'merge' | 'subtitle'

function mergeScopes(value: unknown, scopes: ContentStaleScope[]): ContentStaleScope[] {
    const current = Array.isArray(value) ? value.filter((item): item is ContentStaleScope => typeof item === 'string') : []
    return [...new Set([...current, ...scopes])]
}

async function markProjectScopes(tx: Prisma.TransactionClient, projectId: bigint, scopes: ContentStaleScope[]) {
    const current = await tx.project.findUnique({ where: { id: projectId }, select: { staleScopes: true } })
    await tx.project.update({
        where: { id: projectId },
        data: { staleScopes: mergeScopes(current?.staleScopes, scopes) as Prisma.InputJsonValue }
    })
}

async function markStoryboardRowsStale(tx: Prisma.TransactionClient, storyboardIds: bigint[], reason: string, scopes: StoryboardInvalidationScope[] = ['frame', 'audio']) {
    if (storyboardIds.length === 0) return
    // A shared resource version cancels all in-flight work, including stages whose
    // completed products remain valid for the requested invalidation scope.
    if (!scopes.includes('frame')) await tx.storyboard.updateMany({ where: { id: { in: storyboardIds }, frameStatus: 'generating' }, data: { frameStatus: 'pending' } })
    if (!scopes.includes('audio')) await tx.storyboard.updateMany({ where: { id: { in: storyboardIds }, audioStatus: 'generating' }, data: { audioStatus: 'pending' } })
    await tx.storyboard.updateMany({
        where: { id: { in: storyboardIds }, deletedAt: null },
        data: {
            ...invalidationPatch(scopes),
            staleReason: reason,
            operationVersion: { increment: 1 }
        }
    })
    await tx.generation.updateMany({
        where: { storyboardId: { in: storyboardIds }, status: { in: ['queued', 'processing'] } },
        data: { status: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null, errorMsg: reason }
    })
    if (scopes.includes('frame'))
        await tx.generation.updateMany({ where: { storyboardId: { in: storyboardIds }, type: 'middle_frame', status: 'completed' }, data: { status: 'archived', activeKey: null } })
}

async function markEpisodeRowsStale(tx: Prisma.TransactionClient, projectId: bigint, episodeIds: bigint[], reason: string) {
    if (episodeIds.length === 0) return
    await tx.episode.updateMany({ where: { id: { in: episodeIds } }, data: { staleReason: reason } })
    for (const episodeId of episodeIds) await clearEpisodeMergedVideoInTransaction(tx, episodeId)
    await tx.epJob.updateMany({ where: { episodeId: { in: episodeIds }, phase: 'running' }, data: { phase: 'cancelled', errorMsg: reason } })
    await tx.batchJob.updateMany({
        where: { episodeId: { in: episodeIds }, phase: { in: ['queued', 'running', 'processing', 'generating', 'merging'] } },
        data: { phase: 'cancelled', errorMsg: reason }
    })
    await markProjectScopes(tx, projectId, ['storyboard', 'frame', 'video', 'audio', 'compose', 'merge', 'subtitle'])
}

export async function markProjectDownstreamStaleInTransaction(tx: Prisma.TransactionClient, projectId: bigint, reason: string) {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM episodes WHERE project_id = ${projectId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    const episodes = await tx.episode.findMany({ where: { projectId, deletedAt: null }, select: { id: true } })
    const episodeIds = episodes.map(episode => episode.id)
    const storyboards = episodeIds.length ? await tx.storyboard.findMany({ where: { episodeId: { in: episodeIds }, deletedAt: null }, select: { id: true } }) : []
    await markStoryboardRowsStale(
        tx,
        storyboards.map(storyboard => storyboard.id),
        reason
    )
    await markEpisodeRowsStale(tx, projectId, episodeIds, reason)
    await markProjectScopes(tx, projectId, ['outline', 'chapter', 'script', 'storyboard', 'frame', 'video', 'audio', 'compose', 'merge', 'subtitle'])
    return { episodes: episodeIds.length, storyboards: storyboards.length }
}

export async function markProjectVisualsStaleInTransaction(tx: Prisma.TransactionClient, projectId: bigint, reason: string) {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM episodes WHERE project_id = ${projectId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    const episodes = await tx.episode.findMany({ where: { projectId, deletedAt: null }, select: { id: true } })
    const episodeIds = episodes.map(episode => episode.id)
    const storyboards = episodeIds.length ? await tx.storyboard.findMany({ where: { episodeId: { in: episodeIds }, deletedAt: null }, select: { id: true } }) : []
    await markStoryboardRowsStale(
        tx,
        storyboards.map(storyboard => storyboard.id),
        reason,
        ['frame']
    )
    await markEpisodeRowsStale(tx, projectId, episodeIds, reason)
    await markProjectScopes(tx, projectId, ['frame', 'video', 'audio', 'compose', 'merge', 'subtitle'])
    return { episodes: episodeIds.length, storyboards: storyboards.length }
}

export async function markEpisodeDownstreamStaleInTransaction(tx: Prisma.TransactionClient, episodeId: bigint, projectId: bigint, reason: string) {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM episodes WHERE project_id = ${projectId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    const storyboards = await tx.storyboard.findMany({ where: { episodeId, deletedAt: null }, select: { id: true } })
    await markStoryboardRowsStale(
        tx,
        storyboards.map(storyboard => storyboard.id),
        reason
    )
    await markEpisodeRowsStale(tx, projectId, [episodeId], reason)
    await markProjectScopes(tx, projectId, ['script', 'storyboard', 'frame', 'video', 'audio', 'compose', 'merge', 'subtitle'])
    return { storyboards: storyboards.length }
}

export async function markFollowingEpisodesStaleInTransaction(tx: Prisma.TransactionClient, projectId: bigint, episodeNumber: number, stage: 'chapter' | 'script') {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM episodes WHERE project_id = ${projectId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    const reason = `第${episodeNumber}集${stage === 'chapter' ? '正文' : '剧本'}已更新，请复核本集剧情及首尾衔接`
    const laterWhere = { projectId, episodeNumber: { gt: episodeNumber }, deletedAt: null }
    const allFollowing = await tx.episode.findMany({ where: laterWhere, select: { id: true } })
    const allIds = allFollowing.map(episode => episode.id)
    if (!allIds.length) return
    // In-flight first generations have no saved text yet, but still depend on
    // the old predecessor. Invalidate their version before it can be saved.
    await tx.episode.updateMany({ where: { id: { in: allIds } }, data: { operationVersion: { increment: 1 } } })
    await tx.episode.updateMany({ where: { id: { in: allIds }, status: 'storyboarding' }, data: { status: 'scripted' } })
    const activeJobs = { episodeId: { in: allIds }, phase: { in: ['generating', 'writing_db'] } }
    const expired = { phase: 'error', activeKey: null, leaseOwner: null, leaseExpiresAt: null, error: reason }
    if (stage === 'chapter') await tx.chapterJob.updateMany({ where: activeJobs, data: expired })
    await tx.scriptJob.updateMany({ where: activeJobs, data: expired })
    await tx.storyboardJob.updateMany({ where: activeJobs, data: expired })
    const following = await tx.episode.findMany({
        where: { ...laterWhere, ...(stage === 'chapter' ? { chapterContent: { not: null } } : { script: { not: null } }) },
        select: { id: true }
    })
    const ids = following.map(episode => episode.id)
    if (!ids.length) return
    const shots = await tx.storyboard.findMany({ where: { episodeId: { in: ids }, deletedAt: null }, select: { id: true } })
    await markStoryboardRowsStale(
        tx,
        shots.map(shot => shot.id),
        reason
    )
    await markEpisodeRowsStale(tx, projectId, ids, reason)
}

export async function markReferenceDependentsStaleInTransaction(
    tx: Prisma.TransactionClient,
    target: { type: 'character' | 'scene'; id: bigint; projectId: bigint },
    reason: string,
    scopes: StoryboardInvalidationScope[] = ['frame']
) {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${target.projectId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM episodes WHERE project_id = ${target.projectId} AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    const storyboards =
        target.type === 'character'
            ? await tx.storyboard.findMany({
                  where: { deletedAt: null, characters: { some: { characterId: target.id } } },
                  select: { id: true, episodeId: true, order: true }
              })
            : await tx.storyboard.findMany({ where: { deletedAt: null, sceneId: target.id }, select: { id: true, episodeId: true, order: true } })
    await markStoryboardRowsStale(
        tx,
        storyboards.map(storyboard => storyboard.id),
        reason,
        scopes
    )
    if (scopes.includes('frame') || scopes.includes('video')) {
        for (const shot of storyboards) await resetFollowingContinuousMediaInTransaction(tx, shot.episodeId, shot.order)
    }
    await markEpisodeRowsStale(tx, target.projectId, [...new Set(storyboards.map(storyboard => storyboard.episodeId))], reason)
    return { storyboards: storyboards.length }
}
