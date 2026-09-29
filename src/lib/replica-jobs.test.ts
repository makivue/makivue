import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const model = vi.hoisted(() => ({ run: vi.fn(), poll: vi.fn() }))
vi.mock('@/services/local-replica', () => ({ runLocalReplica: model.run, pollLocalReplicaVideo: model.poll }))
import { exportReplicaJob, getReplicaJob, listReplicaJobs, processReplicaJob, submitReplicaJob } from './replica-jobs'
let directory: string
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-replica-jobs-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
    vi.stubEnv('OPENAI_API_KEY', 'fixture')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
    model.run.mockReset()
})
afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
})
it('persists local jobs and exports results without a business API', async () => {
    model.run.mockImplementation(async (_id, data) => ({ ...data, output: { summary: 'local analysis', script: 'local script' } }))
    const job = await submitReplicaJob('analyze', { videoUrl: '/api/local-media/replica/input.mp4' })
    await Promise.all([processReplicaJob(job.taskId), processReplicaJob(job.taskId)])
    expect(model.run).toHaveBeenCalledTimes(1)
    expect((await getReplicaJob(job.taskId)).status).toBe('completed')
    expect((await listReplicaJobs({})).total).toBe(1)
    expect((await exportReplicaJob(job.taskId, 'script')).content).toBe('local script')
    expect(fetch).not.toHaveBeenCalled()
})
it('records model failures and does not silently resubmit paid requests', async () => {
    model.run.mockRejectedValue(new Error('supplier unavailable'))
    const job = await submitReplicaJob('full', { videoUrl: '/api/local-media/replica/input.mp4' })
    await processReplicaJob(job.taskId)
    await processReplicaJob(job.taskId)
    expect(model.run).toHaveBeenCalledTimes(1)
    expect((await getReplicaJob(job.taskId)).errorMessage).toBe('supplier unavailable')
})
