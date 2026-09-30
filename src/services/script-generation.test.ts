import { runScriptBatch } from '@/lib/script-batch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateEpisodeScript, planEpisodeScenes } from './llm'
import { generateBasicScript } from './script-generation'

vi.mock('./llm', () => ({ generateEpisodeScript: vi.fn(), planEpisodeScenes: vi.fn() }))
const params = { title: 'The key', chapterNumber: 1, chapterContent: 'Amara finds the key.', setup: { episodeFormat: 'micro' as const }, allowedCharacterNames: ['Amara'] }
const draft = { title: 'The key', synopsis: 'Amara unlocks the door.', script: 'Amara: I found the key.' }
beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(planEpisodeScenes).mockResolvedValue([])
    vi.mocked(generateEpisodeScript).mockResolvedValue(draft)
})

describe('basic script generation', () => {
    it('returns the initial draft with a source snapshot and no review calls', async () => {
        const result = await generateBasicScript(params)
        expect(result).toMatchObject(draft)
        expect(result.facts).toMatchObject({ summary: draft.script, sourceStage: 'script', openingState: '', events: [] })
        expect(planEpisodeScenes).toHaveBeenCalledOnce()
        expect(generateEpisodeScript).toHaveBeenCalledOnce()
    })

    it('preserves long dialogue for manual editing without automatic splitting', async () => {
        const script = 'Amara: ' + 'Explain everything again. '.repeat(100)
        vi.mocked(generateEpisodeScript).mockResolvedValue({ ...draft, script })
        await expect(generateBasicScript(params)).resolves.toMatchObject({ script })
        expect(generateEpisodeScript).toHaveBeenCalledOnce()
    })

    it('rejects empty content without review or repair requests', async () => {
        vi.mocked(generateEpisodeScript).mockResolvedValue({ ...draft, script: ' ' })
        await expect(generateBasicScript(params)).rejects.toThrow('模型未返回剧本正文')
        expect(generateEpisodeScript).toHaveBeenCalledOnce()
    })

    it('continues the remaining episodes', async () => {
        const onComplete = vi.fn()
        const onRetry = vi.fn()
        const issue = await runScriptBatch({
            episodes: [
                { id: 'one', episodeNumber: 1 },
                { id: 'two', episodeNumber: 2 }
            ],
            generate: async episode => {
                await generateBasicScript({ ...params, chapterNumber: episode.episodeNumber })
            },
            onAttempt: vi.fn(),
            onComplete,
            onRetry
        })
        expect(issue).toBeNull()
        expect(onComplete).toHaveBeenCalledTimes(2)
        expect(onRetry).not.toHaveBeenCalled()
    })
})
