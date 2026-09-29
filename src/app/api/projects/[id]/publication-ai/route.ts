import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, NextRequest } from 'next/server'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { currentUserId } from '@/lib/current-user'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { normalizePublicationMediaUrls, publicationCoverCandidates, publicationTrailerCandidates } from '@/lib/publication-media'
import { parseApiId } from '@/lib/api-id'
import { assertProjectOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { apiError, apiResponse } from '@/lib/utils'
import { getImageProviderCapability } from '@/lib/provider-capabilities'
import { assertSufficientPoints, BillingError, chargeLlmUsage, chargeModelUsage, quoteGenerationPoints, quoteLlmBudgetPoints } from '@/services/billing'
import { generateImageUnified, getImageProvider, resolveImageProviderForReferences, type ImageProvider } from '@/services/ai'
import { withCreatorReferenceVideoFrames } from '@/services/creator-reference-video-frames'
import { deleteLocalMediaWithinSubdirectory, saveImmutableLocalImage } from '@/services/local-media'
import {
    buildPublicationCoverPrompts,
    generatePublicationMetadata,
    publicationGenerationContext,
    toPublicationGenerationSource,
    type GeneratedPublicationMetadata,
    type PublicationGenerationSource
} from '@/services/publication-generation'
import type { StoryboardReferenceVideo } from '@/lib/storyboard-reference-videos'

type Params = { params: Promise<{ id: string }> }

const COVER_VARIANT_COUNT = 3

const PUBLICATION_AI_SELECT = {
    id: true,
    title: true,
    description: true,
    genre: true,
    genreLabel: true,
    visualStyle: true,
    contentLanguage: true,
    totalEpisodes: true,
    seoTitle: true,
    seoDescription: true,
    seoKeywords: true,
    coverUrl: true,
    coverAlt: true,
    trailerUrl: true,
    publicationCoverCandidates: true,
    publicationTrailerCandidates: true,
    novelSetup: true,
    characters: { where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 12, select: { name: true, role: true, personality: true, referenceImageUrl: true } },
    scenes: { where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 12, select: { name: true, description: true, referenceImageUrl: true } },
    episodes: {
        where: { deletedAt: null },
        orderBy: { episodeNumber: 'asc' },
        take: 30,
        select: {
            id: true,
            episodeNumber: true,
            title: true,
            synopsis: true,
            videoUrl: true,
            storyboards: { where: { deletedAt: null }, orderBy: { order: 'asc' }, take: 3, select: { order: true, firstFrameUrl: true, lastFrameUrl: true } }
        }
    }
} as const

type PublicationAiProject = NonNullable<Awaited<ReturnType<typeof loadPublicationAiProject>>>

export const runtime = 'nodejs'
export const maxDuration = 600

async function loadPublicationAiProject(projectId: bigint) {
    return prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: PUBLICATION_AI_SELECT })
}

function generationSource(project: PublicationAiProject): PublicationGenerationSource {
    return toPublicationGenerationSource({
        title: project.title,
        description: project.description,
        genre: project.genreLabel ?? project.genre,
        visualStyle: project.visualStyle,
        contentLanguage: project.contentLanguage,
        totalEpisodes: project.totalEpisodes,
        characters: project.characters,
        scenes: project.scenes,
        episodes: project.episodes
    })
}

function currentMetadata(project: PublicationAiProject): GeneratedPublicationMetadata {
    return {
        seoTitle: project.seoTitle?.trim() || project.title,
        seoDescription: project.seoDescription?.trim() || project.description?.trim() || '',
        seoKeywords: Array.isArray(project.seoKeywords) ? project.seoKeywords.filter((value): value is string => typeof value === 'string') : [],
        coverAlt: project.coverAlt?.trim() || `${project.title}作品封面`
    }
}

function referenceVideo(project: PublicationAiProject): StoryboardReferenceVideo | undefined {
    const candidate = publicationTrailerCandidates(project).find(item => item.source === 'episode')
    if (!candidate) return undefined
    const extension = candidate.url.split(/[?#]/, 1)[0].toLowerCase()
    const mimeType = extension.endsWith('.webm') ? 'video/webm' : extension.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'
    return {
        id: candidate.episodeId ?? candidate.url,
        url: candidate.url,
        name: candidate.label,
        mimeType,
        sizeBytes: 1,
        durationSeconds: 1,
        createdAt: new Date().toISOString()
    }
}

async function runMetadataJob(jobId: string, project: PublicationAiProject, userId: bigint) {
    try {
        await updateJob(jobId, { attempts: 1, total: 1 })
        const source = generationSource(project)
        const { metadata, model, input } = await generatePublicationMetadata(source)
        await prisma.$transaction(async tx => {
            await chargeLlmUsage({ userId, jobId, task: '作品发布资料生成', input, output: metadata, model, tx })
            await tx.project.update({
                where: { id: project.id },
                data: { seoTitle: metadata.seoTitle, seoDescription: metadata.seoDescription, seoKeywords: metadata.seoKeywords, coverAlt: metadata.coverAlt }
            })
            await updateJob(jobId, { phase: 'done', progress: 1, total: 1, result: { metadata } }, tx)
        }, BILLING_TRANSACTION_OPTIONS)
    } catch (error) {
        await updateJob(jobId, { phase: 'error', error: error instanceof Error ? error.message : '作品资料生成失败' })
    }
}

async function runCoverJob(jobId: string, project: PublicationAiProject, userId: bigint, provider: ImageProvider) {
    let tempDir: string | null = null
    const uploadedUrls: string[] = []
    const subdir = `projects/${project.id}/publication`
    try {
        const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-publication-covers-'))
        tempDir = workDir
        await updateJob(jobId, { attempts: 1, total: COVER_VARIANT_COUNT })
        const source = generationSource(project)
        const prompts = buildPublicationCoverPrompts(source, currentMetadata(project))
        const video = referenceVideo(project)
        const maxReferences = Math.min(3, getImageProviderCapability(provider)?.maxImageReferences ?? 0)
        const imageBudget = Math.max(0, maxReferences - (video ? 1 : 0))
        const sourceImages = publicationCoverCandidates(project)
            .filter(candidate => candidate.source !== 'generated')
            .map(candidate => candidate.url)
            .slice(0, imageBudget)

        const generations = await withCreatorReferenceVideoFrames(video, sourceImages, async referenceImages => {
            const results = []
            for (const [index, prompt] of prompts.entries()) {
                const filename = `cover_${project.id}_${Date.now()}_${index + 1}_${randomUUID()}.png`
                const outputPath = path.join(workDir, filename)
                const generation = await generateImageUnified({
                    prompt,
                    referenceImages,
                    outputAbsPath: outputPath,
                    aspectRatio: '3:4',
                    provider,
                    quality: 'ultra',
                    contentLabel: `作品“${project.title}”封面候选 ${index + 1}`
                })
                const url = await saveImmutableLocalImage(outputPath, subdir, filename)
                uploadedUrls.push(url)
                results.push(generation)
                await updateJob(jobId, { progress: index + 1, total: COVER_VARIANT_COUNT, result: { coverCandidates: [...uploadedUrls] } })
            }
            return results
        })

        await prisma.$transaction(async tx => {
            await chargeModelUsage({
                userId,
                tx,
                idempotencyKey: `usage:publication-covers:${jobId}`,
                sourceType: 'publication_covers',
                sourceId: jobId,
                description: `作品封面候选生成 · ${generations.map(generation => generation.actualProvider).join(' / ')}`,
                metadata: { projectId: project.id.toString(), variants: uploadedUrls.length, requestedProvider: provider }
            })
            const latest = await tx.project.findUnique({ where: { id: project.id }, select: { coverUrl: true, publicationCoverCandidates: true } })
            const candidates = normalizePublicationMediaUrls([...uploadedUrls, ...normalizePublicationMediaUrls(latest?.publicationCoverCandidates)])
            await tx.project.update({ where: { id: project.id }, data: { publicationCoverCandidates: candidates, coverUrl: latest?.coverUrl ?? uploadedUrls[0] } })
            await updateJob(jobId, { phase: 'done', progress: COVER_VARIANT_COUNT, total: COVER_VARIANT_COUNT, result: { coverCandidates: uploadedUrls } }, tx)
        }, BILLING_TRANSACTION_OPTIONS)
    } catch (error) {
        await Promise.all(uploadedUrls.map(url => deleteLocalMediaWithinSubdirectory(url, subdir).catch(() => {})))
        await updateJob(jobId, { phase: 'error', error: error instanceof Error ? error.message : '封面候选生成失败' })
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard
    const body = (await req.json().catch(() => null)) as { action?: unknown } | null
    const action = body?.action
    if (action !== 'metadata' && action !== 'covers') return apiError('AI 生成类型无效')
    const project = await loadPublicationAiProject(projectId)
    if (!project) return apiError('Project not found', 404)

    try {
        if (action === 'metadata') {
            const source = generationSource(project)
            await assertSufficientPoints(userId, quoteLlmBudgetPoints(publicationGenerationContext(source), 1_200))
            const job = await createJob(id, 'publication_metadata', 1)
            if (!job.reused) after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runMetadataJob(job.id, project, userId)))
            return apiResponse({ jobId: job.id }, 202)
        }

        const possibleReferenceCount = Math.min(3, publicationCoverCandidates(project).length + (referenceVideo(project) ? 1 : 0))
        const provider = resolveImageProviderForReferences(await getImageProvider(), possibleReferenceCount)
        const pointsPerImage = quoteGenerationPoints('image', provider)
        await assertSufficientPoints(userId, pointsPerImage === null ? null : pointsPerImage * COVER_VARIANT_COUNT)
        const job = await createJob(id, 'publication_covers', COVER_VARIANT_COUNT)
        if (!job.reused) after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runCoverJob(job.id, project, userId, provider)))
        return apiResponse({ jobId: job.id }, 202)
    } catch (error) {
        return apiError(error instanceof Error ? error.message : 'AI 生成任务创建失败', error instanceof BillingError ? error.status : 500)
    }
}
