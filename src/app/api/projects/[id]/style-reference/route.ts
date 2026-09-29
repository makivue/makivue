import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { apiResponse, apiError } from '@/lib/utils'
import { generateProjectStyleReference } from '@/services/ai'
import { isImageProvider, type ImageProvider } from '@/services/ai'
import { normalizeImageQuality, type ImageQuality } from '@/lib/image-quality'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { assertSufficientPoints, BillingError, chargeModelUsage, quoteGenerationPoints } from '@/services/billing'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { assertNanoBananaCredentialsConfigured, NanoBananaConfigurationError } from '@/services/banana'

type Params = { params: Promise<{ id: string }> }
export const maxDuration = 600

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const body = await req.json().catch(() => ({}))
    const imageProvider: ImageProvider | undefined = isImageProvider(body.provider) ? body.provider : undefined
    const imageQuality = normalizeImageQuality(body.imageQuality)
    const taskProvider = imageProvider ?? 'banana'
    try {
        if (taskProvider === 'banana') assertNanoBananaCredentialsConfigured()
        await assertSufficientPoints(userId, quoteGenerationPoints('reference', taskProvider))
    } catch (err) {
        if (err instanceof BillingError) return apiError(err.message, err.status)
        if (err instanceof NanoBananaConfigurationError) return apiError(`Nano Banana 部署凭据不可用：${err.message}`, 503)
        throw err
    }

    const job = await createJob(id, 'style_reference')
    after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runStyleReferenceJob(job.id, projectId, userId, taskProvider, imageQuality)))
    return apiResponse({ jobId: job.id }, 202)
}

async function runStyleReferenceJob(jobId: string, projectId: bigint, userId: bigint, taskProvider: ImageProvider, imageQuality: ImageQuality) {
    try {
        await updateJob(jobId, { attempts: 1 })
        const operationId = `project-style:${jobId}`
        const { url } = await generateProjectStyleReference(projectId, {
            provider: taskProvider,
            quality: imageQuality,
            beforeSave: (tx, generation) =>
                chargeModelUsage({
                    userId,
                    tx,
                    idempotencyKey: `usage:${operationId}`,
                    sourceType: 'project_style_reference',
                    sourceId: operationId,
                    description: `项目风格参考图 · ${generation.actualProvider}`,
                    metadata: { projectId: projectId.toString(), provider: generation.actualProvider, requestedProvider: taskProvider }
                })
        })
        await updateJob(jobId, { phase: 'done', result: { styleReferenceImageUrl: url } })
    } catch (err) {
        await updateJob(jobId, { phase: 'error', error: err instanceof Error ? err.message : String(err) })
    }
}
