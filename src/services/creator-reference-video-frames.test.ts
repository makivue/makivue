import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryboardReferenceVideo } from '@/lib/storyboard-reference-videos'

const mocks = vi.hoisted(() => ({ probe: vi.fn(), extract: vi.fn() }))
vi.mock('./ffmpeg', () => ({
    probeMediaStreams: mocks.probe,
    extractVideoCover: mocks.extract,
    withFfmpegSlot: (run: () => Promise<unknown>) => run()
}))

import { withCreatorReferenceVideoFrames } from './creator-reference-video-frames'

const video: StoryboardReferenceVideo = {
    id: 'reference',
    url: 'https://cdn.test/creator/7/reference-videos/video.mp4',
    name: 'video.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 12,
    durationSeconds: 999,
    createdAt: '2026-09-18T00:00:00.000Z'
}

describe('creator video frames for image generation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Uint8Array(12)))
        )
        mocks.probe.mockResolvedValue({ hasVideo: true, duration: 9 })
        mocks.extract.mockImplementation(async (_input, output) => fs.writeFile(output, 'frame'))
    })
    afterEach(() => vi.unstubAllGlobals())

    it('samples the actual video duration and keeps frames alive until generation finishes', async () => {
        let directory = ''
        const result = await withCreatorReferenceVideoFrames(video, [], async images => {
            expect(images).toHaveLength(3)
            directory = path.dirname(images[0])
            for (const file of images) expect(await fs.readFile(file, 'utf8')).toBe('frame')
            return 'generated'
        })
        expect(result).toBe('generated')
        expect(mocks.extract.mock.calls.map(call => call[2])).toEqual([0, 3, 6])
        await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('preserves the uploaded image while respecting the three-reference model limit', async () => {
        await withCreatorReferenceVideoFrames(video, ['image.png'], async images => {
            expect(images).toHaveLength(3)
            expect(images[0]).toBe('image.png')
        })
        expect(mocks.extract.mock.calls.map(call => call[2])).toEqual([0, 4.5])
    })

    it('cleans up video and frames when generation fails', async () => {
        let directory = ''
        await expect(
            withCreatorReferenceVideoFrames(video, [], async images => {
                directory = path.dirname(images[0])
                throw new Error('provider failed')
            })
        ).rejects.toThrow('provider failed')
        await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('rejects invalid media before invoking the image model and cleans up', async () => {
        mocks.probe.mockResolvedValue({ hasVideo: false, duration: 9 })
        const run = vi.fn()
        await expect(withCreatorReferenceVideoFrames(video, [], run)).rejects.toThrow('参考视频无效')
        expect(run).not.toHaveBeenCalled()
        const directory = path.dirname(mocks.probe.mock.calls[0][0])
        await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('leaves image-only requests unchanged', async () => {
        const run = vi.fn().mockResolvedValue('image')
        await expect(withCreatorReferenceVideoFrames(undefined, ['image.png'], run)).resolves.toBe('image')
        expect(run).toHaveBeenCalledWith(['image.png'])
        expect(fetch).not.toHaveBeenCalled()
    })
})
