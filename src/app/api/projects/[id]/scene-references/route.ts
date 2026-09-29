import { randomUUID } from 'node:crypto'
import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertProjectOwner } from '@/lib/ownership'
import { apiError, apiResponse } from '@/lib/utils'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { createJob as createRefJob, updateJob as updateRefJob } from '@/lib/refImageJobStore'
import { normalizeImageQuality } from '@/lib/image-quality'
import { REFERENCE_BATCH_CONCURRENCY } from '@/lib/reference-generation-progress'
import { isImageProvider } from '@/services/ai'
import { assertSufficientPoints, BillingError, quoteGenerationPoints } from '@/services/billing'
import { assertNanoBananaCredentialsConfigured, NanoBananaConfigurationError } from '@/services/banana'
import { runSceneReferenceBatchJob, type SceneReferenceBatchPayload } from '@/services/scene-reference-batch'
import type { SceneReferenceJobInput } from '@/services/scene-reference-job'

export const maxDuration = 1800
type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const projectId = parseApiId((await params).id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard
    const body = await req.json().catch(() => ({}))
    if (!body || typeof body !== 'object') return apiError('请求格式无效', 400)
    if (!Array.isArray(body.sceneIds) || body.sceneIds.length === 0 || body.sceneIds.length > 200) return apiError('sceneIds 必须包含 1-200 个场景', 400)
    const parsed = body.sceneIds.map((id: unknown) => (typeof id === 'string' ? parseApiId(id) : null)) as Array<bigint | null>
    if (parsed.some(id => id === null)) return apiError('场景 ID 格式无效', 400)
    if (!isImageProvider(body.provider)) return apiError('图片模型无效', 400)
    const ids = [...new Set(parsed as bigint[])]
    const provider = body.provider
    const quality = normalizeImageQuality(body.imageQuality)
    const scenes = await prisma.scene.findMany({ where: { id: { in: ids }, projectId, deletedAt: null }, select: { id: true, locationPrompt: true, operationVersion: true } })
    if (scenes.length !== ids.length) return apiError('场景不属于当前项目或已删除', 400)
    if (scenes.some(scene => !scene.locationPrompt?.trim())) return apiError('场景缺少生成提示词', 400)
    try {
        if (provider === 'banana') assertNanoBananaCredentialsConfigured()
        await assertSufficientPoints(userId, quoteGenerationPoints('reference', provider))
        const parent = await createJob(projectId.toString(), 'scene_references', ids.length)
        if (parent.reused) return apiResponse({ jobId: parent.id, resumed: true }, 202)
        const createdIds: string[] = []
        try {
            const sceneById = new Map(scenes.map(scene => [scene.id, scene]))
            const tasks: SceneReferenceJobInput[] = []
            const payload: SceneReferenceBatchPayload = { items: [], concurrency: Math.min(REFERENCE_BATCH_CONCURRENCY, ids.length), quality, mode: body.mode === 'all' ? 'all' : 'missing' }
            for (const sceneId of ids) {
                const requestId = randomUUID()
                const child = await createRefJob('scene', sceneId.toString(), projectId.toString(), { promptVersion: 'scene-reference/v3', provider, quality, role: 'environment', requestId })
                payload.items.push({ jobId: child.id, sceneId: sceneId.toString() })
                if (!child.reused) {
                    createdIds.push(child.id)
                    tasks.push({
                        jobId: child.id,
                        sceneId,
                        projectId,
                        userId,
                        imageProvider: provider,
                        imageQuality: quality,
                        requestId,
                        sourceOperationVersion: sceneById.get(sceneId)!.operationVersion
                    })
                }
            }
            // Persist the batch before acknowledging it so refreshes can restore it.
            await prisma.$transaction(tx => updateJob(parent.id, { result: payload }, tx))
            after(() => withHiModelsUsageScope({ userId, jobId: parent.id }, () => runSceneReferenceBatchJob(parent.id, payload, tasks)))
            return apiResponse({ jobId: parent.id, resumed: false, total: ids.length }, 202)
        } catch (error) {
            await Promise.all(createdIds.map(id => updateRefJob(id, { phase: 'error', error: '场景参考图批次创建失败，请重试' })))
            await updateJob(parent.id, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
            throw error
        }
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        if (error instanceof NanoBananaConfigurationError) return apiError(error.message, 503)
        return apiError(error instanceof Error ? error.message : '场景批次提交失败', 500)
    }
}
