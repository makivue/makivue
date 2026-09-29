import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        creatorAsset: {
            findFirst: mocks.findFirst
        }
    }
}))

vi.mock('@/lib/id', () => ({ genId: vi.fn(() => 1n) }))
vi.mock('./oss', () => ({
    deleteCreatorArtifactFromOSS: vi.fn(),
    uploadToOSS: vi.fn()
}))
vi.mock('./ffmpeg', () => ({
    extractVideoCover: vi.fn(),
    optimizeVideoForStreaming: vi.fn(),
    probeDuration: vi.fn(),
    withFfmpegSlot: vi.fn()
}))

import { findCreatorAssetReference } from './creator-assets'

function assetRow(type: 'image' | 'video') {
    return {
        id: 41n,
        type,
        url: type === 'image' ? 'https://cdn.example/image.png' : 'https://cdn.example/video.mp4',
        coverUrl: type === 'image' ? 'https://cdn.example/image.png' : 'https://cdn.example/video-cover.jpg',
        prompt: '原始文案',
        provider: type === 'image' ? 'banana' : 'seedance',
        ratio: '16:9',
        duration: type === 'video' ? 5 : null,
        createdAt: new Date('2026-08-27T00:00:00.000Z')
    }
}

describe('creator asset references', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('scopes the lookup to the authenticated owner and active assets', async () => {
        mocks.findFirst.mockResolvedValue(null)

        await expect(findCreatorAssetReference(7n, 41n)).resolves.toBeNull()
        expect(mocks.findFirst).toHaveBeenCalledWith({
            where: { id: 41n, userId: 7n, deletedAt: null }
        })
    })

    it('uses the image itself as an image reference', async () => {
        mocks.findFirst.mockResolvedValue(assetRow('image'))

        await expect(findCreatorAssetReference(7n, 41n)).resolves.toMatchObject({
            referenceUrl: 'https://cdn.example/image.png'
        })
    })

    it('uses a video cover instead of sending the video file as an image', async () => {
        mocks.findFirst.mockResolvedValue(assetRow('video'))

        const reference = await findCreatorAssetReference(7n, 41n)
        expect(reference?.referenceUrl).toBe('https://cdn.example/video-cover.jpg')
        expect(reference?.referenceUrl).not.toBe('https://cdn.example/video.mp4')
    })
})
