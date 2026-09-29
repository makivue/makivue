import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    generate: vi.fn(),
    frames: vi.fn(),
    owned: vi.fn(),
    assertPoints: vi.fn(),
    quote: vi.fn(),
    job: vi.fn(),
    resolveProvider: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn()
}))
vi.mock('node:fs', () => ({ promises: { mkdir: vi.fn(), writeFile: mocks.writeFile, unlink: mocks.unlink } }))
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: mocks.after }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 7n }))
vi.mock('@/lib/himodels-usage-context.server', () => ({ withHiModelsUsageScope: (_scope: unknown, run: () => unknown) => run() }))
vi.mock('@/services/ai', () => ({
    generateImageUnified: mocks.generate,
    getImageProvider: async () => 'banana',
    isImageProvider: (value: string) => ['banana', 'seedream-5-0-lite', 'qwen-image-3.0-pro'].includes(value),
    resolveImageProviderForReferences: mocks.resolveProvider
}))
vi.mock('@/services/local-media', async importOriginal => ({ ...(await importOriginal<typeof import('@/services/local-media')>()), localMediaMatchesSubdirectory: mocks.owned, saveLocalMediaFile: async () => 'https://cdn.test/image.png' }))
vi.mock('@/lib/projectAiJobStore', () => ({ updateJob: vi.fn() }))
vi.mock('@/lib/creator-generation-concurrency', () => ({ createCreatorGenerationJob: mocks.job, CreatorGenerationCapacityError: class extends Error {} }))
vi.mock('@/services/creator-assets', () => ({ findCreatorAssetReference: vi.fn(), saveCreatorImageAsset: async () => ({ id: '55' }) }))
vi.mock('@/services/creator-reference-video-frames', () => ({ withCreatorReferenceVideoFrames: mocks.frames }))
vi.mock('@/services/billing', () => ({ assertSufficientPoints: mocks.assertPoints, quoteGenerationPoints: mocks.quote, chargeModelUsage: vi.fn(), BillingError: class extends Error {} }))
import { POST } from './route'

const video = {
    id: 'reference',
    url: 'https://cdn.test/creator/7/reference-videos/leaves.mp4',
    name: 'leaves.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 100,
    durationSeconds: 8,
    createdAt: '2026-09-18T00:00:00.000Z'
}
function request(references: unknown = [video], provider = 'banana') {
    const form = new FormData()
    form.set('prompt', '参考视频中的发光叶子')
    form.set('provider', provider)
    form.set('referenceVideos', JSON.stringify(references))
    return new NextRequest('http://localhost/api/create/image', { method: 'POST', body: form })
}

describe('image generation with a reference video', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.writeFile.mockResolvedValue(undefined)
        mocks.unlink.mockResolvedValue(undefined)
        mocks.owned.mockReturnValue(true)
        mocks.job.mockResolvedValue({ id: '55' })
        mocks.generate.mockResolvedValue({ actualProvider: 'banana' })
        mocks.resolveProvider.mockImplementation((provider, count) => (count ? 'banana' : provider))
        mocks.frames.mockImplementation(async (_video, images, run) => run([...images, 'frame-0.jpg', 'frame-1.jpg', 'frame-2.jpg']))
    })

    it('passes actual video frames to image generation and quotes the reference-capable provider', async () => {
        const response = await POST(request([video], 'seedream-5-0-lite'))
        expect(response.status).toBe(202)
        expect(mocks.quote).toHaveBeenCalledWith('image', 'banana')
        expect(mocks.owned).toHaveBeenCalledWith(video.url, 'creator/7/reference-videos')
        await mocks.after.mock.calls[0][0]()
        expect(mocks.frames).toHaveBeenCalledWith(video, [], expect.any(Function))
        expect(mocks.generate).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('参考视频中的发光叶子'),
                referenceImages: ['frame-0.jpg', 'frame-1.jpg', 'frame-2.jpg']
            })
        )
    })

    it('rejects another user’s video before billing or queuing', async () => {
        mocks.owned.mockReturnValue(false)
        expect((await POST(request())).status).toBe(400)
        expect(mocks.assertPoints).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it.each([{}, [{ ...video, durationSeconds: 0 }], [video, { ...video, id: 'second' }]])('rejects invalid or excessive reference videos', async references => {
        expect((await POST(request(references))).status).toBe(400)
        expect(mocks.job).not.toHaveBeenCalled()
    })
})

function imageRequest(count: number) {
    const form = new FormData()
    form.set('prompt', 'Three image references')
    form.set('provider', 'banana')
    for (let index = 0; index < count; index++) form.append('image', new File([`image-${index}`], `${index}.png`, { type: 'image/png' }))
    return new NextRequest('http://localhost/api/create/image', { method: 'POST', body: form })
}

describe('multiple creator image references', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.writeFile.mockResolvedValue(undefined)
        mocks.unlink.mockResolvedValue(undefined)
        mocks.job.mockResolvedValue({ id: '55' })
        mocks.generate.mockResolvedValue({ actualProvider: 'banana' })
        mocks.resolveProvider.mockImplementation(provider => provider)
        mocks.frames.mockImplementation(async (_video, images, run) => run(images))
    })

    it('sends all three uploaded images to the model and cleans up every local file', async () => {
        expect((await POST(imageRequest(3))).status).toBe(202)
        const written = mocks.writeFile.mock.calls.map(call => call[0])
        expect(written).toHaveLength(3)
        expect(mocks.writeFile.mock.calls.map(call => call[1].toString())).toEqual(['image-0', 'image-1', 'image-2'])
        await mocks.after.mock.calls[0][0]()
        expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: written }))
        for (const file of written) expect(mocks.unlink).toHaveBeenCalledWith(file)
    })

    it('rejects four images before billing, writing or creating a job', async () => {
        expect((await POST(imageRequest(4))).status).toBe(400)
        expect(mocks.assertPoints).not.toHaveBeenCalled()
        expect(mocks.writeFile).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it('cleans up earlier files if a later file cannot be written', async () => {
        mocks.writeFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'))
        expect((await POST(imageRequest(3))).status).toBe(500)
        for (const [file] of mocks.writeFile.mock.calls) expect(mocks.unlink).toHaveBeenCalledWith(file)
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it('rejects a full Qwen image budget plus a video instead of dropping video frames', async () => {
        mocks.owned.mockReturnValue(true)
        const form = await imageRequest(3).formData()
        form.set('provider', 'qwen-image-3.0-pro')
        form.set('referenceVideos', JSON.stringify([video]))
        const response = await POST(new NextRequest('http://localhost/api/create/image', { method: 'POST', body: form }))
        expect(response.status).toBe(400)
        expect(mocks.assertPoints).not.toHaveBeenCalled()
        expect(mocks.writeFile).not.toHaveBeenCalled()
    })

    it('removes all uploaded files if admission fails', async () => {
        mocks.job.mockRejectedValueOnce(new Error('queue unavailable'))
        expect((await POST(imageRequest(3))).status).toBe(500)
        expect(mocks.writeFile).toHaveBeenCalledTimes(3)
        for (const [file] of mocks.writeFile.mock.calls) expect(mocks.unlink).toHaveBeenCalledWith(file)
    })
})
