import { after, NextRequest } from 'next/server'
import { readHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { getJob } from '@/lib/projectAiJobStore'
import { kickProjectImportWorker, publicProjectImportStatus, runProjectImportJob } from '@/services/project-import-worker'
import { getProjectImportStatusRemotely, remoteImportResponse, shouldUseRemoteProjectImport } from '@/lib/project-import-remote'

export const maxDuration = 300

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)

    const { jobId } = await params
    if (shouldUseRemoteProjectImport()) {
        try {
            return remoteImportResponse(await getProjectImportStatusRemotely(req, jobId))
        } catch (error) {
            console.error('[project-import] remote status failed', error)
            return apiError('测试环境导入服务暂时不可用，请稍后重试', 503)
        }
    }

    const job = await getJob(jobId)
    if (!job || job.kind !== 'project_import' || job.projectId !== userId.toString()) {
        return apiError('Job not found or expired', 404)
    }

    if (['queued', 'generating', 'writing_db'].includes(job.phase)) {
        // A normal poll doubles as a recovery signal after a hot reload,
        // deployment, or worker restart. The claim is lease-guarded.
        after(() => runProjectImportJob(job.id))
        kickProjectImportWorker()
    }

    return apiResponse({ ...publicProjectImportStatus(job), ...(await readHiModelsUsage(userId, { jobId: job.id })) })
}
