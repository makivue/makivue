import { buildScriptProductionBatches } from '@/lib/script-production'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateStoryboards } from './llm'
const { chatGemini } = vi.hoisted(() => ({ chatGemini: vi.fn() }))
vi.mock('./gemini-text', () => ({ chatGemini }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: vi.fn().mockResolvedValue(null) } } }))
const params = {
    characters: [{ id: 1n, name: 'Amara', appearancePrompt: 'blue jacket' }],
    scenes: [{ id: 2n, name: 'Office', locationPrompt: 'desk near the door' }],
    model: 'gemini:gemini-3.7-flash',
    maxShotDuration: 15
}
const shot = {
    imagePrompt: 'Amara at the desk',
    actionDesc: 'Amara opens a letter',
    dialogue: 'Amara: Come in.',
    narration: '',
    characterNames: ['Amara'],
    sceneName: 'Office',
    shotType: 'wide',
    duration: 8
}
beforeEach(() => chatGemini.mockReset().mockResolvedValue(JSON.stringify({ storyboards: [shot] })))
describe('basic storyboard generation', () => {
    it('returns the first draft without review, polishing or continuity classification', async () => {
        const result = await generateStoryboards({ ...params, script: 'Amara: Come in.' })
        expect(chatGemini).toHaveBeenCalledOnce()
        expect(result.storyboards).toEqual([{ ...shot, order: 1, continuityMode: 'independent' }])
        expect(result).toMatchObject({ model: params.model, polishStatus: 'not_requested' })
    })
    it('normalizes optional fields and clamps duration to the selected model limit', async () => {
        chatGemini.mockResolvedValue(JSON.stringify({ storyboards: [{ imagePrompt: 'A desk', duration: 99, shotType: 'invalid', dialogue: null, characterNames: ['Amara', 1] }] }))
        const result = await generateStoryboards({ ...params, maxShotDuration: 10, script: 'A door opens.' })
        expect(result.storyboards[0]).toMatchObject({ duration: 10, shotType: 'medium', dialogue: '', characterNames: ['Amara'] })
    })
    it.each([{ storyboards: [] }, { storyboards: [{ imagePrompt: '' }] }, {}])('rejects malformed or empty results without quality regeneration: %j', async response => {
        chatGemini.mockResolvedValue(JSON.stringify(response))
        await expect(generateStoryboards({ ...params, script: 'Amara enters.' })).rejects.toThrow('请手动重试')
        expect(chatGemini).toHaveBeenCalledOnce()
    })
    it('batches the entire long script with one generation per batch', async () => {
        const script = Array.from({ length: 100 }, (_, i) => `Amara: Line ${i}: ${'Please come inside. '.repeat(8)}`).join('\n')
        const result = await generateStoryboards({ ...params, script })
        expect(chatGemini).toHaveBeenCalledTimes(buildScriptProductionBatches(script).length)
        const sent = chatGemini.mock.calls.map(call => call[1][1].content).join('\n')
        for (const line of script.split('\n')) expect(sent).toContain(line.trim())
        expect(result.storyboards.map(row => row.order)).toEqual(result.storyboards.map((_, i) => i + 1))
    })
})
