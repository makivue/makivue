import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { genId } from '@/lib/id'
import { parseApiId } from '@/lib/api-id'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { parseCreatorMergeInput, CREATOR_MERGE_MAX_SECONDS, type CreatorMergeInput } from '@/lib/creator-video-merge'
import { startTextJobHeartbeat } from '@/lib/text-job-lease'
import { mergeCreatorClips } from './creator-video-merge-media'
import { findCreatorAssetByJob, serializeCreatorAsset } from './creator-assets'
import { extractVideoCover, withFfmpegSlot } from './ffmpeg'
import { deleteLocalCreatorArtifact, localMediaFilePath, localMediaMatchesSubdirectory, saveLocalMediaFile } from './local-media'

export class CreatorMergeValidationError extends Error {}

async function saveMergedAsset(userId: bigint, jobId: bigint, owner: string, output: string, input: CreatorMergeInput, duration: number) {
    const token = `${jobId}_${randomUUID()}`
    const coverPath = `${output}.jpg`
    let videoUrl: string | undefined
    let coverUrl: string | null = null
    let saved = false
    try {
        await withFfmpegSlot(() => extractVideoCover(output, coverPath, Math.min(0.5, duration / 4)))
        videoUrl = await saveLocalMediaFile(output, `creator/${userId}/videos`, `creator_merge_${token}.mp4`)
        coverUrl = await saveLocalMediaFile(coverPath, `creator/${userId}/covers`, `creator_merge_${token}.jpg`)
        const row = await prisma.$transaction(async tx => {
            const lease = await tx.projectAiJob.updateMany({ where: { id: jobId, projectId: userId, kind: 'creator_video_merge', phase: 'writing_db', leaseOwner: owner }, data: { heartbeatAt: new Date() } })
            if (lease.count !== 1) throw new Error('拼接任务租约已失效')
            return tx.creatorAsset.upsert({ where: { sourceJobId: jobId }, update: {}, create: { id: genId(), userId, type: 'video', url: videoUrl!, coverUrl, prompt: input.title, provider: 'ffmpeg-merge', ratio: input.ratio, duration: Math.max(1, Math.round(duration)), sourceJobId: jobId } })
        })
        saved = row.url === videoUrl
        return serializeCreatorAsset(row)
    } finally {
        await fs.unlink(coverPath).catch(() => {})
        if (!saved) await Promise.all([videoUrl, coverUrl].filter((url): url is string => !!url).map(url => deleteLocalCreatorArtifact(url).catch(() => {})))
    }
}

/** Merge jobs retain their checkpoint across restarts and resume when their lease expires. */
export async function getCreatorVideoMergeJob(userId: bigint, jobId?: string) {
    const id = jobId === undefined ? undefined : parseApiId(jobId)
    if (id === null) return null
    const where = { projectId: userId, kind: 'creator_video_merge', ...(id === undefined ? {} : { id }) }
    const active = id === undefined ? await prisma.projectAiJob.findFirst({ where: { ...where, phase: { in: ['queued', 'writing_db'] } }, orderBy: { createdAt: 'desc' } }) : null
    const row = active ?? await prisma.projectAiJob.findFirst({ where, orderBy: { createdAt: 'desc' } })
    if (!row) return null
    return { id: row.id.toString(), phase: row.phase, progress: row.progress ?? 0, total: row.total ?? 0, error: row.error, result: row.result }
}

/** Resolve only this user's saved local videos, never client-provided URLs or paths. */
export async function loadCreatorMergeAssets(userId: bigint, input: CreatorMergeInput) {
    const rows = await prisma.creatorAsset.findMany({ where: { id: { in: input.assetIds.map(BigInt) }, userId, type: 'video', deletedAt: null } })
    const ordered = input.assetIds.map(id => rows.find(row => row.id.toString() === id))
    if (ordered.some(row => !row)) throw new CreatorMergeValidationError('部分视频片段不存在或已删除')
    const assets = ordered as typeof rows
    if (assets.some(asset => !asset.duration || asset.duration <= 0)) throw new CreatorMergeValidationError('视频片段时长无效')
    if (assets.reduce((sum, asset) => sum + asset.duration!, 0) > CREATOR_MERGE_MAX_SECONDS) throw new CreatorMergeValidationError('拼接总时长不能超过 10 分钟')
    if (assets.some(asset => !localMediaMatchesSubdirectory(asset.url, `creator/${userId}/videos`))) throw new CreatorMergeValidationError('视频片段不是本地作品')
    return assets
}

export async function runCreatorVideoMerge(jobId: string, userId: bigint) {
    const id = BigInt(jobId)
    const available = { id, projectId: userId, kind: 'creator_video_merge', phase: { in: ['queued', 'writing_db'] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] }
    const row = await prisma.projectAiJob.findFirst({ where: available })
    if (!row) return
    const owner = `creator-merge:${randomUUID()}`
    const claimed = await prisma.projectAiJob.updateMany({ where: available, data: { phase: 'writing_db', leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 15 * 60_000), heartbeatAt: new Date(), attempts: { increment: 1 } } })
    if (claimed.count !== 1) return
    const owned = { id, projectId: userId, kind: 'creator_video_merge', phase: 'writing_db', leaseOwner: owner }
    const renew = async () => {
        const updated = await prisma.projectAiJob.updateMany({ where: owned, data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + 15 * 60_000) } })
        if (updated.count !== 1) throw new Error('拼接任务租约已失效')
    }
    const stopHeartbeat = startTextJobHeartbeat(renew, `creator-video-merge:${jobId}`)
    let directory: string | undefined
    try {
        const checkpoint = row.result as { input?: unknown; requestKey?: string }
        const input = parseCreatorMergeInput(checkpoint.input)
        let asset = await findCreatorAssetByJob(userId, id)
        if (!asset) {
            const inputs = await loadCreatorMergeAssets(userId, input)
            const paths = await Promise.all(inputs.map(item => localMediaFilePath(item.url)))
            const stats = await Promise.all(paths.map(file => fs.stat(file)))
            if (stats.reduce((sum, stat) => sum + stat.size, 0) > 1024 ** 3) throw new CreatorMergeValidationError('拼接素材大小超过 1GB')
            directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-creator-merge-'))
            const output = path.join(directory, 'merged.mp4')
            const duration = await mergeCreatorClips(paths, output, input.ratio, async completed => {
                await renew()
                await prisma.projectAiJob.updateMany({ where: owned, data: { progress: completed, total: inputs.length } })
            })
            await renew()
            asset = await saveMergedAsset(userId, id, owner, output, input, duration)
        }
        await prisma.projectAiJob.updateMany({ where: owned, data: { phase: 'done', progress: input.assetIds.length, total: input.assetIds.length, result: { ...checkpoint, asset } as unknown as Prisma.InputJsonValue, activeKey: null, leaseOwner: null, leaseExpiresAt: null, error: null } })
    } catch (error) {
        await prisma.projectAiJob.updateMany({ where: owned, data: { phase: 'error', error: error instanceof Error ? error.message : String(error), activeKey: null, leaseOwner: null, leaseExpiresAt: null } })
    } finally {
        stopHeartbeat()
        if (directory) await fs.rm(directory, { recursive: true, force: true })
    }
}
