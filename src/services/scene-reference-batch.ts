import { runWithConcurrency } from '@/lib/bounded-concurrency'
import { getJobs, heartbeatQueuedJobs, updateJob as updateRefJob } from '@/lib/refImageJobStore'
import { getJob, updateJob } from '@/lib/projectAiJobStore'
import { REFERENCE_BATCH_CONCURRENCY, REF_IMAGE_HEARTBEAT_INTERVAL_MS } from '@/lib/reference-generation-progress'
import { runQueuedSceneReferenceJob, type SceneReferenceJobInput } from '@/services/scene-reference-job'
import type { ImageQuality } from '@/lib/image-quality'

export interface SceneReferenceBatchPayload {
    items: Array<{ jobId: string; sceneId: string }>
    concurrency: number
    quality: ImageQuality
    mode: 'missing' | 'all'
}

export function isSceneReferenceBatchPayload(value: unknown): value is SceneReferenceBatchPayload {
    if (!value || typeof value !== 'object') return false
    const payload = value as Partial<SceneReferenceBatchPayload>
    return (
        Array.isArray(payload.items) &&
        payload.items.every(item => item && typeof item.jobId === 'string' && typeof item.sceneId === 'string') &&
        typeof payload.concurrency === 'number' &&
        typeof payload.quality === 'string' &&
        (payload.mode === 'missing' || payload.mode === 'all')
    )
}

export async function runSceneReferenceBatchJob(parentJobId: string, payload: SceneReferenceBatchPayload, tasks: SceneReferenceJobInput[]) {
    const ids = payload.items.map(item => item.jobId)
    const heartbeat = setInterval(() => {
        void Promise.all([updateJob(parentJobId, {}), heartbeatQueuedJobs(ids)]).catch(error => console.warn('[scene-reference-batch] heartbeat failed', error))
    }, REF_IMAGE_HEARTBEAT_INTERVAL_MS)
    try {
        await heartbeatQueuedJobs(ids)
        await runWithConcurrency(tasks, REFERENCE_BATCH_CONCURRENCY, async task => {
            try {
                const parent = await getJob(parentJobId)
                if (!parent || ['done', 'error', 'cancelled'].includes(parent.phase)) {
                    await updateRefJob(task.jobId, { phase: 'cancelled', error: '批次已停止' })
                    return
                }
                await runQueuedSceneReferenceJob(task)
            } catch (error) {
                await updateRefJob(task.jobId, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
            }
        })
        // Wait for reused children as well as this worker's own tasks.
        const deadline = Date.now() + 30 * 60_000
        while (Date.now() < deadline) {
            const parent = await getJob(parentJobId)
            if (!parent || ['done', 'error', 'cancelled'].includes(parent.phase)) return
            const jobs = await getJobs(ids)
            // Missing rows are terminal failures in the status response too.
            if (jobs.every(job => ['done', 'error', 'cancelled'].includes(job.phase))) {
                await updateJob(parentJobId, { phase: 'done', progress: ids.length, result: payload })
                return
            }
            await new Promise(resolve => setTimeout(resolve, 5_000))
        }
        throw new Error('场景参考图批次等待超时，请查看已完成结果后重试')
    } catch (error) {
        await updateJob(parentJobId, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
    } finally {
        clearInterval(heartbeat)
    }
}
