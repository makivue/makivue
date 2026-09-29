import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    background: [] as Array<() => Promise<unknown>>,
    getImageProvider: vi.fn(),
    generateProjectStyleReference: vi.fn(),
    assertSufficientPoints: vi.fn(),
    chargeModelUsage: vi.fn(),
    updateJob: vi.fn()
}))
vi.mock('next/server', async importOriginal => ({
    ...(await importOriginal<typeof import('next/server')>()),
    after: (callback: () => Promise<unknown>) => mocks.background.push(callback)
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 7n }))
vi.mock('@/services/creator-assets', () => ({
    findCreatorAssetReference: vi.fn().mockResolvedValue({ referenceUrl: 'https://cdn.test/owned-reference.png' }),
    saveCreatorImageAsset: vi.fn()
}))
vi.mock('@/lib/ownership', () => ({ assertProjectOwner: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/id', () => ({ genId: () => 11n }))
vi.mock('@/lib/projectAiJobStore', () => ({ createJob: vi.fn().mockResolvedValue({ id: '12' }), updateJob: mocks.updateJob }))
vi.mock('@/services/banana', () => ({ assertNanoBananaCredentialsConfigured: vi.fn(), NanoBananaConfigurationError: class extends Error {} }))
vi.mock('@/services/ai', () => ({
    getImageProvider: mocks.getImageProvider,
    generateProjectStyleReference: mocks.generateProjectStyleReference,
    isImageProvider: (provider: string) => ['banana', 'doubao', 'seedream-5-0-lite'].includes(provider),
    resolveImageProviderForReferences: (provider: string, references: number) => (references > 0 ? 'banana' : provider),
    generateImageUnified: vi.fn()
}))
vi.mock('@/services/billing', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/billing')>()),
    assertSufficientPoints: mocks.assertSufficientPoints,
    chargeModelUsage: mocks.chargeModelUsage
}))

describe('image billing at API boundaries', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.background.length = 0
        mocks.getImageProvider.mockResolvedValue('seedream-5-0-lite')
        mocks.assertSufficientPoints.mockResolvedValue(undefined)
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new Error('Unexpected network call')))
        )
    })
    afterEach(() => vi.unstubAllGlobals())

    it.each([
        { provider: '', reference: false, expected: 40 },
        { provider: 'seedream-5-0-lite', reference: false, expected: 40 },
        { provider: 'doubao', reference: false, expected: 40 },
        { provider: 'seedream-5-0-lite', reference: true, expected: 5 }
    ])('checks the routed image budget: $provider / reference=$reference', async ({ provider, reference, expected }) => {
        const { BillingError } = await import('@/services/billing')
        mocks.assertSufficientPoints.mockRejectedValue(new BillingError('余额不足', 402))
        const { POST } = await import('@/app/api/create/image/route')
        const form = new FormData()
        form.set('prompt', 'A character')
        form.set('provider', provider)
        if (reference) form.set('referenceAssetId', '123')
        const response = await POST(new NextRequest('http://localhost/api/create/image', { method: 'POST', body: form }))
        expect(response.status).toBe(402)
        expect(mocks.assertSufficientPoints).toHaveBeenCalledWith(7n, expected)
        expect(mocks.background).toHaveLength(0)
        expect(mocks.chargeModelUsage).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })

    it.each([{ actualProvider: 'seedream-5-0-lite' }, { actualProvider: 'banana' }])('bills the delivered style reference from $actualProvider', async ({ actualProvider }) => {
        mocks.generateProjectStyleReference.mockImplementation(async (_projectId, options) => {
            const generation = { actualProvider }
            await options.beforeSave({ transaction: true }, generation)
            return { url: '/storage/test.png', generation }
        })
        const { POST } = await import('@/app/api/projects/[id]/style-reference/route')
        const response = await POST(
            new NextRequest('http://localhost/api/projects/1/style-reference', {
                method: 'POST',
                body: JSON.stringify({ provider: 'seedream-5-0-lite' })
            }),
            { params: Promise.resolve({ id: '1' }) }
        )
        expect(response.status).toBe(202)
        await mocks.background[0]()
        expect(mocks.chargeModelUsage).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                idempotencyKey: 'usage:project-style:12',
                metadata: { projectId: '1', provider: actualProvider, requestedProvider: 'seedream-5-0-lite' }
            })
        )
        expect(mocks.updateJob).toHaveBeenLastCalledWith('12', { phase: 'done', result: { styleReferenceImageUrl: '/storage/test.png' } })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('does not charge a failed style image', async () => {
        mocks.generateProjectStyleReference.mockRejectedValue(new Error('generation failed'))
        const { POST } = await import('@/app/api/projects/[id]/style-reference/route')
        await POST(
            new NextRequest('http://localhost/api/projects/1/style-reference', {
                method: 'POST',
                body: JSON.stringify({ provider: 'seedream-5-0-lite' })
            }),
            { params: Promise.resolve({ id: '1' }) }
        )
        await mocks.background[0]()
        expect(mocks.chargeModelUsage).not.toHaveBeenCalled()
        expect(mocks.updateJob).toHaveBeenLastCalledWith('12', { phase: 'error', error: 'generation failed' })
    })
})
