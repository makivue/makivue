import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { updateJob } from '@/lib/refImageJobStore'
import { waitForReferenceImageSlot } from '@/lib/generation-concurrency'
import { generateSceneReference, type ImageProvider } from '@/services/ai'
import type { ImageQuality } from '@/lib/image-quality'
import { chargeModelUsage } from '@/services/billing'
import { withActiveReferenceWrite, StaleReferenceMutationError } from '@/services/reference-persistence-guard'
import { markReferenceDependentsStaleInTransaction } from '@/services/content-lineage'
import { createSceneReferenceSelection, getSelectedSceneReferenceUrls } from '@/lib/scene-reference-selection'
import { isRefImageJobRuntimeExceeded, referenceProgressAt, REF_IMAGE_HEARTBEAT_INTERVAL_MS, REF_IMAGE_JOB_MAX_RUNTIME_MS, type ReferenceGenerationProgress } from '@/lib/reference-generation-progress'

export interface SceneReferenceJobInput {
    jobId: string
    sceneId: bigint
    projectId: bigint
    userId: bigint
    imageProvider: ImageProvider
    imageQuality: ImageQuality
    requestId: string
    sourceOperationVersion: number
}

export async function runQueuedSceneReferenceJob(input: SceneReferenceJobInput) {
    try {
        const claimed = await waitForReferenceImageSlot({ userId: input.userId, projectId: input.projectId, jobId: BigInt(input.jobId) })
        if (claimed)
            await withHiModelsUsageScope({ userId: input.userId, jobId: input.jobId }, () =>
                runSceneRefJob(input.jobId, input.sceneId, input.userId, input.imageProvider, input.imageQuality, input.requestId, input.sourceOperationVersion)
            )
    } catch (error) {
        await updateJob(input.jobId, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
}

function parseCandidates(raw: string | null | undefined): string[] {
    if (!raw) return []
    try {
        const value = JSON.parse(raw)
        return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
    } catch {
        return []
    }
}

async function runSceneRefJob(jobId: string, sceneId: bigint, userId: bigint, imageProvider: ImageProvider, imageQuality: ImageQuality, requestId: string, sourceOperationVersion: number) {
    const startedAt = Date.now()
    let latestProgress: ReferenceGenerationProgress | undefined
    const heartbeat = setInterval(() => {
        if (isRefImageJobRuntimeExceeded(startedAt)) {
            clearInterval(heartbeat)
            void updateJob(jobId, {
                phase: 'error',
                error: `场景参考图单项任务超时（超过 ${Math.round(REF_IMAGE_JOB_MAX_RUNTIME_MS / 60_000)} 分钟），已停止等待，请重试`
            })
            return
        }
        const progress = referenceProgressAt(latestProgress, startedAt)
        void updateJob(jobId, progress ? { result: { progress } } : {})
    }, REF_IMAGE_HEARTBEAT_INTERVAL_MS)
    try {
        await updateJob(jobId, { attempts: 1 })
        const source = await prisma.scene.findFirst({ where: { id: sceneId, deletedAt: null }, select: { projectId: true, operationVersion: true, project: { select: { operationVersion: true } } } })
        if (!source) throw new Error('Scene not found')
        if (source.operationVersion !== sourceOperationVersion) throw new StaleReferenceMutationError()
        const generated = await generateSceneReference(sceneId, {
            commit: false,
            provider: imageProvider,
            quality: imageQuality,
            generationNonce: requestId,
            onProgress: async progress => {
                latestProgress = progress
                await updateJob(jobId, { result: { progress } })
            }
        })
        const url = generated.url
        const actualProvider = generated.generation.actualProvider
        await updateJob(jobId, { phase: 'writing_db' })
        const { candidates, referenceImageUrl, nextSelectedReferenceUrls } = await withActiveReferenceWrite(
            { type: 'scene', id: sceneId, ...source, jobId, projectOperationVersion: source.project.operationVersion },
            async tx => {
                const scene = await tx.scene.findFirst({ where: { id: sceneId, deletedAt: null } })
                if (!scene) throw new Error('Scene not found')
                const candidates = [...new Set([url, ...parseCandidates(scene.referenceCandidates)])].slice(0, 8)
                const selectedReferenceUrls = getSelectedSceneReferenceUrls(scene.referenceAssets, scene.referenceImageUrl)
                const nextSelectedReferenceUrls = selectedReferenceUrls.length > 0 ? selectedReferenceUrls : [url]
                const referenceImageUrl = scene.referenceImageUrl && nextSelectedReferenceUrls.includes(scene.referenceImageUrl) ? scene.referenceImageUrl : nextSelectedReferenceUrls[0]
                await tx.scene.update({
                    where: { id: sceneId },
                    data: {
                        ...(referenceImageUrl !== scene.referenceImageUrl ? { sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } } : {}),
                        referenceCandidates: JSON.stringify(candidates),
                        referenceImageUrl,
                        referenceAssets: createSceneReferenceSelection(nextSelectedReferenceUrls) as unknown as Prisma.InputJsonValue
                    }
                })
                if (referenceImageUrl !== scene.referenceImageUrl)
                    await markReferenceDependentsStaleInTransaction(tx, { type: 'scene', id: sceneId, projectId: scene.projectId }, '场景定稿参考图已变化，请重新生成关联分镜帧和视频')
                await chargeModelUsage({
                    tx,
                    userId,
                    idempotencyKey: `usage:reference-job:${jobId}`,
                    sourceType: 'reference_job',
                    sourceId: jobId,
                    description: `场景参考图 · ${actualProvider}`,
                    metadata: { targetType: 'scene', targetId: sceneId.toString(), provider: actualProvider, requestedProvider: imageProvider }
                })
                return { candidates, referenceImageUrl, nextSelectedReferenceUrls }
            }
        )

        await updateJob(jobId, {
            phase: 'done',
            result: {
                targetType: 'scene',
                targetId: sceneId.toString(),
                candidateUrl: url,
                referenceImageUrl,
                referenceCandidates: candidates,
                selectedReferenceUrls: nextSelectedReferenceUrls,
                provider: actualProvider,
                requestedProvider: imageProvider,
                recovery: generated.generation.recovery,
                fallbackReason: generated.generation.fallbackReason,
                providerSwitch: generated.generation.providerSwitch,
                timings: latestProgress
                    ? { ...latestProgress.timings, totalMs: Date.now() - startedAt }
                    : { generationMs: 0, inspectionMs: 0, uploadMs: 0, totalMs: Date.now() - startedAt, retryCount: 0 }
            }
        })
    } catch (err) {
        await updateJob(jobId, {
            phase: 'error',
            error: err instanceof Error ? err.message : String(err)
        })
    } finally {
        clearInterval(heartbeat)
    }
}
