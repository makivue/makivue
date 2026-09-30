import { beforeEach, describe, expect, it, vi } from 'vitest'
const { chatGemini } = vi.hoisted(() => ({ chatGemini: vi.fn() }))
vi.mock('@/services/gemini-text', () => ({ chatGemini }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: vi.fn() } } }))
import { planEpisodeScenes } from '@/services/llm'
const params = { chapterNumber: 1, chapterContent: 'Amara opens the door.', model: 'gemini:gemini-3.7-flash' }
beforeEach(() => chatGemini.mockReset())
describe('basic scene planning', () => {
    it('accepts a minimal scene without quality checks or a repair request', async () => {
        chatGemini.mockResolvedValue(JSON.stringify({ scenes: [{ slugline: 'Doorway/day' }] }))
        await expect(planEpisodeScenes(params)).resolves.toEqual([expect.objectContaining({ sceneNumber: 1, slugline: 'Doorway/day', estimatedSeconds: 30 })])
        expect(chatGemini).toHaveBeenCalledOnce()
    })
    it('rejects empty results without extra calls', async () => {
        chatGemini.mockResolvedValue(JSON.stringify({ scenes: [] }))
        await expect(planEpisodeScenes(params)).rejects.toThrow('请手动重试')
        expect(chatGemini).toHaveBeenCalledOnce()
    })
})
