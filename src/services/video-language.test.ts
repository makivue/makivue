import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'

const mocks = vi.hoisted(() => ({
    config: vi.fn(),
    chatJSON: vi.fn(),
    getConfiguredTextModelName: vi.fn(),
    resolveMaxTokens: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        aiServiceConfig: { findUnique: mocks.config }
    }
}))
vi.mock('@/services/llm', () => ({
    chatJSON: mocks.chatJSON,
    getConfiguredTextModelName: mocks.getConfiguredTextModelName,
    resolveMaxTokens: mocks.resolveMaxTokens,
    STABLE_GPT_TEXT_MODEL: 'gpt-5.4-shortdrama'
}))

import { extractDialogueTurns, getConfiguredVideoLanguage, getDialogueSpeakerNames, localizeStoryboardDialogue, localizeVideoSpeech, softenFictionalDialogueForTranslation } from './video-language'

describe('video language runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.chatJSON.mockReset()
        vi.unstubAllEnvs()
        mocks.config.mockResolvedValue(null)
        mocks.getConfiguredTextModelName.mockResolvedValue(GEMINI_FLASH_TEXT_MODEL_ID)
        mocks.resolveMaxTokens.mockReturnValue(16884)
    })

    it('uses the global database setting before the environment default', async () => {
        vi.stubEnv('VIDEO_LANGUAGE', 'zh')
        mocks.config.mockResolvedValue({ modelName: 'en' })
        await expect(getConfiguredVideoLanguage()).resolves.toBe('en')
    })

    it('translates Chinese speech for English video and leaves English unchanged', async () => {
        mocks.chatJSON.mockResolvedValue({ translation: 'I will come back.' })
        await expect(localizeVideoSpeech('我会回来。', 'en')).resolves.toBe('I will come back.')
        await expect(localizeVideoSpeech('Already in English.', 'en')).resolves.toBe('Already in English.')
        expect(mocks.chatJSON).toHaveBeenCalledTimes(1)
    })

    it('retries empty or wrong-language translations and accepts only the target language', async () => {
        mocks.chatJSON.mockResolvedValueOnce({ translation: '' }).mockResolvedValueOnce({ translation: '我会回来。' }).mockResolvedValueOnce({ translation: 'I will come back.' })
        await expect(localizeVideoSpeech('我会回来！', 'en')).resolves.toBe('I will come back.')
        expect(mocks.chatJSON).toHaveBeenCalledTimes(3)
    })

    it('reserves reasoning tokens for Gemini translation output', async () => {
        mocks.chatJSON.mockResolvedValue({ translation: 'It is over, ghost of the old era.' })
        await expect(localizeVideoSpeech('结束了，旧时代的亡魂。', 'en')).resolves.toBe('It is over, ghost of the old era.')
        expect(mocks.resolveMaxTokens).toHaveBeenCalledWith(500, GEMINI_FLASH_TEXT_MODEL_ID)
        expect(mocks.chatJSON).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ maxTokens: 16884 }))
    })

    it('accepts common structured translation field names without weakening language validation', async () => {
        mocks.chatJSON.mockResolvedValue({ translatedText: 'Do not leave.' })
        await expect(localizeVideoSpeech('不要走。', 'en')).resolves.toBe('Do not leave.')
    })

    it('does not accept wrong-language output after primary and alternate translation attempts', async () => {
        mocks.chatJSON.mockResolvedValue({ translation: '仍然是中文' })
        await expect(localizeVideoSpeech('别离开这里。', 'en')).rejects.toThrow('视频台词语言转换暂时未完成')
        expect(mocks.chatJSON).toHaveBeenCalledTimes(4)
    })

    it('switches translation service immediately when Gemini rejects fictional dialogue for safety', async () => {
        mocks.chatJSON.mockRejectedValueOnce(new Error('Gemini finish reason: SAFETY')).mockResolvedValueOnce({
            translation: 'You are finished! You are too weak! I will defeat you completely!'
        })
        await expect(localizeVideoSpeech('去死吧！你这个废物！我要撕碎你！', 'en')).resolves.toBe('You are finished! You are too weak! I will defeat you completely!')
        expect(mocks.chatJSON).toHaveBeenCalledTimes(2)
        expect(mocks.chatJSON).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ model: 'gpt-5.4-shortdrama' }))
    })

    it('uses a broadcast-safe semantic fallback only after real safety blocks', async () => {
        mocks.chatJSON
            .mockRejectedValueOnce(new Error('Gemini finish reason: SAFETY'))
            .mockRejectedValueOnce(new Error('alternate content filter'))
            .mockResolvedValueOnce({ translation: 'You are finished! I will defeat you completely!' })
        await expect(localizeVideoSpeech('去死！我要撕碎你！', 'en')).resolves.toBe('You are finished! I will defeat you completely!')
        const fallbackMessages = mocks.chatJSON.mock.calls[2][0] as Array<{ content: string }>
        expect(fallbackMessages[1].content).toContain('你完了')
        expect(fallbackMessages[1].content).toContain('彻底击败你')
        expect(fallbackMessages[1].content).not.toContain('撕碎你')
    })

    it('softens only common graphic threats while retaining fictional dramatic intent', () => {
        expect(softenFictionalDialogueForTranslation('去死吧！你这个废物！我要撕碎你！')).toBe('你完了！你太弱了！我要彻底击败你！')
    })

    it('rejects obviously truncated translations and retries for the complete line', async () => {
        mocks.chatJSON.mockResolvedValueOnce({ translation: 'Sir, we' }).mockResolvedValueOnce({ translation: 'Sir, we are surrounded and cannot hold the position much longer.' })
        await expect(localizeVideoSpeech('长官，我们已经被包围了，这个阵地坚持不了多久。', 'en')).resolves.toBe('Sir, we are surrounded and cannot hold the position much longer.')
        expect(mocks.chatJSON).toHaveBeenCalledTimes(2)
    })

    it('keeps dialogue turns and detects distinct speakers for model routing', () => {
        const dialogue = '飞行员：RPG！\n指挥官：规避！\n飞行员：收到！'
        expect(extractDialogueTurns(dialogue)).toEqual([
            { speakerName: '飞行员', text: 'RPG！' },
            { speakerName: '指挥官', text: '规避！' },
            { speakerName: '飞行员', text: '收到！' }
        ])
        expect(getDialogueSpeakerNames(dialogue)).toEqual(['飞行员', '指挥官'])
    })

    it('localizes multi-speaker dialogue one complete line at a time', async () => {
        mocks.chatJSON.mockResolvedValueOnce({ translation: 'RPG! Six o’clock!' }).mockResolvedValueOnce({ translation: 'Evade! Now!' })
        await expect(localizeStoryboardDialogue('飞行员：RPG！六点钟方向！\n指挥官：规避！快！', 'en')).resolves.toBe('飞行员：RPG! Six o’clock!\n指挥官：Evade! Now!')
        expect(mocks.chatJSON).toHaveBeenCalledTimes(2)
    })
})
