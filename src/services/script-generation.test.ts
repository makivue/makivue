import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateReviewedScript } from './script-generation'
import { correctEpisodeScript, generateEpisodeScript, planEpisodeScenes } from './llm'
import { reviewNarrativeContent } from './narrative-review'
import { analyzeScriptTiming } from '@/lib/script-timing'
import { runScriptBatch } from '@/lib/script-batch'

vi.mock('./llm', () => ({ generateEpisodeScript: vi.fn(), correctEpisodeScript: vi.fn(), planEpisodeScenes: vi.fn() }))
vi.mock('./narrative-review', () => ({ reviewNarrativeContent: vi.fn() }))

const params = { title: 'The key', chapterNumber: 1, chapterContent: 'Amara finds the key.', setup: { episodeFormat: 'micro' as const }, allowedCharacterNames: ['Amara'] }
const draft = (beats: number) => ({
    title: 'The key',
    synopsis: 'Amara finds the key and unlocks the door.',
    script: [
        '【场景：Apartment/day/interior】',
        '（场景描述：A key rests on the table by the locked door.）',
        '（Opening state: Amara stands by the table.）',
        '（表情：Seeing the key, Amara widens her eyes and parts her lips.）',
        ...Array.from({ length: beats }, () => '（动作：Amara picks up the key and turns toward the door.）\nAmara: Wait here until I return with the key.'),
        '（Ending state: Amara stands at the open door holding the key.）'
    ].join('\n')
})

beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(planEpisodeScenes).mockResolvedValue([])
    vi.mocked(reviewNarrativeContent).mockResolvedValue({
        issues: [],
        quality: null,
        facts: {
            episodeNumber: 1,
            summary: 'Amara finds the key.',
            openingState: 'Door closed.',
            endingState: 'Door open.',
            characterStateChanges: 'Amara has the key.',
            continuityBridge: 'She leaves.',
            events: [],
            sourceVersion: 1,
            sourceHash: 'test',
            sourceStage: 'script',
            kind: 'observed'
        }
    })
})

describe('script runtime is advisory', () => {
    it.each([1, 40])('returns a reviewed script outside the target range without a duration-only repair (%s beats)', async beats => {
        const result = draft(beats)
        const { estimatedSeconds } = analyzeScriptTiming(result.script)
        expect(beats === 1 ? estimatedSeconds < 45 : estimatedSeconds > 144).toBe(true)
        vi.mocked(generateEpisodeScript).mockResolvedValue(result)

        await expect(generateReviewedScript(params)).resolves.toMatchObject(result)
        expect(reviewNarrativeContent).toHaveBeenCalledOnce()
        expect(correctEpisodeScript).not.toHaveBeenCalled()
    })

    it('continues subsequent episodes when runtime is the only deviation', async () => {
        vi.mocked(generateEpisodeScript).mockResolvedValue(draft(40))
        const onComplete = vi.fn()
        const onRetry = vi.fn()
        const issue = await runScriptBatch({
            episodes: [
                { id: 'one', episodeNumber: 1 },
                { id: 'two', episodeNumber: 2 }
            ],
            generate: async episode => {
                await generateReviewedScript({ ...params, chapterNumber: episode.episodeNumber })
            },
            onAttempt: vi.fn(),
            onComplete,
            onRetry
        })

        expect(issue).toBeNull()
        expect(onComplete).toHaveBeenCalledTimes(2)
        expect(onRetry).not.toHaveBeenCalled()
        expect(correctEpisodeScript).not.toHaveBeenCalled()
    })

    it('still rejects missing content and overlong uninterrupted speech after repair', async () => {
        const invalid = { ...draft(40), script: `Amara: ${'Explain everything again. '.repeat(30)}` }
        vi.mocked(generateEpisodeScript).mockResolvedValue(invalid)
        vi.mocked(correctEpisodeScript).mockResolvedValue(invalid)

        await expect(generateReviewedScript(params)).rejects.toThrow('剧本质量检查未通过')
        const issues = vi.mocked(correctEpisodeScript).mock.calls[0][0].issues
        expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['too_few_scenes', 'long_dialogue_turn']))
        expect(reviewNarrativeContent).not.toHaveBeenCalled()
    })

    it('still rejects narrative conflicts after repair', async () => {
        const result = draft(40)
        vi.mocked(generateEpisodeScript).mockResolvedValue(result)
        vi.mocked(correctEpisodeScript).mockResolvedValue(result)
        vi.mocked(reviewNarrativeContent).mockResolvedValue({ issues: [{ path: 'script', code: 'narrative_conflict', message: '关键事件遗漏' }], quality: null, facts: {} as never })

        await expect(generateReviewedScript(params)).rejects.toThrow('关键事件遗漏')
        expect(correctEpisodeScript).toHaveBeenCalledOnce()
    })
})
