import { apiError, handleApiError } from '@/lib/utils'
import { exportReplicaJob } from '@/lib/replica-jobs'
import { getForwardedClientIp } from '@/lib/forwarded-client-ip'

const TASK_ID = /^[A-Za-z0-9_-]{1,160}$/
const FORMATS = new Set(['json', 'script', 'srt'])

export async function GET(request: Request, context: RouteContext<'/api/replica/jobs/[taskId]/export'>) {
    try {
        const { taskId } = await context.params
        const format = new URL(request.url).searchParams.get('format')?.trim().toLowerCase() || 'json'
        if (!TASK_ID.test(taskId)) return apiError('任务编号无效')
        if (!FORMATS.has(format)) return apiError('不支持的导出格式')
        const result = await exportReplicaJob(taskId, format, getForwardedClientIp(request.headers))
        const filename = result.filename.replace(/[\r\n"\\/]/g, '_')
        return new Response(result.content, {
            headers: {
                'Content-Type': result.contentType,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store'
            }
        })
    } catch (error) {
        return handleApiError(error, '任务结果导出失败')
    }
}
