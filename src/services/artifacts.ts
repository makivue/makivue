import { prisma } from '@/lib/prisma'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { deleteLocalMediaWithinSubdirectory } from './local-media'
import type { Prisma } from '@/generated/prisma/client'

export type StoryboardInvalidationScope = 'frame' | 'video' | 'audio' | 'compose'

export function invalidationPatch(scopes: StoryboardInvalidationScope[]): Record<string, unknown> {
    const set = new Set(scopes)
    const patch: Record<string, unknown> = {}

    if (set.has('frame')) {
        patch.firstFrameUrl = null
        patch.lastFrameUrl = null
        patch.plannedLastFrameUrl = null
        patch.actualVideoEndFrameUrl = null
        patch.frameStatus = 'pending'
        set.add('video')
    }
    if (set.has('video')) {
        patch.videoUrl = null
        patch.actualVideoEndFrameUrl = null
        patch.videoStatus = 'pending'
        patch.expectedAudioMode = null
        set.add('compose')
    }
    if (set.has('audio')) {
        patch.audioUrl = null
        patch.audioStatus = 'pending'
        set.add('compose')
    }
    if (set.has('compose')) {
        patch.composedVideoUrl = null
        patch.composeStatus = 'pending'
        patch.compositionMode = null
    }
    if (set.has('video') || set.has('audio')) patch.subtitles = null

    return patch
}

/** Caller holds the episode lock; changing any timeline input invalidates every merge. */
export async function clearEpisodeMergedVideoInTransaction(tx: Prisma.TransactionClient, episodeId: bigint) {
    await tx.episode.updateMany({ where: { id: episodeId, deletedAt: null }, data: { videoUrl: null, operationVersion: { increment: 1 } } })
    await tx.episode.updateMany({ where: { id: episodeId, deletedAt: null, status: 'completed' }, data: { status: 'storyboarded' } })
    await tx.videoMerge.deleteMany({ where: { episodeId } })
    await tx.qualityReview.deleteMany({ where: { episodeId, scope: { in: ['merge', 'subtitle'] } } })
}

export class StaleStoryboardMutationError extends Error {
    constructor() {
        super('分镜已更新或删除，本次操作未覆盖新版本，请刷新后重试')
    }
}

export async function lockStoryboardMediaInTransaction(tx: Prisma.TransactionClient, target: { id: bigint; episodeId: bigint; operationVersion?: number }) {


    const current = await tx.storyboard.findUnique({ where: { id: target.id } })
    if (!current || current.deletedAt || current.episodeId !== target.episodeId || (target.operationVersion !== undefined && current.operationVersion !== target.operationVersion))
        throw new StaleStoryboardMutationError()
    return current
}

/** Locks in episode → storyboard order; callers can commit the source change in the same transaction. */
export async function resetStoryboardMediaInTransaction(
    tx: Prisma.TransactionClient,
    target: { id: bigint; episodeId: bigint; operationVersion?: number },
    scopes: StoryboardInvalidationScope[],
    reason: string,
    options: { preserveGenerationId?: bigint; patch?: Prisma.StoryboardUpdateInput } = {}
) {
    const current = await lockStoryboardMediaInTransaction(tx, target)
    await tx.generation.updateMany({
        where: { storyboardId: target.id, status: { in: ['queued', 'processing'] }, ...(options.preserveGenerationId ? { id: { not: options.preserveGenerationId } } : {}) },
        data: { status: 'cancelled', activeKey: null, leaseOwner: null, leaseExpiresAt: null, errorMsg: reason }
    })
    if (scopes.includes('frame')) {
        await tx.generation.updateMany({ where: { storyboardId: target.id, type: 'middle_frame', status: 'completed' }, data: { status: 'archived', activeKey: null } })
    }
    const updated = await tx.storyboard.update({
        where: { id: target.id },
        data: {
            ...(current.frameStatus === 'generating' ? { frameStatus: current.firstFrameUrl ? 'completed' : 'pending' } : {}),
            ...(current.videoStatus === 'generating' ? { videoStatus: current.videoUrl ? 'completed' : 'pending' } : {}),
            ...(current.audioStatus === 'generating' ? { audioStatus: current.audioUrl ? 'completed' : 'pending' } : {}),
            ...(current.composeStatus === 'processing' ? { composeStatus: current.composedVideoUrl ? 'completed' : 'pending' } : {}),
            ...invalidationPatch(scopes),
            ...options.patch,
            operationVersion: { increment: 1 }
        }
    })
    if (options.preserveGenerationId) {
        const claimed = await tx.generation.updateMany({
            where: { id: options.preserveGenerationId, status: { in: ['queued', 'processing'] }, resourceVersion: current.operationVersion },
            data: { resourceVersion: updated.operationVersion }
        })
        if (claimed.count !== 1) throw new StaleStoryboardMutationError()
    }
    await clearEpisodeMergedVideoInTransaction(tx, current.episodeId)
    return updated
}

/** Strong continuity uses its predecessor's actual ending frame; follow the chain until a cut. */
export async function resetFollowingContinuousMediaInTransaction(tx: Prisma.TransactionClient, episodeId: bigint, order: number, skipIds: bigint[] = []) {
    const following = await tx.storyboard.findMany({ where: { episodeId, deletedAt: null, order: { gt: order } }, orderBy: { order: 'asc' } })
    for (const shot of following) {
        if (!['continuous', 'seamless'].includes(shot.continuityMode)) break
        if (skipIds.includes(shot.id)) continue
        await resetStoryboardMediaInTransaction(tx, shot, ['frame'], '上一镜已变化，请重新生成连续镜头', { patch: { staleReason: '上一镜已变化，请重新生成连续镜头' } })
    }
}

export type EpisodeArtifact = { url: string; subdir: string }

async function deleteEpisodeArtifact({ url, subdir }: EpisodeArtifact) {
    if (url.startsWith('/api/local-media/') || /^https?:\/\//i.test(url)) {
        await deleteLocalMediaWithinSubdirectory(url, subdir)
        return
    }
    const relative = url.startsWith('/storage/') ? url.slice(1) : url.startsWith('storage/') ? url : null
    if (!relative) return
    const storageRoot = path.resolve(process.cwd(), 'public', 'storage')
    const target = path.resolve(process.cwd(), 'public', relative)
    if (!target.startsWith(`${storageRoot}${path.sep}`)) throw new Error('Refusing to delete a local artifact outside public/storage')
    await fs.unlink(target).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
}

export async function deleteEpisodeArtifacts(artifacts: EpisodeArtifact[]) {
    const uniqueArtifacts = Array.from(new Map(artifacts.map(artifact => [`${artifact.subdir}\n${artifact.url}`, artifact])).values())
    const deletionResults = await Promise.allSettled(uniqueArtifacts.map(deleteEpisodeArtifact))
    const cleanupFailures = deletionResults.filter(result => result.status === 'rejected').length
    if (cleanupFailures > 0) {
        console.warn(`[episode-reset] detached all database media but failed to delete ${cleanupFailures}/${uniqueArtifacts.length} stored objects`)
    }
    return { artifactCount: uniqueArtifacts.length, cleanupFailures }
}

/**
 * Atomically detach every generated media result for one episode before a
 * regenerate-all batch starts. Incrementing resource versions prevents an old
 * provider/FFmpeg callback from restoring a result after this reset.
 */
export async function resetEpisodeGeneratedMedia(episodeId: bigint, expectedOperationVersion?: number) {
    const { storyboardIds, artifacts } = await prisma.$transaction(
        async tx => {

            const episode = await tx.episode.findFirst({
                where: { id: episodeId, deletedAt: null },
                select: {
                    operationVersion: true,
                    videoUrl: true,
                    storyboards: {
                        where: { deletedAt: null },
                        select: {
                            id: true,
                            firstFrameUrl: true,
                            lastFrameUrl: true,
                            plannedLastFrameUrl: true,
                            actualVideoEndFrameUrl: true,
                            videoUrl: true,
                            audioUrl: true,
                            composedVideoUrl: true,
                            generations: { select: { type: true, resultUrl: true } }
                        }
                    },
                    merges: { select: { videoUrl: true } }
                }
            })
            if (!episode) throw new Error('Episode not found')
            if (expectedOperationVersion !== undefined && episode.operationVersion !== expectedOperationVersion) throw new StaleStoryboardMutationError()

            const storyboardIds = episode.storyboards.map(storyboard => storyboard.id)
            const artifacts: EpisodeArtifact[] = []
            const add = (url: string | null | undefined, subdir: string) => {
                if (url) artifacts.push({ url, subdir })
            }
            add(episode.videoUrl, `videos/episodes/${episodeId}`)
            for (const merge of episode.merges) add(merge.videoUrl, `videos/episodes/${episodeId}`)
            for (const storyboard of episode.storyboards) {
                const imageSubdir = `storyboards/${episodeId}`
                add(storyboard.firstFrameUrl, imageSubdir)
                add(storyboard.lastFrameUrl, imageSubdir)
                add(storyboard.plannedLastFrameUrl, imageSubdir)
                add(storyboard.actualVideoEndFrameUrl, imageSubdir)
                add(storyboard.videoUrl, `videos/${episodeId}`)
                add(storyboard.audioUrl, `audio/${episodeId}`)
                add(storyboard.composedVideoUrl, `videos/storyboards/${storyboard.id}`)
                for (const generation of storyboard.generations) {
                    if (!generation.resultUrl) continue
                    if (generation.type === 'first_frame' || generation.type === 'last_frame' || generation.type === 'middle_frame') {
                        add(generation.resultUrl, imageSubdir)
                    } else if (generation.type === 'video') {
                        add(generation.resultUrl, `videos/${episodeId}`)
                    } else if (generation.type === 'audio') {
                        add(generation.resultUrl, `audio/${episodeId}`)
                    } else if (generation.type === 'compose') {
                        add(generation.resultUrl, `videos/storyboards/${storyboard.id}`)
                    }
                }
            }

            if (storyboardIds.length > 0) {
                await tx.qualityReview.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.productionEvent.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.generation.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.storyboard.updateMany({
                    where: { id: { in: storyboardIds }, deletedAt: null },
                    data: {
                        firstFrameUrl: null,
                        lastFrameUrl: null,
                        plannedLastFrameUrl: null,
                        actualVideoEndFrameUrl: null,
                        videoUrl: null,
                        audioUrl: null,
                        composedVideoUrl: null,
                        subtitles: null,
                        frameStatus: 'pending',
                        videoStatus: 'pending',
                        audioStatus: 'pending',
                        composeStatus: 'pending',
                        expectedAudioMode: null,
                        compositionMode: null,
                        generationStage: null,
                        polishStatus: null,
                        operationVersion: { increment: 1 }
                    }
                })
            }
            await clearEpisodeMergedVideoInTransaction(tx, episodeId)
            await tx.qualityReview.deleteMany({ where: { episodeId, storyboardId: null, scope: { in: ['frame', 'video', 'audio', 'compose', 'merge', 'subtitle'] } } })
            await tx.productionEvent.deleteMany({ where: { episodeId, storyboardId: null } })
            return { storyboardIds, artifacts }
        },
        { timeout: 60_000 }
    )

    const { artifactCount, cleanupFailures } = await deleteEpisodeArtifacts(artifacts)

    return { storyboardIds, artifactCount, cleanupFailures }
}
