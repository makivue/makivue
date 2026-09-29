import { createHash } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import type { EpisodeStatusSnapshot } from '@/lib/episode-status'

export const episodeStatusGenerationWhere = {
    OR: [
        { status: 'failed' },
        { status: { in: ['queued', 'processing'] } },
        { type: { in: ['first_frame', 'middle_frame', 'last_frame'] }, status: 'completed' },
        { type: 'video' },
        { type: 'video_comparison', provider: 'kling' },
        { type: 'video_speech_comparison', provider: { in: ['seedance', 'wanx'] } },
        { type: 'compose' }
    ]
} satisfies Prisma.GenerationWhereInput

export const episodeStatusSelect = {
    id: true,
    status: true,
    sourceVersion: true,
    updatedAt: true,
    videoUrl: true,
    storyboards: {
        where: { deletedAt: null },
        orderBy: { order: 'asc' },
        take: 1000,
        select: {
            id: true,
            updatedAt: true,
            sourceVersion: true,
            operationVersion: true,
            frameStatus: true,
            videoStatus: true,
            composeStatus: true,
            audioStatus: true,
            polishStatus: true,
            firstFrameUrl: true,
            lastFrameUrl: true,
            plannedLastFrameUrl: true,
            actualVideoEndFrameUrl: true,
            videoUrl: true,
            composedVideoUrl: true,
            audioUrl: true,
            generations: {
                where: episodeStatusGenerationWhere,
                orderBy: { createdAt: 'desc' },
                take: 12,
                select: { id: true, status: true, resultUrl: true, errorMsg: true }
            }
        }
    },
    merges: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, videoUrl: true, updatedAt: true } }
} satisfies Prisma.EpisodeSelect

type StatusSource = Prisma.EpisodeGetPayload<{ select: typeof episodeStatusSelect }>

/** Fingerprint persisted changes; omit provider heartbeat/usage payloads. */
export function episodeStatusSnapshot(episode: StatusSource): EpisodeStatusSnapshot {
    const revision = {
        id: String(episode.id),
        status: episode.status,
        sourceVersion: episode.sourceVersion,
        updatedAt: episode.updatedAt,
        videoUrl: episode.videoUrl,
        storyboards: episode.storyboards.map(shot => ({
            id: String(shot.id),
            updatedAt: shot.updatedAt,
            sourceVersion: shot.sourceVersion,
            operationVersion: shot.operationVersion,
            frameStatus: shot.frameStatus,
            videoStatus: shot.videoStatus,
            composeStatus: shot.composeStatus,
            audioStatus: shot.audioStatus,
            polishStatus: shot.polishStatus,
            audioUrl: shot.audioUrl,
            firstFrameUrl: shot.firstFrameUrl,
            lastFrameUrl: shot.lastFrameUrl,
            plannedLastFrameUrl: shot.plannedLastFrameUrl,
            actualVideoEndFrameUrl: shot.actualVideoEndFrameUrl,
            videoUrl: shot.videoUrl,
            composedVideoUrl: shot.composedVideoUrl,
            generations: shot.generations.map(generation => ({ id: String(generation.id), status: generation.status, resultUrl: generation.resultUrl, errorMsg: generation.errorMsg }))
        })),
        merges: episode.merges.map(merge => ({ id: String(merge.id), status: merge.status, videoUrl: merge.videoUrl, updatedAt: merge.updatedAt }))
    }
    return {
        id: String(episode.id),
        version: createHash('sha256').update(JSON.stringify(revision)).digest('hex'),
        status: episode.status ?? 'draft',
        storyboards: episode.storyboards.map(shot => ({
            id: String(shot.id),
            frameStatus: shot.frameStatus ?? 'pending',
            videoStatus: shot.videoStatus ?? 'pending',
            composeStatus: shot.composeStatus ?? 'pending'
        })),
        merges: episode.merges.map(merge => ({ id: String(merge.id), status: merge.status ?? 'pending' }))
    }
}
