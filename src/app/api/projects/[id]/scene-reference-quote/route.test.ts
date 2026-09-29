import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    currentUserId: vi.fn(),
    assertProjectOwner: vi.fn(),
    quoteSceneReferenceBatch: vi.fn()
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.assertProjectOwner }))
vi.mock('@/services/ai', () => ({ isImageProvider: (value: unknown) => value === 'banana' }))
vi.mock('@/services/scene-reference-batch-quote', () => ({ quoteSceneReferenceBatch: mocks.quoteSceneReferenceBatch }))

import { POST } from './route'

function request(body: unknown) {
    return new NextRequest('http://localhost:3000/api/projects/456/scene-reference-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.assertProjectOwner.mockResolvedValue(null)
    mocks.quoteSceneReferenceBatch.mockResolvedValue({
        requestedCount: 3,
        affordableCount: 2,
        balancePoints: 4_000,
        requiredPoints: 5_907,
        affordablePoints: 3_938,
        minimumPoints: 1_969,
        affordableSceneIds: ['11', '12']
    })
})

describe('POST /api/projects/[id]/scene-reference-quote', () => {
    it('returns an authenticated server-side affordability quote', async () => {
        const response = await POST(request({ sceneIds: ['11', '12', '13'], provider: 'banana', imageQuality: 'clear' }), {
            params: Promise.resolve({ id: '456' })
        })
        const payload = await response.json()

        expect(response.status).toBe(200)
        expect(payload.data).toMatchObject({ requestedCount: 3, affordableCount: 2, affordableSceneIds: ['11', '12'] })
        expect(mocks.quoteSceneReferenceBatch).toHaveBeenCalledWith({
            userId: 123n,
            projectId: 456n,
            sceneIds: ['11', '12', '13'],
            provider: 'banana',
            quality: 'clear'
        })
    })

    it('rejects invalid or empty scene batches before quoting', async () => {
        const response = await POST(request({ sceneIds: [], provider: 'banana' }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(400)
        expect(mocks.quoteSceneReferenceBatch).not.toHaveBeenCalled()
    })

    it('does not expose another project quote', async () => {
        mocks.assertProjectOwner.mockResolvedValue(new Response(null, { status: 403 }))

        const response = await POST(request({ sceneIds: ['11'], provider: 'banana' }), { params: Promise.resolve({ id: '456' }) })

        expect(response.status).toBe(403)
        expect(mocks.quoteSceneReferenceBatch).not.toHaveBeenCalled()
    })
})
