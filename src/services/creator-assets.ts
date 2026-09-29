import { promises as fs } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { deleteCreatorArtifactFromOSS, uploadToOSS } from './oss'
import { extractVideoCover, optimizeVideoForStreaming, probeDuration, withFfmpegSlot } from './ffmpeg'
import { chargeModelUsage } from './billing'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'

export interface SerializedCreatorAsset {
    id: string
    type: 'image' | 'video'
    url: string
    coverUrl: string | null
    prompt: string | null
    provider: string | null
    ratio: string | null
    duration: number | null
    createdAt: string
}

type CreatorAssetRow = {
    id: bigint
    type: string
    url: string
    coverUrl: string | null
    prompt: string | null
    provider: string | null
    ratio: string | null
    duration: number | null
    createdAt: Date
}

export function serializeCreatorAsset(row: CreatorAssetRow): SerializedCreatorAsset {
    return {
        id: row.id.toString(),
        type: row.type === 'video' ? 'video' : 'image',
        url: row.url,
        coverUrl: row.coverUrl,
        prompt: row.prompt,
        provider: row.provider,
        ratio: row.ratio,
        duration: row.duration,
        createdAt: row.createdAt.toISOString()
    }
}

export async function findCreatorAssetByJob(userId: bigint, sourceJobId: bigint) {
    const row = await prisma.creatorAsset.findFirst({
        where: { userId, sourceJobId, deletedAt: null }
    })
    return row ? serializeCreatorAsset(row) : null
}

export async function findCreatorAssetReference(userId: bigint, assetId: bigint) {
    const row = await prisma.creatorAsset.findFirst({
        where: { id: assetId, userId, deletedAt: null }
    })
    if (!row) return null
    return {
        asset: serializeCreatorAsset(row),
        // Legacy image-reference requests may explicitly use a video cover.
        // Video reuse resolves asset.url through readCreatorVideoAssetReferences.
        referenceUrl: row.type === 'image' ? row.url : row.coverUrl
    }
}

export async function saveCreatorImageAsset(params: { userId: bigint; sourceJobId: bigint; url: string; prompt: string; provider?: string; ratio: string }) {
    const row = await prisma.$transaction(async tx => {
        await chargeModelUsage({
            userId: params.userId,
            tx,
            scopeKey: `job:${params.sourceJobId}`,
            idempotencyKey: `usage:creator-image:${params.sourceJobId}`,
            sourceType: 'creator_image',
            sourceId: String(params.sourceJobId),
            description: `AI 创作台图片生成 · ${params.provider}`
        })
        return tx.creatorAsset.upsert({
            where: { sourceJobId: params.sourceJobId },
            update: {},
            create: {
                id: genId(),
                userId: params.userId,
                type: 'image',
                url: params.url,
                coverUrl: params.url,
                prompt: params.prompt,
                provider: params.provider ?? null,
                ratio: params.ratio,
                sourceJobId: params.sourceJobId
            }
        })
    }, BILLING_TRANSACTION_OPTIONS)
    return serializeCreatorAsset(row)
}

async function downloadVideo(url: string, outputPath: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`视频转存下载失败：HTTP ${response.status}`)
    await fs.writeFile(/* turbopackIgnore: true */ outputPath, Buffer.from(await response.arrayBuffer()))
}

export async function saveCreatorVideoAsset(params: {
    userId: bigint
    sourceJobId: bigint
    sourceUrl?: string
    localPath?: string
    prompt: string
    provider: string
    ratio: string
    requestedDuration: number
}) {
    const existing = await findCreatorAssetByJob(params.userId, params.sourceJobId)
    if (existing) return existing
    if (!params.sourceUrl && !params.localPath) throw new Error('视频作品缺少源文件')

    const storageDir = path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'storage')
    await fs.mkdir(/* turbopackIgnore: true */ storageDir, { recursive: true })
    const token = `${params.userId}_${params.sourceJobId}`
    const videoPath = params.localPath ?? path.join(storageDir, `creator_video_${token}.mp4`)
    const coverPath = path.join(storageDir, `creator_cover_${token}.jpg`)
    const ownsVideoPath = !params.localPath

    try {
        if (params.sourceUrl) await downloadVideo(params.sourceUrl, videoPath)
        const stat = await fs.stat(/* turbopackIgnore: true */ videoPath).catch(() => null)
        if (!stat || stat.size < 1024) throw new Error('视频转存失败：下载文件为空')
        const actualDuration = await probeDuration(videoPath)
        if (actualDuration <= 0.05) throw new Error('视频转存失败：视频时长为 0')

        await withFfmpegSlot(() => optimizeVideoForStreaming(videoPath)).catch(error => {
            console.warn('[creator-assets] faststart skipped:', error instanceof Error ? error.message : error)
        })
        await withFfmpegSlot(() => extractVideoCover(videoPath, coverPath, Math.min(0.5, actualDuration / 4))).catch(error => {
            console.warn('[creator-assets] cover extraction failed:', error instanceof Error ? error.message : error)
        })

        const videoName = `creator_video_${token}.mp4`
        const videoUrl = await uploadToOSS(videoPath, `creator/${params.userId}/videos`, videoName)
        const coverStat = await fs.stat(/* turbopackIgnore: true */ coverPath).catch(() => null)
        const coverUrl = coverStat ? await uploadToOSS(coverPath, `creator/${params.userId}/covers`, `creator_cover_${token}.jpg`) : null
        const row = await prisma.$transaction(async tx => {
            await chargeModelUsage({
                userId: params.userId,
                tx,
                scopeKey: `job:${params.sourceJobId}`,
                idempotencyKey: `usage:creator-video:${params.sourceJobId}`,
                sourceType: 'creator_video',
                sourceId: String(params.sourceJobId),
                description: `AI 创作台视频生成 · ${params.provider}`
            })
            return tx.creatorAsset.upsert({
                where: { sourceJobId: params.sourceJobId },
                update: {},
                create: {
                    id: genId(),
                    userId: params.userId,
                    type: 'video',
                    url: videoUrl,
                    coverUrl,
                    prompt: params.prompt,
                    provider: params.provider,
                    ratio: params.ratio,
                    duration: Math.max(1, Math.round(actualDuration || params.requestedDuration)),
                    sourceJobId: params.sourceJobId
                }
            })
        }, BILLING_TRANSACTION_OPTIONS)
        return serializeCreatorAsset(row)
    } finally {
        if (ownsVideoPath) await fs.unlink(/* turbopackIgnore: true */ videoPath).catch(() => {})
        await fs.unlink(/* turbopackIgnore: true */ coverPath).catch(() => {})
    }
}

export async function replaceCreatorAssetCover(userId: bigint, assetId: bigint, coverUrl: string) {
    const current = await prisma.creatorAsset.findFirst({
        where: { id: assetId, userId, type: 'video', deletedAt: null }
    })
    if (!current) return null
    const row = await prisma.creatorAsset.update({
        where: { id: current.id },
        data: { coverUrl }
    })
    if (current.coverUrl && current.coverUrl !== coverUrl) {
        deleteCreatorArtifactFromOSS(current.coverUrl).catch(error => {
            console.warn('[creator-assets] old cover deletion failed:', error instanceof Error ? error.message : error)
        })
    }
    return serializeCreatorAsset(row)
}

export async function deleteCreatorAsset(userId: bigint, assetId: bigint) {
    const current = await prisma.creatorAsset.findFirst({
        where: { id: assetId, userId, deletedAt: null }
    })
    if (!current) return false
    await prisma.creatorAsset.update({
        where: { id: current.id },
        data: { deletedAt: new Date() }
    })
    const urls = [current.url, current.coverUrl].filter((url): url is string => !!url)
    await Promise.all(
        [...new Set(urls)].map(url =>
            deleteCreatorArtifactFromOSS(url).catch(error => {
                console.warn('[creator-assets] artifact deletion failed:', error instanceof Error ? error.message : error)
            })
        )
    )
    return true
}
