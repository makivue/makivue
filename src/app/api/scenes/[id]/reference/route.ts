import { after, NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { lockCurrentReferenceInTransaction, StaleReferenceMutationError } from '@/services/reference-persistence-guard'
import { isImageProvider, type ImageProvider } from '@/services/ai'
import { normalizeImageQuality } from '@/lib/image-quality'
import { currentUserId } from '@/lib/current-user'
import { assertSceneOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { createJob } from '@/lib/refImageJobStore'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { assertNanoBananaCredentialsConfigured, NanoBananaConfigurationError } from '@/services/banana'
import { markReferenceDependentsStaleInTransaction } from '@/services/content-lineage'
import type { Prisma } from '@/generated/prisma/client'
import { createSceneReferenceSelection, getSelectedSceneReferenceUrls, MAX_SELECTED_SCENE_REFERENCES } from '@/lib/scene-reference-selection'
import { runQueuedSceneReferenceJob } from '@/services/scene-reference-job'
import { resolveGenerationRequestId } from '@/lib/generation-request'

type Params = { params: Promise<{ id: string }> }
export const maxDuration = 1800

function parseCandidates(raw: string | null | undefined): string[] {
    if (!raw) return []
    try {
        const value = JSON.parse(raw)
        return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
    } catch {
        return []
    }
}

// 生成场景候选图：耗时长（图片模型 30~90s，慢的时候会顶网关 60s 超时），改为异步。
// 立即返回 jobId，后台跑生成 + 写库，前端轮询 /api/scenes/[id]/reference/status/[jobId]。
// select / delete / clear 仍然同步返回。
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('场景 ID 格式无效', 400)
    const guard = await assertSceneOwner(idNum, userId)
    if (guard) return guard
    try {
        const body = await req.json().catch(() => ({}))
        if (body.action === 'select') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            if (body.url.length > 512) return apiError('场景参考图 URL 过长')
            const scene = await prisma.scene.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!scene) return apiError('Scene not found', 404)
            const selectedReferenceUrls = getSelectedSceneReferenceUrls(scene.referenceAssets, scene.referenceImageUrl)
            if (selectedReferenceUrls.includes(body.url)) {
                return apiResponse({ referenceImageUrl: scene.referenceImageUrl, selectedReferenceUrls, stale: false })
            }
            if (selectedReferenceUrls.length >= MAX_SELECTED_SCENE_REFERENCES) {
                return apiError(`每个场景最多选择 ${MAX_SELECTED_SCENE_REFERENCES} 张视角参考图`, 400)
            }
            const nextSelectedReferenceUrls = [...selectedReferenceUrls, body.url]
            const referenceImageUrl = scene.referenceImageUrl && nextSelectedReferenceUrls.includes(scene.referenceImageUrl) ? scene.referenceImageUrl : nextSelectedReferenceUrls[0]
            const stale = await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'scene', ...scene })
                    await tx.scene.update({
                        where: { id: idNum },
                        data: {
                            referenceImageUrl,
                            referenceAssets: createSceneReferenceSelection(nextSelectedReferenceUrls) as unknown as Prisma.InputJsonValue,
                            sourceVersion: { increment: 1 },
                            operationVersion: { increment: 1 }
                        }
                    })
                    return markReferenceDependentsStaleInTransaction(tx, { type: 'scene', id: idNum, projectId: scene.projectId }, '场景参考视角组已变更，请重新生成关联分镜帧和视频')
                },
                { timeout: 60_000 }
            )
            return apiResponse({ referenceImageUrl, selectedReferenceUrls: nextSelectedReferenceUrls, stale })
        }

        if (body.action === 'unselect') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            const scene = await prisma.scene.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!scene) return apiError('Scene not found', 404)
            const selectedReferenceUrls = getSelectedSceneReferenceUrls(scene.referenceAssets, scene.referenceImageUrl)
            if (!selectedReferenceUrls.includes(body.url)) {
                return apiResponse({ referenceImageUrl: scene.referenceImageUrl, selectedReferenceUrls, stale: false })
            }
            const nextSelectedReferenceUrls = selectedReferenceUrls.filter(url => url !== body.url)
            const referenceImageUrl = scene.referenceImageUrl && nextSelectedReferenceUrls.includes(scene.referenceImageUrl) ? scene.referenceImageUrl : (nextSelectedReferenceUrls[0] ?? null)
            const stale = await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'scene', ...scene })
                    await tx.scene.update({
                        where: { id: idNum },
                        data: {
                            referenceImageUrl,
                            referenceAssets: createSceneReferenceSelection(nextSelectedReferenceUrls) as unknown as Prisma.InputJsonValue,
                            sourceVersion: { increment: 1 },
                            operationVersion: { increment: 1 }
                        }
                    })
                    return markReferenceDependentsStaleInTransaction(tx, { type: 'scene', id: idNum, projectId: scene.projectId }, '场景参考视角组已变更，请重新生成关联分镜帧和视频')
                },
                { timeout: 60_000 }
            )
            return apiResponse({ referenceImageUrl, selectedReferenceUrls: nextSelectedReferenceUrls, stale })
        }

        if (body.action === 'delete') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            const scene = await prisma.scene.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!scene) return apiError('Scene not found', 404)
            const selectedReferenceUrls = getSelectedSceneReferenceUrls(scene.referenceAssets, scene.referenceImageUrl)
            if (selectedReferenceUrls.includes(body.url)) return apiError('已选视角不能删除，请先将它移出参考组')
            let candidates = parseCandidates(scene.referenceCandidates).filter(url => url !== body.url)
            await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'scene', ...scene })
                    const latest = await tx.scene.findUniqueOrThrow({ where: { id: idNum } })
                    candidates = parseCandidates(latest.referenceCandidates).filter(url => url !== body.url)
                    await tx.scene.update({ where: { id: idNum }, data: { referenceCandidates: JSON.stringify(candidates) } })
                },
                { timeout: 60_000 }
            )
            return apiResponse({ referenceCandidates: candidates })
        }

        if (body.action === 'clear') {
            if (!body.url || typeof body.url !== 'string') return apiError('url required')
            const scene = await prisma.scene.findFirst({ where: { id: idNum, deletedAt: null } })
            if (!scene) return apiError('Scene not found', 404)
            let candidates = parseCandidates(scene.referenceCandidates).filter(url => url !== body.url)
            const previousSelectedReferenceUrls = getSelectedSceneReferenceUrls(scene.referenceAssets, scene.referenceImageUrl)
            const selectedReferenceUrls = previousSelectedReferenceUrls.filter(url => url !== body.url)
            const selectionChanged = selectedReferenceUrls.length !== previousSelectedReferenceUrls.length
            const referenceImageUrl = scene.referenceImageUrl === body.url ? (selectedReferenceUrls[0] ?? null) : scene.referenceImageUrl
            const stale = await prisma.$transaction(
                async tx => {
                    await lockCurrentReferenceInTransaction(tx, { type: 'scene', ...scene })
                    const latest = await tx.scene.findUniqueOrThrow({ where: { id: idNum } })
                    candidates = parseCandidates(latest.referenceCandidates).filter(url => url !== body.url)
                    await tx.scene.update({
                        where: { id: idNum },
                        data: {
                            referenceImageUrl,
                            referenceCandidates: JSON.stringify(candidates),
                            referenceAssets: createSceneReferenceSelection(selectedReferenceUrls) as unknown as Prisma.InputJsonValue,
                            ...(selectionChanged ? { sourceVersion: { increment: 1 }, operationVersion: { increment: 1 } } : {})
                        }
                    })
                    return selectionChanged
                        ? markReferenceDependentsStaleInTransaction(tx, { type: 'scene', id: idNum, projectId: scene.projectId }, '场景定稿参考图已清除，请重新生成关联分镜帧和视频')
                        : { storyboards: 0 }
                },
                { timeout: 60_000 }
            )
            return apiResponse({ referenceImageUrl, referenceCandidates: candidates, selectedReferenceUrls, stale })
        }

        const scene = await prisma.scene.findFirst({ where: { id: idNum, deletedAt: null } })
        if (!scene) return apiError('Scene not found', 404)

        const imageProvider: ImageProvider | undefined = isImageProvider(body.provider) ? body.provider : undefined
        const imageQuality = normalizeImageQuality(body.imageQuality)
        const taskProvider = imageProvider ?? 'banana'
        const requestId = resolveGenerationRequestId(body.requestId)
        if (taskProvider === 'banana') assertNanoBananaCredentialsConfigured()
        await assertSufficientPoints(userId, quoteGenerationPoints('reference', taskProvider))

        const job = await createJob('scene', idNum.toString(), scene.projectId.toString(), {
            promptVersion: 'scene-reference/v3',
            provider: taskProvider,
            quality: imageQuality,
            role: 'environment',
            requestId
        })
        if (!(job as typeof job & { reused?: boolean }).reused) {
            after(() =>
                runQueuedSceneReferenceJob({
                    jobId: job.id,
                    sceneId: idNum,
                    projectId: scene.projectId,
                    userId,
                    imageProvider: taskProvider,
                    imageQuality,
                    requestId,
                    sourceOperationVersion: scene.operationVersion
                })
            )
        }
        return apiResponse({ jobId: job.id, queued: job.phase === 'queued', resumed: Boolean((job as typeof job & { reused?: boolean }).reused) })
    } catch (err) {
        if (err instanceof StaleReferenceMutationError) return apiError(err.message, 409)
        if (err instanceof BillingError) return apiError(err.message, err.status)
        if (err instanceof NanoBananaConfigurationError) return apiError(`Nano Banana 部署凭据不可用：${err.message}`, 503)
        const msg = err instanceof Error ? err.message : String(err)
        return apiError(msg, 500)
    }
}
