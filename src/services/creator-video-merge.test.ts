import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ find: vi.fn(), findJob: vi.fn(), update: vi.fn(), merge: vi.fn(), save: vi.fn(), saved: vi.fn(), transaction: vi.fn(), cover: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { creatorAsset: { findMany: state.find }, projectAiJob: { findFirst: state.findJob, updateMany: state.update }, $transaction: state.transaction } }))
vi.mock('./creator-video-merge-media', () => ({ mergeCreatorClips: state.merge }))
vi.mock('./creator-assets', () => ({ findCreatorAssetByJob: state.saved, serializeCreatorAsset: (row: unknown) => row }))
vi.mock('./ffmpeg', () => ({ extractVideoCover: state.cover, withFfmpegSlot: (run: () => Promise<unknown>) => run() }))

import { getCreatorVideoMergeJob, loadCreatorMergeAssets, runCreatorVideoMerge } from './creator-video-merge'

const input = { assetIds: ['11', '12'], title: '本地视频', ratio: '16:9' as const, requestKey: 'a1234567-1234-1234-1234-123456789012' }
const asset = (id: bigint, userId = 7n) => ({ id, userId, type: 'video', url: `/api/local-media/creator/${userId}/videos/${id}.mp4`, duration: 1, deletedAt: null })
let directory: string
const originalDataDirectory = process.env.LOCAL_DATA_DIR

describe('local creator video merge', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creator-merge-test-'))
        process.env.LOCAL_DATA_DIR = directory
        state.find.mockResolvedValue([asset(12n), asset(11n)])
        state.update.mockResolvedValue({ count: 1 })
        state.saved.mockResolvedValue(null)
        state.merge.mockResolvedValue(2)
        state.save.mockImplementation(async ({ create }) => ({ ...create, id: '99' }))
        state.transaction.mockImplementation(async run => run({ projectAiJob: { updateMany: state.update }, creatorAsset: { upsert: state.save } }))
        state.cover.mockImplementation(async (_source, destination) => fs.writeFile(destination, Buffer.alloc(20)))
        state.merge.mockImplementation(async (_inputs, destination) => { await fs.writeFile(destination, Buffer.alloc(2048)); return 2 })
    })

    afterEach(async () => {
        if (originalDataDirectory === undefined) delete process.env.LOCAL_DATA_DIR
        else process.env.LOCAL_DATA_DIR = originalDataDirectory
        await fs.rm(directory, { recursive: true, force: true })
    })

    it('retains requested order and scopes lookup to live videos owned by the user', async () => {
        expect((await loadCreatorMergeAssets(7n, input)).map(item => item.id)).toEqual([11n, 12n])
        expect(state.find).toHaveBeenCalledWith({ where: { id: { in: [11n, 12n] }, userId: 7n, type: 'video', deletedAt: null } })
    })

    it('rejects foreign or external media before FFmpeg is called', async () => {
        state.find.mockResolvedValue([asset(11n), { ...asset(12n), url: '/api/local-media/creator/8/videos/12.mp4' }])
        await expect(loadCreatorMergeAssets(7n, input)).rejects.toThrow('不是本地作品')
        state.find.mockResolvedValue([asset(11n), { ...asset(12n), url: 'https://example.test/video.mp4' }])
        await expect(loadCreatorMergeAssets(7n, input)).rejects.toThrow('不是本地作品')
        expect(state.merge).not.toHaveBeenCalled()
    })

    it('checks local media symlinks and persists failure without creating output', async () => {
        const videos = path.join(directory, 'media/creator/7/videos')
        await fs.mkdir(videos, { recursive: true })
        await fs.symlink(os.tmpdir(), path.join(videos, '11.mp4'))
        state.findJob.mockResolvedValue({ id: 90n, result: { input, requestKey: input.requestKey }, phase: 'queued' })
        await runCreatorVideoMerge('90', 7n)
        expect(state.merge).not.toHaveBeenCalled()
        expect(state.save).not.toHaveBeenCalled()
        expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'error', error: 'Local media symlinks are not allowed' }) }))
    })

    it('claims one queued job and saves its local output with the original order', async () => {
        const videos = path.join(directory, 'media/creator/7/videos')
        await fs.mkdir(videos, { recursive: true })
        await Promise.all(['11', '12'].map(id => fs.writeFile(path.join(videos, `${id}.mp4`), Buffer.alloc(1024))))
        state.findJob.mockResolvedValue({ id: 90n, result: { input, requestKey: input.requestKey }, phase: 'queued' })
        await runCreatorVideoMerge('90', 7n)
        expect(state.merge).toHaveBeenCalledWith([path.join(videos, '11.mp4'), path.join(videos, '12.mp4')], expect.any(String), '16:9', expect.any(Function))
        expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 7n, sourceJobId: 90n, provider: 'ffmpeg-merge', duration: 2 }) }))
        expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'done', activeKey: null }) }))
    })

    it('does not expose another user’s job through a requested id', async () => {
        state.findJob.mockResolvedValue(null)
        await expect(getCreatorVideoMergeJob(7n, '90')).resolves.toBeNull()
        expect(state.findJob).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 90n, projectId: 7n, kind: 'creator_video_merge' } }))
    })
})
