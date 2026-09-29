import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    write: vi.fn(),
    unlink: vi.fn(),
    upload: vi.fn(),
    fetch: vi.fn(),
    hiModels: vi.fn(),
    job: vi.fn(),
    points: vi.fn(),
    asset: vi.fn(),
    prepare: vi.fn()
}))
vi.mock('node:fs', () => ({ promises: { mkdir: vi.fn(), writeFile: mocks.write, unlink: mocks.unlink } }))
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: mocks.after }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 7n }))
vi.mock('@/lib/himodels-usage-context.server', () => ({ withHiModelsUsageScope: (_scope: unknown, run: () => unknown) => run() }))
vi.mock('@/lib/provider-token-usage.server', () => ({ fetchMeteredProvider: mocks.fetch }))
vi.mock('@/lib/projectAiJobStore', () => ({ updateJob: vi.fn() }))
vi.mock('@/lib/creator-generation-concurrency', () => ({ createCreatorGenerationJob: mocks.job, CreatorGenerationCapacityError: class extends Error {} }))
vi.mock('@/services/local-media', async importOriginal => ({ ...(await importOriginal<typeof import('@/services/local-media')>()), saveLocalMediaFile: mocks.upload, localMediaMatchesSubdirectory: (url: string, subdir: string) => new URL(url).pathname.startsWith(`/${subdir}/`) }))
vi.mock('@/services/wan-video-reference-image', () => ({ prepareWanVideoReferenceImage: mocks.prepare }))
vi.mock('@/services/dashscope-config', () => ({ getDashScopeConfig: () => ({ apiKey: 'mock', baseUrl: 'https://provider.test' }) }))
vi.mock('@/services/seedance-config', () => ({ getSeedanceConfig: async () => ({ apiKey: 'mock', baseUrl: 'https://provider.test' }) }))
vi.mock('@/services/himodels', () => ({ createHiModelsVideoTask: mocks.hiModels }))
vi.mock('@/services/creator-assets', () => ({ findCreatorAssetReference: mocks.asset }))
vi.mock('@/services/billing', () => ({ assertSufficientPoints: mocks.points, quoteGenerationPoints: () => 1, BillingError: class extends Error {} }))

import { POST } from './route'

function request(count: number, provider = 'wan3', assetId?: string, ratio?: string) {
    const form = new FormData()
    form.set('prompt', 'Animate the references')
    form.set('provider', provider)
    if (ratio) form.set('ratio', ratio)
    for (let index = 0; index < count; index++) form.append('image', new File([`image-${index}`], `${index}.png`, { type: 'image/png' }))
    if (assetId) form.set('referenceAssetId', assetId)
    return new NextRequest('http://localhost/api/create/video', { method: 'POST', body: form })
}

const savedVideo = {
    id: '42',
    type: 'video',
    url: 'https://cdn.test/creator/7/videos/work.mp4',
    coverUrl: 'https://cdn.test/creator/7/covers/work.jpg',
    duration: 5,
    prompt: 'Animate the clover',
    provider: 'wan3',
    ratio: '1:1',
    createdAt: '2026-09-19T00:00:00.000Z'
}

function videoReferenceRequest(provider = 'wan3', uploads = 0, id = '42') {
    const form = new FormData()
    form.set('prompt', 'Animate the references')
    form.set('provider', provider)
    form.set('referenceVideoAssetId', id)
    form.set(
        'referenceVideos',
        JSON.stringify(
            Array.from({ length: uploads }, (_, index) => ({
                id: `upload-${index}`,
                url: `https://cdn.test/creator/7/reference-videos/${index}.mp4`,
                name: `${index}.mp4`,
                mimeType: 'video/mp4',
                sizeBytes: 1000,
                durationSeconds: 5,
                createdAt: savedVideo.createdAt
            }))
        )
    )
    return new NextRequest('http://localhost/api/create/video', { method: 'POST', body: form })
}

describe('creator video image references', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.prepare.mockImplementation(async (url: string) => `${url}?prepared=1`)
        mocks.write.mockResolvedValue(undefined)
        mocks.unlink.mockResolvedValue(undefined)
        mocks.upload.mockImplementation(async (_file, _directory, name) => `https://cdn.test/${name}`)
        mocks.fetch.mockImplementation(async () => Response.json({ output: { task_id: 'video-task' }, id: 'video-task' }))
        mocks.hiModels.mockResolvedValue({ taskId: 'himodels-video-task', usage: null })
        mocks.job.mockResolvedValue({ id: '55' })
        mocks.asset.mockResolvedValue({ referenceUrl: 'https://cdn.test/saved.png' })
    })

    it.each(['wan3', 'wan3prime'])('passes all three images to %s in upload order', async provider => {
        expect((await POST(request(3, provider))).status).toBe(202)
        await mocks.after.mock.calls[0][0]()
        const body = JSON.parse(mocks.fetch.mock.calls[0][1].body)
        expect(body.input.media).toEqual(mocks.upload.mock.calls.map(call => ({ type: 'reference_image', url: `https://cdn.test/${call[2]}?prepared=1` })))
        expect(body.input.media).toHaveLength(3)
        for (const [file] of mocks.write.mock.calls) expect(mocks.unlink).toHaveBeenCalledWith(file)
    })

    it('keeps a reused work before the two uploaded references', async () => {
        expect((await POST(request(2, 'wan3', '41'))).status).toBe(202)
        await mocks.after.mock.calls[0][0]()
        const media = JSON.parse(mocks.fetch.mock.calls[0][1].body).input.media
        expect(media).toHaveLength(3)
        expect(media[0].url).toBe('https://cdn.test/saved.png?prepared=1')
        expect(mocks.prepare).toHaveBeenCalledWith('https://cdn.test/saved.png')
        expect(mocks.asset).toHaveBeenCalledWith(7n, 41n)
    })

    it.each([
        [4, 'wan3'],
        [3, 'seedance'],
        [3, 'seedance25'],
        [3, 'seedance-2.0-global'],
        [3, 'seedance-2.5-global']
    ])('rejects %s images for %s before billing or writing', async (count, provider) => {
        expect((await POST(request(count as number, provider as string))).status).toBe(400)
        expect(mocks.points).not.toHaveBeenCalled()
        expect(mocks.write).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it.each(['seedance-2.0-global', 'seedance-2.5-global'])('passes opening and ending frames to HiModels %s', async provider => {
        expect((await POST(request(2, provider))).status).toBe(202)
        await mocks.after.mock.calls[0][0]()
        const uploadedUrls = mocks.upload.mock.calls.map(call => `https://cdn.test/${call[2]}`)
        expect(mocks.hiModels).toHaveBeenCalledWith(
            expect.objectContaining({
                model: provider,
                prompt: expect.stringContaining('Use Image 1 as the exact opening frame and Image 2 as the exact final frame.'),
                referenceImages: [
                    { url: uploadedUrls[0], role: 'first_frame' },
                    { url: uploadedUrls[1], role: 'last_frame' }
                ]
            })
        )
    })

    it('enables H3 with 21:9 and sends a third image as an omni-modal reference', async () => {
        expect((await POST(request(3, 'MiniMax-H3', undefined, '21:9'))).status).toBe(202)
        await mocks.after.mock.calls[0][0]()
        const uploadedUrls = mocks.upload.mock.calls.map(call => `https://cdn.test/${call[2]}`)
        expect(mocks.hiModels).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'MiniMax-H3',
                aspectRatio: '21:9',
                duration: 5,
                referenceImages: [
                    { url: uploadedUrls[0], role: 'first_frame' },
                    { url: uploadedUrls[1], role: 'last_frame' },
                    { url: uploadedUrls[2], role: 'reference_image' }
                ]
            })
        )
    })

    it('keeps 21:9 restricted to H3', async () => {
        expect((await POST(request(0, 'wan3', undefined, '21:9'))).status).toBe(400)
        expect(mocks.points).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it.each([
        ['seedance', ['first_frame', 'last_frame']],
        ['seedance25', ['reference_image', 'reference_image']]
    ])('preserves the supported frame roles for %s', async (provider, roles) => {
        expect((await POST(request(2, provider as string))).status).toBe(202)
        await mocks.after.mock.calls[0][0]()
        const content = JSON.parse(mocks.fetch.mock.calls[0][1].body).content
        expect(content.filter((item: { type: string }) => item.type === 'image_url').map((item: { role: string }) => item.role)).toEqual(roles)
    })

    it.each(['wan3', 'wan3prime', 'seedance', 'seedance25'])('reuses the original video, never its cover, for %s', async provider => {
        mocks.asset.mockResolvedValue({ asset: savedVideo, referenceUrl: savedVideo.coverUrl })
        expect((await POST(videoReferenceRequest(provider))).status).toBe(202)
        expect(mocks.asset).toHaveBeenCalledWith(7n, 42n)
        await mocks.after.mock.calls[0][0]()
        const body = JSON.parse(mocks.fetch.mock.calls[0][1].body)
        if (provider.startsWith('wan3')) expect(body.input.media).toEqual([{ type: 'reference_video', url: savedVideo.url }])
        else {
            expect(body.content.filter((item: { type: string }) => item.type === 'video_url')).toEqual([{ type: 'video_url', video_url: { url: savedVideo.url }, role: 'reference_video' }])
            expect(body.content.some((item: { type: string }) => item.type === 'image_url')).toBe(false)
        }
        expect(JSON.stringify(body)).not.toContain(savedVideo.coverUrl)
        expect(mocks.write).not.toHaveBeenCalled()
    })

    it('supports videos without covers and combines them with uploaded videos', async () => {
        mocks.asset.mockResolvedValue({ asset: { ...savedVideo, coverUrl: null }, referenceUrl: null })
        expect((await POST(videoReferenceRequest('wan3', 2))).status).toBe(202)
        await mocks.after.mock.calls[0][0]()
        const media = JSON.parse(mocks.fetch.mock.calls[0][1].body).input.media
        expect(media).toHaveLength(3)
        expect(media[0]).toEqual({ type: 'reference_video', url: savedVideo.url })
        expect(media.every((item: { type: string }) => item.type === 'reference_video')).toBe(true)
    })

    it('counts saved works toward the three-video limit before billing', async () => {
        mocks.asset.mockResolvedValue({ asset: savedVideo })
        expect((await POST(videoReferenceRequest('wan3', 3))).status).toBe(400)
        expect(mocks.points).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it('uses the saved duration for provider limits, including aggregate duration', async () => {
        mocks.asset.mockResolvedValue({ asset: { ...savedVideo, duration: 20 } })
        expect((await POST(videoReferenceRequest('seedance'))).status).toBe(400)
        mocks.asset.mockResolvedValue({ asset: { ...savedVideo, duration: 10 } })
        expect((await POST(videoReferenceRequest('seedance', 2))).status).toBe(400)
        expect(mocks.points).not.toHaveBeenCalled()
    })

    it.each([
        [null, 404],
        [{ asset: { ...savedVideo, type: 'image' } }, 400],
        [{ asset: { ...savedVideo, url: 'https://cdn.test/creator/8/videos/work.mp4' } }, 400],
        [{ asset: { ...savedVideo, duration: null } }, 400]
    ])('rejects inaccessible or invalid saved video references before creating a job', async (asset, status) => {
        mocks.asset.mockResolvedValue(asset)
        expect((await POST(videoReferenceRequest())).status).toBe(status)
        expect(mocks.points).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })

    it('rejects an invalid saved-video ID before looking up works', async () => {
        expect((await POST(videoReferenceRequest('wan3', 0, 'invalid'))).status).toBe(400)
        expect(mocks.asset).not.toHaveBeenCalled()
        expect(mocks.job).not.toHaveBeenCalled()
    })
})
