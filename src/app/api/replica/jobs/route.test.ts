import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const local = vi.hoisted(() => ({ submit: vi.fn(), process: vi.fn(), after: vi.fn() }))
vi.mock('next/server', async original => ({ ...(await original<typeof import('next/server')>()), after: local.after }))
vi.mock('@/lib/replica-jobs', () => ({ submitReplicaJob: local.submit, processReplicaJob: local.process, listReplicaJobs: vi.fn() }))
import { POST } from './route'
it('persists a local job before scheduling its model work', async () => {
    local.submit.mockResolvedValue({ taskId: '123', status: 'processing' })
    const response = await POST(new NextRequest('http://localhost/api/replica/jobs', { method: 'POST', body: JSON.stringify({ mode: 'analyze', videoUrl: '/api/local-media/replica/input.mp4' }) }))
    expect(response.status).toBe(200)
    expect(local.submit).toHaveBeenCalledWith('analyze', { videoUrl: '/api/local-media/replica/input.mp4' }, undefined)
    expect(local.after).toHaveBeenCalledOnce()
    await local.after.mock.calls[0][0]()
    expect(local.process).toHaveBeenCalledWith('123')
})
