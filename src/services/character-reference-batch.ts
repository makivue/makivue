import { runWithConcurrency } from '@/lib/bounded-concurrency'
import { getJobs, heartbeatQueuedJobs } from '@/lib/refImageJobStore'
import { updateJob as updateProjectJob } from '@/lib/projectAiJobStore'
import { REFERENCE_BATCH_CONCURRENCY, REF_IMAGE_HEARTBEAT_INTERVAL_MS } from '@/lib/reference-generation-progress'
import { runQueuedCharacterReferenceJob, type CharacterReferenceJobInput } from '@/services/character-reference-job'

export interface CharacterReferenceBatchItem {
    jobId: string
    characterId: string
    role: string
}

export interface CharacterReferenceBatchPayload {
    items: CharacterReferenceBatchItem[]
    concurrency: number
    quality: string
    replaceSelected: boolean
    mode?: 'missing' | 'all'
}

const TERMINAL_PHASES = new Set(['done', 'error', 'cancelled'])
const BATCH_SETTLE_TIMEOUT_MS = 30 * 60_000

export function isCharacterReferenceBatchPayload(value: unknown): value is CharacterReferenceBatchPayload {
    if (!value || typeof value !== 'object') return false
    const payload = value as Partial<CharacterReferenceBatchPayload>
    return (
        Array.isArray(payload.items) &&
        payload.items.every(item => item && typeof item.jobId === 'string' && typeof item.characterId === 'string' && typeof item.role === 'string') &&
        typeof payload.concurrency === 'number' &&
        typeof payload.quality === 'string' &&
        typeof payload.replaceSelected === 'boolean'
    )
}

async function waitForAllChildren(items: CharacterReferenceBatchItem[]) {
    const deadline = Date.now() + BATCH_SETTLE_TIMEOUT_MS
    const ids = items.map(item => item.jobId)
    while (Date.now() < deadline) {
        const jobs = await getJobs(ids)
        if (jobs.length === ids.length && jobs.every(job => TERMINAL_PHASES.has(job.phase))) return jobs
        await new Promise(resolve => setTimeout(resolve, 2_000))
    }
    throw new Error('角色参考图批次等待超时，请稍后查看已完成结果')
}

/** Runs a whole batch behind four server-side workers and one parent job. */
export async function runCharacterReferenceBatchJob(parentJobId: string, payload: CharacterReferenceBatchPayload, tasks: CharacterReferenceJobInput[]) {
    const childJobIds = payload.items.map(item => item.jobId)
    const heartbeat = setInterval(() => {
        void Promise.all([updateProjectJob(parentJobId, {}), heartbeatQueuedJobs(childJobIds)]).catch(error => {
            console.warn(`[character-reference-batch] heartbeat failed for ${parentJobId}:`, error)
        })
    }, REF_IMAGE_HEARTBEAT_INTERVAL_MS)
    try {
        await updateProjectJob(parentJobId, { attempts: 1 })
        await heartbeatQueuedJobs(childJobIds)
        let completed = 0
        await runWithConcurrency(tasks, REFERENCE_BATCH_CONCURRENCY, async task => {
            await runQueuedCharacterReferenceJob(task)
            completed += 1
            await updateProjectJob(parentJobId, { progress: completed })
        })
        const jobs = await waitForAllChildren(payload.items)
        const failed = jobs.filter(job => job.phase !== 'done').length
        await updateProjectJob(parentJobId, {
            phase: 'done',
            progress: jobs.length,
            total: payload.items.length,
            result: { ...payload, completed: jobs.length, failed }
        })
    } catch (error) {
        await updateProjectJob(parentJobId, { phase: 'error', error: error instanceof Error ? error.message : String(error), result: payload })
    } finally {
        clearInterval(heartbeat)
    }
}
