import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    transaction: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    following: vi.fn(),
    probe: vi.fn()
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: () => 7n }))
vi.mock('@/lib/ownership', () => ({ assertStoryboardOwner: async () => null }))
vi.mock('@/lib/prisma', () => ({ prisma: { storyboard: { findFirst: mocks.findFirst }, $transaction: mocks.transaction } }))
vi.mock('@/services/local-media', async importOriginal => ({ ...(await importOriginal<typeof import('@/services/local-media')>()), saveLocalMediaFile: mocks.upload, deleteLocalMediaWithinSubdirectory: mocks.remove }))
vi.mock('@/services/ffmpeg', () => ({ probeMediaStreams: mocks.probe }))
vi.mock('@/services/artifacts', () => ({ resetStoryboardMediaInTransaction: mocks.reset, resetFollowingContinuousMediaInTransaction: mocks.following }))

import { POST } from './route'

const params = { params: Promise.resolve({ id: '42' }) }
const storyboard = { id: 42n, episodeId: 9n, order: 1, deletedAt: null, referenceVideoAssets: null }

function uploadRequest(provider: string) {
    const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    const form = new FormData()
    form.set('provider', provider)
    form.set('file', new File([bytes], 'reference.mp4', { type: 'video/mp4' }))
    return new NextRequest('http://localhost/api/storyboards/42/reference-videos', { method: 'POST', body: form })
}

describe('storyboard reference video uploads', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.findFirst.mockResolvedValue(storyboard)
        mocks.findUnique.mockResolvedValue(storyboard)
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 4.25 })
        mocks.upload.mockResolvedValue('https://cdn.test/reference.mp4')
        mocks.remove.mockResolvedValue(undefined)
        mocks.reset.mockResolvedValue({ ...storyboard, operationVersion: 1 })
        mocks.transaction.mockImplementation(callback =>
            callback({
                $queryRaw: vi.fn(),
                storyboard: { findUnique: mocks.findUnique }
            })
        )
    })

    it('rejects the upload before storage when the selected model has no video-reference capability', async () => {
        const response = await POST(uploadRequest('veo3'), params)

        expect(response.status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
        await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining('不支持') })
    })

    it('persists a probed video for a supported model', async () => {
        const response = await POST(uploadRequest('wan3'), params)

        expect(response.status).toBe(201)
        expect(mocks.upload).toHaveBeenCalledOnce()
        expect(mocks.reset).toHaveBeenCalledWith(
            expect.anything(),
            storyboard,
            ['video'],
            expect.any(String),
            expect.objectContaining({ patch: expect.objectContaining({ referenceVideoAssets: [expect.objectContaining({ url: 'https://cdn.test/reference.mp4', durationSeconds: 4.25 })] }) })
        )
    })

    it('rejects an overlong Seedance 2.5 reference video before storage', async () => {
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 30.001 })

        const response = await POST(uploadRequest('seedance25'), params)

        expect(response.status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
        await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining('30 秒') })
    })

    it('accepts a Seedance 2.5 reference video at the provider limit', async () => {
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 30 })

        const response = await POST(uploadRequest('seedance25'), params)

        expect(response.status).toBe(201)
        expect(mocks.upload).toHaveBeenCalledOnce()
    })

    it.each([
        ['seedance', 1.999, '2 秒'],
        ['seedance25', 1.999, '2 秒'],
        ['wan3', 0.999, '1 秒'],
        ['wan3prime', 30.001, '30 秒'],
        ['seedance-2.0-global', 15.001, '15 秒'],
        ['seedance-2.5-global', 30.001, '30 秒']
    ])('rejects a %s reference video outside its duration range', async (provider, duration, expectedLimit) => {
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration })

        const response = await POST(uploadRequest(provider), params)

        expect(response.status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
        await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining(expectedLimit) })
    })

    it('enforces the Seedance aggregate duration under the transaction lock', async () => {
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 6 })
        mocks.findUnique.mockResolvedValue({
            ...storyboard,
            referenceVideoAssets: [
                {
                    id: 'existing',
                    url: 'https://cdn.test/existing.mp4',
                    name: 'existing.mp4',
                    mimeType: 'video/mp4',
                    sizeBytes: 1024,
                    durationSeconds: 10,
                    createdAt: '2026-09-16T00:00:00.000Z'
                }
            ]
        })

        const response = await POST(uploadRequest('seedance'), params)

        expect(response.status).toBe(422)
        expect(mocks.reset).not.toHaveBeenCalled()
        expect(mocks.remove).toHaveBeenCalledWith('https://cdn.test/reference.mp4', 'storyboards/42/reference-videos')
        await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining('合计不能超过 15 秒') })
    })

    it('enforces the three-video limit under the transaction lock and removes the orphan upload', async () => {
        mocks.findUnique.mockResolvedValue({
            ...storyboard,
            referenceVideoAssets: Array.from({ length: 3 }, (_, index) => ({
                id: `existing-${index}`,
                url: `https://cdn.test/existing-${index}.mp4`,
                name: `existing-${index}.mp4`,
                mimeType: 'video/mp4',
                sizeBytes: 1024,
                durationSeconds: 3,
                createdAt: '2026-09-16T00:00:00.000Z'
            }))
        })

        const response = await POST(uploadRequest('seedance25'), params)

        expect(response.status).toBe(409)
        expect(mocks.remove).toHaveBeenCalledWith('https://cdn.test/reference.mp4', 'storyboards/42/reference-videos')
    })
})
