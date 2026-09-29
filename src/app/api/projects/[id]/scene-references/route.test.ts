import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
    user: vi.fn(),
    owner: vi.fn(),
    scenes: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createRef: vi.fn(),
    updateRef: vi.fn(),
    after: vi.fn(),
    run: vi.fn()
}))
vi.mock('next/server', async () => ({ ...(await vi.importActual('next/server')), after: mocks.after }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.user }))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: mocks.owner }))
vi.mock('@/lib/prisma', () => ({ prisma: { scene: { findMany: mocks.scenes }, $transaction: (fn: (tx: object) => unknown) => fn({}) } }))
vi.mock('@/lib/projectAiJobStore', () => ({ createJob: mocks.create, updateJob: mocks.update }))
vi.mock('@/lib/refImageJobStore', () => ({ createJob: mocks.createRef, updateJob: mocks.updateRef }))
vi.mock('@/services/ai', () => ({ isImageProvider: (p: unknown) => p === 'banana' }))
vi.mock('@/services/billing', () => ({ assertSufficientPoints: vi.fn(), quoteGenerationPoints: vi.fn(), BillingError: class extends Error {} }))
vi.mock('@/services/banana', () => ({ assertNanoBananaCredentialsConfigured: vi.fn(), NanoBananaConfigurationError: class extends Error {} }))
vi.mock('@/services/scene-reference-batch', () => ({ runSceneReferenceBatchJob: mocks.run }))
import { POST } from './route'

const request = (body: unknown = { sceneIds: ['11', '12'], provider: 'banana' }) =>
    POST(
        new NextRequest('http://localhost/api/projects/456/scene-references', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        }),
        { params: Promise.resolve({ id: '456' }) }
    )

beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.mockReturnValue(123n)
    mocks.owner.mockResolvedValue(null)
    mocks.scenes.mockResolvedValue([11n, 12n].map(id => ({ id, locationPrompt: 'scene', operationVersion: 1 })))
    mocks.create.mockResolvedValue({ id: '900', reused: false })
    mocks.createRef.mockResolvedValueOnce({ id: '901', reused: false }).mockResolvedValueOnce({ id: '902', reused: false })
})

describe('scene batch submission', () => {
    it('persists one parent with all children before scheduling any generation', async () => {
        const response = await request()
        expect(response.status).toBe(202)
        expect(mocks.create).toHaveBeenCalledTimes(1)
        expect(mocks.update).toHaveBeenCalledWith(
            '900',
            {
                result: expect.objectContaining({
                    items: [
                        { sceneId: '11', jobId: '901' },
                        { sceneId: '12', jobId: '902' }
                    ]
                })
            },
            expect.any(Object)
        )
        expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.after.mock.invocationCallOrder[0])
        expect(mocks.run).not.toHaveBeenCalled()
        await mocks.after.mock.calls[0][0]()
        expect(mocks.run).toHaveBeenCalledTimes(1)
        expect(mocks.run.mock.calls[0][2]).toHaveLength(2)
    })

    it('reuses an active parent without creating children or scheduling again', async () => {
        mocks.create.mockResolvedValue({ id: '900', reused: true })
        expect((await (await request()).json()).data).toEqual({ jobId: '900', resumed: true })
        expect(mocks.createRef).not.toHaveBeenCalled()
        expect(mocks.after).not.toHaveBeenCalled()
    })

    it('rejects foreign scenes and unauthenticated requests before creating jobs', async () => {
        mocks.scenes.mockResolvedValue([])
        expect((await request()).status).toBe(400)
        mocks.user.mockReturnValue(null)
        expect((await request()).status).toBe(401)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('marks children failed and never dispatches if batch persistence fails', async () => {
        mocks.update.mockRejectedValueOnce(new Error('storage unavailable'))
        expect((await request()).status).toBe(500)
        expect(mocks.updateRef).toHaveBeenCalledTimes(2)
        expect(mocks.after).not.toHaveBeenCalled()
    })
})
