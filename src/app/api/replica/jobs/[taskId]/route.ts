import { apiError, apiResponse, handleApiError } from '@/lib/utils'
import { getReplicaJob } from '@/lib/replica-jobs'
import { getForwardedClientIp } from '@/lib/forwarded-client-ip'

const TASK_ID = /^[A-Za-z0-9_-]{1,160}$/

export async function GET(request: Request, context: RouteContext<'/api/replica/jobs/[taskId]'>) {
    try {
        const { taskId } = await context.params
        if (!TASK_ID.test(taskId)) return apiError('任务编号无效')
        return apiResponse(await getReplicaJob(taskId, getForwardedClientIp(request.headers)))
    } catch (error) {
        return handleApiError(error, '任务状态查询失败')
    }
}
