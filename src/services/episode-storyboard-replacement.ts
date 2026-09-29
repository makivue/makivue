import type { Prisma } from '@/generated/prisma/client'
import { supersedeEpJobShots } from '@/lib/episodeJobStore'
import type { EpisodeArtifact } from '@/services/artifacts'

export const EPISODE_STORYBOARD_REPLACED_REASON = '旧分镜已替换，本集原一键生成任务已取消'

const ACTIVE_BATCH_PHASES = ['queued', 'running', 'generating', 'filling', 'merging', 'writing_db', 'processing']

function addJsonUrls(artifacts: EpisodeArtifact[], value: string | null, subdir: string) {
    if (!value) return
    try {
        const parsed = JSON.parse(value) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        for (const url of Object.values(parsed)) {
            if (typeof url === 'string' && url) artifacts.push({ url, subdir })
        }
    } catch {
        // A legacy subtitle column may contain non-JSON text. It is not a
        // storage pointer and therefore does not need object cleanup.
    }
}

function generationArtifactSubdir(type: string, episodeId: bigint, storyboardId: bigint) {
    if (type === 'first_frame' || type === 'middle_frame' || type === 'last_frame' || type === 'illustrations') return `storyboards/${episodeId}`
    if (type === 'video') return `videos/${episodeId}`
    if (type === 'audio') return `audio/${episodeId}`
    if (type === 'compose') return `videos/storyboards/${storyboardId}`
    return null
}

/**
 * Remove the currently active storyboard graph for an episode inside the
 * caller's episode-row transaction. Storyboard rows are tombstoned instead of
 * hard-deleted because an already-dispatched provider callback may still hold
 * their foreign keys. Resource-version checks make those callbacks harmless.
 */
export async function supersedeEpisodeStoryboardDataInTransaction(tx: Prisma.TransactionClient, episodeId: bigint, reason = EPISODE_STORYBOARD_REPLACED_REASON) {
    const [episode, storyboards, merges, runningEpJobs] = await Promise.all([
        tx.episode.findUnique({ where: { id: episodeId }, select: { videoUrl: true } }),
        tx.storyboard.findMany({
            where: { episodeId, deletedAt: null },
            select: {
                id: true,
                firstFrameUrl: true,
                lastFrameUrl: true,
                plannedLastFrameUrl: true,
                actualVideoEndFrameUrl: true,
                videoUrl: true,
                audioUrl: true,
                composedVideoUrl: true,
                subtitles: true,
                generations: { select: { type: true, resultUrl: true } }
            }
        }),
        tx.videoMerge.findMany({ where: { episodeId }, select: { videoUrl: true, subtitleUrls: true } }),
        tx.epJob.findMany({ where: { episodeId, phase: 'running' }, select: { id: true, shots: true } })
    ])

    const storyboardIds = storyboards.map(storyboard => storyboard.id)
    const artifacts: EpisodeArtifact[] = []
    const add = (url: string | null | undefined, subdir: string) => {
        if (url) artifacts.push({ url, subdir })
    }

    add(episode?.videoUrl, `videos/episodes/${episodeId}`)
    for (const merge of merges) {
        add(merge.videoUrl, `videos/episodes/${episodeId}`)
        addJsonUrls(artifacts, merge.subtitleUrls, `subtitles/episodes/${episodeId}`)
    }
    for (const storyboard of storyboards) {
        add(storyboard.firstFrameUrl, `storyboards/${episodeId}`)
        add(storyboard.lastFrameUrl, `storyboards/${episodeId}`)
        add(storyboard.plannedLastFrameUrl, `storyboards/${episodeId}`)
        add(storyboard.actualVideoEndFrameUrl, `storyboards/${episodeId}`)
        add(storyboard.videoUrl, `videos/${episodeId}`)
        add(storyboard.audioUrl, `audio/${episodeId}`)
        add(storyboard.composedVideoUrl, `videos/storyboards/${storyboard.id}`)
        addJsonUrls(artifacts, storyboard.subtitles, `subtitles/${episodeId}`)
        for (const generation of storyboard.generations) {
            const subdir = generationArtifactSubdir(generation.type, episodeId, storyboard.id)
            if (subdir) add(generation.resultUrl, subdir)
        }
    }

    // Preserve the job row for polling/audit, but replace every stale shot
    // result with a yellow "replaced" item. updateShot() rejects all later
    // writes once the phase is no longer running.
    for (const job of runningEpJobs) {
        await tx.epJob.updateMany({
            where: { id: job.id, phase: 'running' },
            data: {
                phase: 'cancelled',
                shots: supersedeEpJobShots(job.shots, reason) as unknown as Prisma.InputJsonValue,
                errorMsg: reason,
                updatedAt: new Date()
            }
        })
    }
    await tx.batchJob.updateMany({
        where: { episodeId, phase: { in: ACTIVE_BATCH_PHASES } },
        data: { phase: 'cancelled', errorMsg: reason }
    })

    if (storyboardIds.length > 0) {
        await tx.generation.updateMany({
            where: { storyboardId: { in: storyboardIds }, status: { in: ['queued', 'processing'] } },
            data: {
                status: 'cancelled',
                activeKey: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                errorMsg: reason
            }
        })
        await tx.qualityReview.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
        await tx.productionEvent.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
        await tx.characterStateEvent.updateMany({
            where: { storyboardId: { in: storyboardIds }, status: 'active' },
            data: { status: 'superseded' }
        })
        await tx.storyboard.updateMany({
            where: { id: { in: storyboardIds }, deletedAt: null },
            data: { deletedAt: new Date(), staleReason: reason, operationVersion: { increment: 1 } }
        })
    }

    // Episode-level products are derived from the old storyboard graph too.
    await tx.videoMerge.deleteMany({ where: { episodeId } })
    await tx.qualityReview.deleteMany({ where: { episodeId, storyboardId: null, scope: { in: ['storyboard', 'frame', 'video', 'audio', 'compose', 'merge', 'subtitle'] } } })
    await tx.productionEvent.deleteMany({ where: { episodeId, storyboardId: null } })
    await tx.episode.update({ where: { id: episodeId }, data: { videoUrl: null } })

    return {
        storyboardIds,
        epJobIds: runningEpJobs.map(job => job.id),
        artifacts
    }
}
