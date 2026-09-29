import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chatGemini } = vi.hoisted(() => ({ chatGemini: vi.fn() }))
vi.mock('./gemini-text', () => ({ chatGemini }))
vi.mock('@/lib/prisma', () => ({ prisma: { aiServiceConfig: { findUnique: vi.fn().mockResolvedValue({ modelName: 'gpt-4o', apiKey: null }) } } }))

import { generateStoryboards } from './llm'
import { StoryboardProductionError } from '@/lib/script-production'

function response(messages: Array<{ content: string }>, dropLast = false) {
    const text = messages.map(message => message.content).join('\n')
    const ids = [...new Set([...text.matchAll(/\[(B\d{4})\]/g)].map(match => match[1]))]
    return JSON.stringify({
        storyboards: (dropLast ? ids.slice(0, -1) : ids).map((id, index) => ({
            order: index + 1,
            sourceBeatIds: [id],
            shotType: 'wide',
            duration: 11,
            dialogue: '',
            narration: '',
            actionDesc: 'Opening state: 阿青闭眼站在门口; Middle state 1: 门外脚步触发阿青屏住呼吸，他睁眼盯住门把，右手抬起并收紧肩背; Ending state: 阿青睁眼看向门把',
            imagePrompt: '全景，阿青的眼睛微闭，站在门口',
            sceneName: '办公室',
            characterNames: ['阿青'],
            continuityMode: 'stateful'
        }))
    })
}

const params = {
    characters: [{ id: 1n, name: '阿青', appearancePrompt: '灰色外套' }],
    scenes: [{ id: 2n, name: '办公室', locationPrompt: '书桌左侧是门' }],
    model: 'gemini:gemini-3.7-flash',
    maxShotDuration: 15
}

function speakingShot(order: number, id: string, dialogue: string) {
    return {
        order,
        sourceBeatIds: [id],
        shotType: 'close-up',
        duration: 6,
        dialogue,
        narration: '',
        imagePrompt: 'Elias stands at the window',
        actionPlan: {
            version: 1,
            opening: 'Elias looks down at the floor',
            middles: [
                {
                    index: 1,
                    state: 'Elias looks up',
                    trigger: 'A flash lights up the room',
                    gazeTarget: 'The red sky beyond the window',
                    facialPerformance: 'His eyes widen and his breath catches',
                    bodyPerformance: 'He raises his shoulders and grips the sill'
                }
            ],
            ending: 'Elias grips the window sill'
        },
        sceneName: '办公室',
        characterNames: ['阿青']
    }
}

describe('storyboard production generation', () => {
    beforeEach(() => {
        chatGemini.mockReset()
        chatGemini.mockImplementation(async (_model, messages) => response(messages))
    })

    it('accepts complete structured performance and case-only speaker differences on the first pass', async () => {
        chatGemini.mockResolvedValue(JSON.stringify({ storyboards: [speakingShot(1, 'B0001', 'Elias: The sky is burning.')] }))
        const result = await generateStoryboards({ ...params, script: 'ELIAS: The sky is burning.' })
        expect(chatGemini).toHaveBeenCalledTimes(1)
        expect(result.storyboards[0].dialogue).toBe('Elias: The sky is burning.')
        expect(result.storyboards[0].actionDesc).toContain('His eyes widen and his breath catches')
    })

    it('repairs the changed line with exact source diagnostics and preserves valid neighbors', async () => {
        const first = speakingShot(1, 'B0001', 'Elias: The sky is burning.')
        const last = speakingShot(3, 'B0003', 'Ben: Follow me.')
        chatGemini
            .mockResolvedValueOnce(JSON.stringify({ storyboards: [first, speakingShot(2, 'B0002', 'Anna: Run later.'), last] }))
            .mockResolvedValueOnce(JSON.stringify({ storyboards: [speakingShot(1, 'B0002', 'Anna: Run now.')] }))
        const result = await generateStoryboards({ ...params, script: 'Elias: The sky is burning.\nAnna: Run now.\nBen: Follow me.' })
        expect(chatGemini).toHaveBeenCalledTimes(2)
        const prompt = chatGemini.mock.calls[1][1][1].content
        expect(prompt).toContain('"expected":"Anna: Run now."')
        expect(prompt).toContain('"actual":"Anna: Run later."')
        expect(prompt).toContain('"shotIndexes":[0]')
        const draft = prompt.split('# 分镜初稿（含衔接提示字段 _prevEnding）')[1]
        expect(draft).toContain('B0002')
        expect(draft).not.toContain('B0001')
        expect(draft).not.toContain('B0003')
        expect(result.storyboards.map(shot => shot.dialogue)).toEqual([first.dialogue, 'Anna: Run now.', last.dialogue])
    })

    it('repairs all fragments of a source turn together and renumbers local issue paths', async () => {
        const first = speakingShot(1, 'B0001', 'Elias: Listen.')
        const fragments = [speakingShot(2, 'B0002', 'Anna: The sky is burning.'), { ...speakingShot(3, 'B0002', 'Anna: Run now.'), imagePrompt: '' }]
        const last = speakingShot(4, 'B0003', 'Ben: Follow me.')
        chatGemini
            .mockResolvedValueOnce(JSON.stringify({ storyboards: [first, ...fragments, last] }))
            .mockResolvedValueOnce(JSON.stringify({ storyboards: [fragments[0], { ...fragments[1], imagePrompt: 'Anna turns toward the door' }] }))
        const result = await generateStoryboards({ ...params, script: 'Elias: Listen.\nAnna: The sky is burning. Run now.\nBen: Follow me.' })
        expect(chatGemini).toHaveBeenCalledTimes(2)
        const prompt = chatGemini.mock.calls[1][1][1].content
        expect(prompt).toContain('"path":"storyboards[1]"')
        const draft = prompt.split('# 分镜初稿（含衔接提示字段 _prevEnding）')[1]
        expect(draft).toContain('Anna: The sky is burning.')
        expect(draft).toContain('Anna: Run now.')
        expect(draft).not.toContain('B0001')
        expect(draft).not.toContain('B0003')
        expect(result.storyboards.map(shot => shot.dialogue)).toEqual([first.dialogue, fragments[0].dialogue, fragments[1].dialogue, last.dialogue])
    })

    it('retains actionable diagnostics after bounded repairs without returning invalid storyboards', async () => {
        chatGemini.mockResolvedValue(JSON.stringify({ storyboards: [speakingShot(1, 'B0001', 'Elias: The sky is blue.')] }))
        const failure = await generateStoryboards({ ...params, script: 'Elias: The sky is burning.' }).catch(error => error)
        expect(failure).toBeInstanceOf(StoryboardProductionError)
        expect(failure.issues[0]).toMatchObject({ code: 'dialogue_mismatch', details: { expected: 'Elias: The sky is burning.', actual: 'Elias: The sky is blue.' } })
        expect(chatGemini).toHaveBeenCalledTimes(3)
    })

    it('does not run a redundant polish pass when the first result is already valid', async () => {
        const result = await generateStoryboards({ ...params, script: '【场景：办公室/日/内】\n（动作：阿青睁眼看向门口。）' })
        expect(chatGemini).toHaveBeenCalledTimes(1)
        expect(chatGemini.mock.calls.every(call => call[0] === 'gemini-3.7-flash')).toBe(true)
        expect(result.storyboards[0]).toMatchObject({ shotType: 'wide', duration: 11, sourceBeatIds: ['B0001'] })
        expect(result.model).toBe(params.model)
    })

    it('carries the chosen landscape composition and cut continuity into generation prompts', async () => {
        await generateStoryboards({ ...params, script: '（动作：阿青看向窗外。）', setup: { videoAspectRatio: '16:9' } as never })
        for (const call of chatGemini.mock.calls) {
            const prompt = call[1].map((message: { content: string }) => message.content).join('\n')
            expect(prompt).toContain('16:9 横屏构图')
            expect(prompt).toContain('180°')
            expect(prompt).not.toContain('竖屏构图/景别')
        }
    })

    it('inherits the regional setting and historical rules when adapting a script', async () => {
        await generateStoryboards({ ...params, script: '（动作：阿青看向窗外。）', setup: { visualStyle: 'me-historical-legend', contentLanguage: 'zh' } })
        const prompt = chatGemini.mock.calls[0][1].map((message: { content: string }) => message.content).join('\n')
        expect(prompt).toContain('Regional story direction: Middle East / me-historical-legend')
        expect(prompt).toContain('specific place, century and historical context')
        expect(prompt).toContain('preserve supplied plot and dialogue')
        expect(prompt).not.toContain('Abbasid Baghdad in the ninth century:')
    })

    it('repairs only the invalid shot while preserving valid neighboring shots', async () => {
        let call = 0
        chatGemini.mockImplementation(async () => {
            call += 1
            if (call === 1) {
                return JSON.stringify({
                    storyboards: [
                        {
                            order: 1,
                            sourceBeatIds: ['B0001'],
                            shotType: 'close-up',
                            duration: 4,
                            dialogue: '',
                            narration: '',
                            actionDesc: 'Opening state: 阿青站在门边; Ending state: 阿青握住门把',
                            imagePrompt: '',
                            sceneName: '办公室',
                            characterNames: ['阿青']
                        },
                        {
                            order: 2,
                            sourceBeatIds: ['B0002'],
                            shotType: 'close-up',
                            duration: 4,
                            dialogue: '',
                            narration: '',
                            actionDesc: 'Opening state: 阿青握住门把; Ending state: 阿青推开门',
                            imagePrompt: '阿青握住门把，侧光照亮手背',
                            sceneName: '办公室',
                            characterNames: ['阿青']
                        }
                    ]
                })
            }
            return JSON.stringify({
                storyboards: [
                    {
                        order: 1,
                        sourceBeatIds: ['B0001'],
                        shotType: 'close-up',
                        duration: 4,
                        dialogue: '',
                        narration: '',
                        actionDesc: 'Opening state: 阿青站在门边; Ending state: 阿青握住门把',
                        imagePrompt: '阿青站在门边，右手伸向门把，侧光落在紧绷的手背',
                        sceneName: '办公室',
                        characterNames: ['阿青']
                    }
                ]
            })
        })
        const result = await generateStoryboards({ ...params, script: '（动作：阿青伸手握住门把。）\n（动作：阿青推开门。）' })
        expect(chatGemini).toHaveBeenCalledTimes(2)
        const repairPrompt = chatGemini.mock.calls[1][1].map((message: { content: string }) => message.content).join('\n')
        const repairDraft = repairPrompt.split('# 分镜初稿（含衔接提示字段 _prevEnding）')[1]
        expect(repairDraft).toContain('B0001')
        expect(repairDraft).not.toContain('B0002')
        expect(result.storyboards[1].imagePrompt).toBe('阿青握住门把，侧光照亮手背')
    })

    it('retains the ending of long scripts and gives subsequent batches the preceding boundary', async () => {
        const script = `【场景：办公室/日/内】\n${Array.from({ length: 201 }, (_, index) => `（动作：阿青处理第${index + 1}份文件。）`).join('\n')}`
        const result = await generateStoryboards({ ...params, script })
        expect(result.storyboards).toHaveLength(201)
        expect(result.storyboards.at(-1)?.sourceBeatIds).toEqual(['B0201'])
        expect(result.storyboards.at(-1)?.order).toBe(201)
        expect(chatGemini.mock.calls[2][1][1].content).toContain('上一批最后一镜的实际结束状态')
    })

    it('does not call an incomplete polish a successful episode', async () => {
        chatGemini.mockImplementation(async (_model, messages) => response(messages, true))
        await expect(generateStoryboards({ ...params, script: '（动作：阿青推开门。）\n阿青：父亲还活着。' })).rejects.toThrow('完整性检查未通过')
    })

    it('does not shrink the output allowance after a token limit error', async () => {
        chatGemini.mockRejectedValue(new Error('MAX_TOKENS'))
        await expect(generateStoryboards({ ...params, script: '（动作：阿青推开门。）' })).rejects.toThrow('不会截掉后续剧情')
        expect(chatGemini).toHaveBeenCalledTimes(1)
    })
})
