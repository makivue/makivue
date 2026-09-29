import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    getJob: vi.fn(),
    getLatestJob: vi.fn(),
    getJobs: vi.fn(),
    updateJob: vi.fn(),
    runQueuedCharacterReferenceJob: vi.fn()
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/lib/projectAiJobStore', () => ({ getJob: mocks.getJob, getLatestJob: mocks.getLatestJob, updateJob: mocks.updateJob }))
vi.mock('@/lib/refImageJobStore', () => ({ getJobs: mocks.getJobs, heartbeatQueuedJobs: vi.fn() }))
vi.mock('@/services/character-reference-job', () => ({ runQueuedCharacterReferenceJob: mocks.runQueuedCharacterReferenceJob }))
vi.mock('@/lib/himodels-usage-ledger.server', () => ({ readHiModelsUsage: vi.fn().mockResolvedValue({}) }))

import { GET } from './route'

function batch(overrides: Record<string, unknown> = {}) {
    return {
        id: '900',
        projectId: '456',
        kind: 'character_references',
        phase: 'generating',
        total: 3,
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now(),
        result: {
            items: ['11', '12', '13'].map((characterId, index) => ({ characterId, jobId: String(901 + index), role: 'turnaround_sheet' })),
            concurrency: 3,
            quality: 'ultra',
            mode: 'all',
            replaceSelected: false
        },
        ...overrides
    }
}

function request(jobId = 'latest', projectId = '456') {
    return GET(new NextRequest(`http://localhost/api/projects/${projectId}/character-references/status/${jobId}`), { params: Promise.resolve({ id: projectId, jobId }) })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertProjectOwner.mockResolvedValue(null)
    mocks.getLatestJob.mockResolvedValue(batch())
    mocks.getJob.mockResolvedValue(batch())
    mocks.getJobs.mockResolvedValue([
        { id: '901', phase: 'done', result: { candidateUrl: '/completed.png' } },
        { id: '902', phase: 'generating', result: { progress: { stage: 'inspecting', attempt: 1 } } },
        { id: '903', phase: 'queued' }
    ])
})

describe('character batch recovery status', () => {
    it('restores the original batch ID, per-card states and generation preferences without starting work', async () => {
        const response = await request()
        const { data } = await response.json()
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toContain('no-store')
        expect(mocks.getLatestJob).toHaveBeenCalledWith('456', 'character_references')
        expect(data).toMatchObject({ id: '900', total: 3, completed: 1, failed: 0, active: 1, queued: 1, mode: 'all', quality: 'ultra' })
        expect(data.items[1]).toMatchObject({ jobId: '902', characterId: '12', progress: { stage: 'inspecting' } })
        expect(mocks.updateJob).not.toHaveBeenCalled()
        expect(mocks.runQueuedCharacterReferenceJob).not.toHaveBeenCalled()
    })

    it.each([undefined, batch({ phase: 'cancelled' })])('returns no recoverable batch for missing or reset work', async job => {
        mocks.getLatestJob.mockResolvedValue(job)
        expect(await (await request()).json()).toMatchObject({ success: true, data: null })
        expect(mocks.getJobs).not.toHaveBeenCalled()
    })

    it('keeps a batch being initialized active until its child jobs exist', async () => {
        mocks.getLatestJob.mockResolvedValue(batch({ result: undefined }))
        expect((await (await request()).json()).data).toMatchObject({ id: '900', phase: 'generating', total: 3, completed: 0, items: [] })
    })

    it('shows an interrupted parent as failures for unfinished cards while retaining completed images', async () => {
        mocks.getLatestJob.mockResolvedValue(batch({ phase: 'error', error: '任务租约过期' }))
        const { data } = await (await request()).json()
        expect(data).toMatchObject({ phase: 'error', completed: 3, failed: 2, active: 0, queued: 0 })
        expect(data.items[0]).toMatchObject({ phase: 'done', result: { candidateUrl: '/completed.png' } })
        expect(data.items[1]).toMatchObject({ phase: 'error', error: '任务租约过期' })
    })

    it('settles a batch when all children finished and reports failed or missing children', async () => {
        mocks.getJobs.mockResolvedValue([
            { id: '901', phase: 'done' },
            { id: '902', phase: 'error', error: '图片生成失败' }
        ])
        const { data } = await (await request('900')).json()
        expect(data).toMatchObject({ phase: 'done', completed: 3, failed: 2 })
        expect(data.items[2]).toMatchObject({ phase: 'error', error: '参考图子任务不存在' })
    })

    it('does not query any job before authentication and ownership checks pass', async () => {
        mocks.currentUserId.mockReturnValue(null)
        expect((await request()).status).toBe(401)
        mocks.currentUserId.mockReturnValue(123n)
        mocks.assertProjectOwner.mockResolvedValue(new Response(null, { status: 403 }))
        expect((await request()).status).toBe(403)
        expect(mocks.getLatestJob).not.toHaveBeenCalled()
        expect(mocks.getJob).not.toHaveBeenCalled()
    })

    it('rejects invalid project IDs and concrete jobs from another project', async () => {
        expect((await request('latest', 'invalid')).status).toBe(400)
        mocks.getJob.mockResolvedValue(batch({ projectId: '789' }))
        expect((await request('900')).status).toBe(404)
        expect(mocks.getJobs).not.toHaveBeenCalled()
    })
})
