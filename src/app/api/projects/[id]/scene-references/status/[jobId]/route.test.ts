import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), getJob: vi.fn(), getJobs: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.user }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.owner }))
vi.mock('@/lib/projectAiJobStore', () => ({ getJob: mocks.getJob, getLatestJob: mocks.getJob, updateJob: vi.fn() }))
vi.mock('@/lib/refImageJobStore', () => ({ getJobs: mocks.getJobs, heartbeatQueuedJobs: vi.fn(), updateJob: vi.fn() }))
vi.mock('@/services/scene-reference-job', () => ({ runQueuedSceneReferenceJob: vi.fn() }))
import { GET } from './route'
const request = () => GET(new NextRequest('http://localhost/api/projects/456/scene-references/status/latest'), { params: Promise.resolve({ id: '456', jobId: 'latest' }) })
const batch = {
    id: '900',
    projectId: '456',
    kind: 'scene_references',
    phase: 'generating',
    total: 2,
    result: {
        items: [
            { sceneId: '11', jobId: '901' },
            { sceneId: '12', jobId: '902' }
        ],
        concurrency: 2,
        quality: 'standard',
        mode: 'all'
    }
}
beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.mockReturnValue(123n)
    mocks.owner.mockResolvedValue(null)
    mocks.getJob.mockResolvedValue(batch)
    mocks.getJobs.mockResolvedValue([
        { id: '901', phase: 'done', result: { candidateUrl: 'https://cdn.example/a.png' } },
        { id: '902', phase: 'queued' }
    ])
})

describe('scene batch consolidated status', () => {
    it('reads all children once, preserving completed results during an interruption', async () => {
        mocks.getJob.mockResolvedValue({ ...batch, phase: 'error', error: 'interrupted' })
        const response = await request()
        const { data } = await response.json()
        expect(data).toMatchObject({ phase: 'error', completed: 2, failed: 1 })
        expect(data.items[0].result.candidateUrl).toBe('https://cdn.example/a.png')
        expect(data.items[1]).toMatchObject({ phase: 'error', error: 'interrupted' })
        expect(mocks.getJobs).toHaveBeenCalledExactlyOnceWith(['901', '902'])
        expect(response.headers.get('cache-control')).toContain('no-store')
    })
    it('rejects a parent from a different project before reading children', async () => {
        mocks.getJob.mockResolvedValue({ ...batch, projectId: '999' })
        expect((await request()).status).toBe(404)
        expect(mocks.getJobs).not.toHaveBeenCalled()
    })
    it('treats missing children as failures and finishes when every item is terminal', async () => {
        mocks.getJobs.mockResolvedValue([{ id: '901', phase: 'done' }])
        expect((await (await request()).json()).data).toMatchObject({ phase: 'done', completed: 2, failed: 1 })
    })
})
