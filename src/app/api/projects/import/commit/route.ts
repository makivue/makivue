import { after, NextRequest } from 'next/server'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { getJob } from '@/lib/projectAiJobStore'
import { parseImportTextFast, type DetectedScriptResult } from '@/services/script-import'
import { persistDetectedImport, type ImportVideoAspectRatio } from '@/services/project-import'
import { VISUAL_STYLE_PRESETS } from '@/lib/novel'
import { kickProjectImportWorker, queueProjectImportCommit, runProjectImportJob } from '@/services/project-import-worker'
import { recommendImportVisualStyle, type ProjectImportPreview } from '@/lib/project-import-preview'
import { IMPORT_MAX_TEXT_LENGTH } from '@/lib/project-metadata'
import { parseApiId } from '@/lib/api-id'
import { commitProjectImportRemotely, remoteImportResponse, shouldUseRemoteProjectImport } from '@/lib/project-import-remote'
import { assertWalletHasCoins, BillingError } from '@/services/billing'
import { isLocale } from '@/i18n/config'
import { isProjectEpisodeFormat } from '@/lib/project-publication'

export const maxDuration = 300

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const body = await req.json().catch(() => null)
    if (!body) return apiError('jobId required')

    try {
        await assertWalletHasCoins(userId)
    } catch (error) {
        return apiError(error instanceof Error ? error.message : '积分校验失败', error instanceof BillingError ? error.status : 500)
    }

    try {
        // Optional escape hatch for environments that cannot reach the shared
        // test database directly. Normal local development uses .env.local's
        // public test-database endpoint so project state is committed in one
        // transaction and remains internally consistent.
        if (shouldUseRemoteProjectImport()) {
            const result = await commitProjectImportRemotely(req, body as Record<string, unknown>)
            return remoteImportResponse(result)
        }

        if (typeof body.text === 'string') {
            const rawText = body.text.trim()
            if (rawText.length < 20) return apiError('导入内容过短，请提供更完整的剧本')
            if (rawText.length > IMPORT_MAX_TEXT_LENGTH) return apiError('导入内容过长，请拆分后再导入（限 20 万字以内）')
            const filename = typeof body.filename === 'string' ? body.filename : undefined
            const detected = parseImportTextFast(rawText, filename)
            const requestedStyle = typeof body.visualStyle === 'string' ? body.visualStyle : recommendImportVisualStyle(detected, rawText)
            const visualStyle = VISUAL_STYLE_PRESETS.some(style => style.key === requestedStyle) ? requestedStyle : VISUAL_STYLE_PRESETS[0].key
            const videoAspectRatio: ImportVideoAspectRatio = body.videoAspectRatio === '16:9' || body.videoAspectRatio === '1:1' ? body.videoAspectRatio : '9:16'
            const contentLanguage = isLocale(body.contentLanguage) ? body.contentLanguage : undefined
            const episodeFormat = isProjectEpisodeFormat(body.episodeFormat) ? body.episodeFormat : undefined
            const importId = typeof body.importId === 'string' ? parseApiId(body.importId) : null
            if (importId === null) return apiError('导入识别结果已失效，请重新识别', 409)
            const result = await persistDetectedImport({ userId, detected, visualStyle, videoAspectRatio, contentLanguage, episodeFormat, projectId: importId })
            return apiResponse(result)
        }

        if (typeof body.jobId !== 'string') return apiError('jobId required')

        const job = await getJob(body.jobId)
        if (!job || job.kind !== 'project_import' || job.projectId !== userId.toString()) return apiError('Job not found or expired', 404)
        if (job.phase !== 'awaiting_confirmation') return apiError(job.phase === 'done' ? '该导入任务已完成' : '导入任务尚未完成识别', 409)

        const stored = job.result as { detected?: DetectedScriptResult; preview?: ProjectImportPreview } | undefined
        if (!stored?.detected) return apiError('导入识别结果已失效，请重新识别', 409)
        const detected = stored.detected
        const requestedStyle = typeof body.visualStyle === 'string' ? body.visualStyle : stored.preview?.recommendedVisualStyle
        const visualStyle = VISUAL_STYLE_PRESETS.some(style => style.key === requestedStyle) ? requestedStyle! : VISUAL_STYLE_PRESETS[0].key
        const videoAspectRatio: ImportVideoAspectRatio = body.videoAspectRatio === '16:9' || body.videoAspectRatio === '1:1' ? body.videoAspectRatio : '9:16'
        const contentLanguage = isLocale(body.contentLanguage) ? body.contentLanguage : undefined
        const episodeFormat = isProjectEpisodeFormat(body.episodeFormat) ? body.episodeFormat : undefined

        const queued = await queueProjectImportCommit({
            jobId: job.id,
            userId,
            detected,
            preview: stored.preview,
            visualStyle,
            videoAspectRatio,
            contentLanguage,
            episodeFormat
        })
        if (!queued) return apiError('导入任务正在提交，请勿重复操作', 409)
        after(() => runProjectImportJob(job.id))
        kickProjectImportWorker()
        return apiResponse({ jobId: job.id }, 202)
    } catch (error) {
        console.error('[project-import] commit failed', error)
        return apiError('服务暂时不可用，请稍后重试', 503)
    }
}
