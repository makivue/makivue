import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { storyboard: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } } }))
vi.mock('./llm', () => ({ chatJSON: async () => ({ en: 'Hello' }) }))
vi.mock('./oss', () => ({ uploadToOSS: mocks.upload }))
vi.mock('./video-language', () => ({ getConfiguredVideoLanguage: async () => 'zh', localizeVideoSpeech: async (text: string) => text }))
vi.mock('@/lib/himodels-usage-context.server', () => ({ withHiModelsUsageScope: async (_scope: unknown, work: () => unknown) => work() }))
vi.mock('fs/promises', () => ({ default: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('fs', () => ({ default: { existsSync: () => true } }))
import { generateStoryboardSubtitles } from './subtitle'

describe('subtitle invalidation during translation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.findFirst.mockResolvedValue({ id: 1n, episodeId: 2n, dialogue: '甲：你好', duration: 5, operationVersion: 3, episode: { project: { userId: 4n } } })
        mocks.updateMany.mockResolvedValue({ count: 1 })
        mocks.upload.mockImplementation(async (_path, _subdir, filename) => `https://media/${filename}`)
    })

    it('cannot restore subtitles after a source or media reset', async () => {
        mocks.updateMany.mockResolvedValue({ count: 0 })
        expect(await generateStoryboardSubtitles(1n)).toBeNull()
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1n, deletedAt: null, operationVersion: 3 } }))
    })

    it('uses distinct storage objects for overlapping subtitle generations', async () => {
        const first = await generateStoryboardSubtitles(1n)
        const second = await generateStoryboardSubtitles(1n)
        expect(first?.zh).toBeTruthy()
        expect(second?.zh).toBeTruthy()
        expect(first?.zh).not.toBe(second?.zh)
    })
})
