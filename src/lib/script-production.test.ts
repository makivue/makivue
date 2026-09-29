import { describe, expect, it } from 'vitest'
import { buildScriptProductionBatches, StoryboardProductionError, validateStoryboardProduction } from './script-production'

describe('script-to-storyboard coverage', () => {
    const performance = {
        version: 1,
        opening: 'Elias stands beside the window.',
        middles: [
            {
                index: 1,
                state: 'Elias looks up',
                trigger: 'A flash lights up the window',
                gazeTarget: 'The red sky above the rooftops',
                facialPerformance: 'His eyes widen and his breath catches',
                bodyPerformance: 'His shoulders rise and his fingers tighten on the sill'
            }
        ],
        ending: 'Elias grips the window sill.'
    }
    const voicedShot = { order: 1, sourceBeatIds: ['B0001'], imagePrompt: 'Elias stands at the window', actionPlan: performance, dialogue: 'Elias: The sky is burning.' }

    it('accepts a short state summary when structured performance details are complete', () => {
        expect(validateStoryboardProduction([voicedShot], [{ id: 'B0001', text: voicedShot.dialogue }])).toEqual([])
    })

    it('accepts the short Chinese state summary used in the generation prompt', () => {
        const shot = {
            ...voicedShot,
            dialogue: '林晓薇：你终于来了。',
            actionPlan: {
                opening: '林晓薇低头坐在靠窗咖啡桌旁',
                middles: [
                    {
                        index: 1,
                        state: '林晓薇停住拇指并抬眼',
                        trigger: '门铃声响起',
                        gazeTarget: '咖啡厅门口',
                        facialPerformance: '屏住呼吸，嘴唇微张',
                        bodyPerformance: '肩背缓慢挺直，重心前移',
                        propMotion: '手机仍压在掌心'
                    }
                ],
                ending: '林晓薇抬头看向门口'
            }
        }
        expect(validateStoryboardProduction([shot], [{ id: 'B0001', text: shot.dialogue }])).toEqual([])
    })

    it('counts non-Latin performance text rather than treating it as empty', () => {
        const shot = {
            ...voicedShot,
            dialogue: '',
            actionPlan: {
                opening: 'يقف بجانب النافذة',
                middles: [{ state: 'ينظر إلى الباب عندما يسمع الخطوات ويحبس أنفاسه ثم يرفع يده ببطء ويمسك بالمقبض بقوة' }],
                ending: 'يمسك بالمقبض'
            }
        }
        expect(validateStoryboardProduction([shot], [{ id: 'B0001', text: '（动作：He grips the handle.）' }])).toEqual([])
    })

    it('still rejects empty performance fields and pinpoints the weak middle', () => {
        const shot = { ...voicedShot, actionPlan: { ...performance, middles: [{ index: 1, state: 'continuing', trigger: '', gazeTarget: '', facialPerformance: '', bodyPerformance: '' }] } }
        expect(validateStoryboardProduction([shot], [{ id: 'B0001', text: shot.dialogue }])).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: 'weak_middle_state', path: 'storyboards[0].actionPlan.middles[0]' }),
                expect.objectContaining({ code: 'incomplete_performance_plan' })
            ])
        )
    })

    it('compares normalized speaker casing and spacing without changing source text', () => {
        const beats = [{ id: 'B0001', text: 'DR.  ELIAS: The sky is burning.' }]
        const shot = { ...voicedShot, dialogue: 'Dr. Elias: The sky is burning!' }
        expect(validateStoryboardProduction([shot], beats)).toEqual([])
        expect(beats[0].text).toBe('DR.  ELIAS: The sky is burning.')
        expect(validateStoryboardProduction([{ ...shot, dialogue: 'Dr. Elena: The sky is burning!' }], beats).map(issue => issue.code)).toContain('dialogue_mismatch')
    })

    it('returns the original mismatching lines and the full affected shot range for repair', () => {
        const beats = [
            { id: 'B0001', text: 'Elias: The sky is burning.' },
            { id: 'B0002', text: 'Anna: Run now.' },
            { id: 'B0003', text: 'Ben: Follow me.' }
        ]
        const shots = [
            voicedShot,
            { ...voicedShot, order: 2, sourceBeatIds: ['B0002'], dialogue: 'Anna: Run later.' },
            { ...voicedShot, order: 3, sourceBeatIds: ['B0003'], dialogue: 'Ben: Follow me.' }
        ]
        expect(validateStoryboardProduction(shots, beats)).toEqual([
            expect.objectContaining({
                code: 'dialogue_mismatch',
                shotIndexes: [1],
                details: { turn: 2, expected: 'Anna: Run now.', actual: 'Anna: Run later.', sourceBeatIds: ['B0002'] }
            })
        ])
        const swapped = [shots[0], { ...shots[1], dialogue: 'Ben: Follow me.' }, { ...shots[2], dialogue: 'Anna: Run now.' }]
        expect(validateStoryboardProduction(swapped, beats).find(issue => issue.code === 'dialogue_mismatch')?.shotIndexes).toEqual([1, 2])
    })

    it('locates omitted speech by the source beat even when no actual turn exists', () => {
        const beats = [{ id: 'B0001', text: voicedShot.dialogue }]
        const issue = validateStoryboardProduction([{ ...voicedShot, dialogue: '' }], beats).find(issue => issue.code === 'dialogue_mismatch')
        expect(issue).toMatchObject({ shotIndexes: [0], details: { expected: voicedShot.dialogue, actual: null, sourceBeatIds: ['B0001'] } })
    })

    it('recognizes English voice-over labels without moving them into visible dialogue', () => {
        const beats = [{ id: 'B0001', text: 'ELIAS (V.O.): The sky is burning.' }]
        const shot = { ...voicedShot, dialogue: '', narration: 'Elias（V.O.）：The sky is burning.' }
        expect(validateStoryboardProduction([shot], beats)).toEqual([])
        expect(validateStoryboardProduction([{ ...shot, dialogue: shot.narration, narration: '' }], beats).map(issue => issue.code)).toContain('narration_mismatch')
    })

    it('does not silently ignore invented or malformed speech in generated fields', () => {
        const beats = [{ id: 'B0001', text: '（动作：Elias looks out.）' }]
        for (const dialogue of ['The sky is burning.', 'Narrator: The sky is burning.']) {
            expect(validateStoryboardProduction([{ ...voicedShot, dialogue }], beats).map(issue => issue.code)).toContain('dialogue_mismatch')
        }
    })

    it('deduplicates the failure notice while preserving every diagnostic', () => {
        const issues = Array.from({ length: 32 }, (_, index) => ({
            path: `storyboards[${index}].actionPlan.middles[0]`,
            code: 'weak_middle_state',
            message: 'Middle state 过于抽象；请写明触发、视线目标，以及脸部/呼吸/手部/肩背/重心或道具的可见变化'
        }))
        const failure = new StoryboardProductionError('分镜完整性检查未通过：', issues)
        expect(failure.message.match(/Middle state/g)).toHaveLength(1)
        expect(failure.message).toContain('#1, #2, #3, #4, #5, #6, …')
        expect(failure.message).toContain('×32')
        expect(failure.message.length).toBeLessThan(200)
        expect(failure.issues).toEqual(issues)
    })

    it('rejects swapped speaker turns even when every speaker retains all their words', () => {
        const beats = [
            { id: 'B0001', text: '阿青：你拿到信了吗？' },
            { id: 'B0002', text: '小雨：拿到了。' }
        ]
        const base = { imagePrompt: '桌边的两个人', actionDesc: 'Opening state: 阿青看向小雨; Middle state 1: 小雨避开阿青的目光，右手探入衣袋，肩膀因屏息微微抬起; Ending state: 小雨拿出信封' }
        const shots = [
            { ...base, order: 1, sourceBeatIds: ['B0001'], dialogue: '小雨：拿到了。' },
            { ...base, order: 2, sourceBeatIds: ['B0002'], dialogue: '阿青：你拿到信了吗？' }
        ]
        expect(validateStoryboardProduction(shots, beats).some(issue => issue.code === 'dialogue_mismatch')).toBe(true)
    })

    it('rejects replaying an earlier action after an intervening event', () => {
        const beats = [
            { id: 'B0001', text: '（动作：交出信封）' },
            { id: 'B0002', text: '（动作：烧掉信封）' }
        ]
        const base = { imagePrompt: '信封', actionDesc: 'Opening state: 手持信封; Ending state: 信封烧尽' }
        const shots = ['B0001', 'B0002', 'B0001'].map((id, index) => ({ ...base, order: index + 1, sourceBeatIds: [id] }))
        expect(validateStoryboardProduction(shots, beats).some(issue => issue.code === 'source_order_changed')).toBe(true)
    })
    it('keeps every action and dialogue in order when a long scene needs multiple batches', () => {
        const lines = Array.from({ length: 31 }, (_, index) => `（动作：阿青完成第${index + 1}步，放下对应的文件。）`)
        const batches = buildScriptProductionBatches(`【场景：办公室/日/内】\n（场景描述：门在书桌左侧。）\n${lines.join('\n')}\n阿青：证据齐了。`, 4500, 12)
        const beats = batches.flatMap(batch => batch.beats)
        expect(beats.slice(0, -1).map(beat => beat.text)).toEqual(lines.slice(0, -1))
        expect(beats.at(-1)?.text).toBe(`${lines.at(-1)}\n阿青：证据齐了。`)
        expect(new Set(beats.map(beat => beat.id)).size).toBe(31)
        expect(batches).toHaveLength(3)
        expect(batches.every(batch => batch.script.includes('门在书桌左侧'))).toBe(true)
    })

    it('keeps a normal 28-beat episode in one default model batch', () => {
        const lines = Array.from({ length: 28 }, (_, index) => `（动作：阿青完成第${index + 1}步。）`)
        const batches = buildScriptProductionBatches(`【场景：办公室/日/内】\n${lines.join('\n')}`)

        expect(batches).toHaveLength(1)
        expect(batches[0].beats).toHaveLength(28)
    })

    it('rejects empty results, omitted dialogue and invented source IDs', () => {
        const beats = [
            { id: 'B0001', text: '（动作：阿青交出信封。）' },
            { id: 'B0002', text: '阿青：你父亲还活着。' }
        ]
        expect(validateStoryboardProduction([], beats)[0].code).toBe('empty_storyboards')
        const issues = validateStoryboardProduction(
            [
                {
                    order: 1,
                    sourceBeatIds: ['B0001', 'B9999'],
                    imagePrompt: '阿青握住信封',
                    actionDesc: 'Opening state: 阿青手持信封; Ending state: 小雨接过信封'
                }
            ],
            beats
        )
        expect(issues.map(issue => issue.code)).toEqual(['unknown_source_beat', 'uncovered_beat'])
        expect(issues[1].message).toContain('你父亲还活着')
    })

    it('allows a complex source action to span multiple shots without losing the ending', () => {
        const beats = [{ id: 'B0001', text: '（动作：阿青推门走入室内。）' }]
        const shots = [
            { order: 1, sourceBeatIds: ['B0001'], imagePrompt: '阿青手握门把', actionDesc: 'Opening state: 阿青握住门把; Ending state: 门向内打开' },
            { order: 2, sourceBeatIds: ['B0001'], imagePrompt: '门已经打开', actionDesc: 'Opening state: 门向内打开; Ending state: 阿青站在室内' }
        ]
        expect(validateStoryboardProduction(shots, beats)).toEqual([])
    })

    it('rejects missing spoken words even when every source ID was claimed', () => {
        const beats = [{ id: 'B0001', text: '阿青：你父亲还活着。证据在这里。' }]
        const shot = {
            order: 1,
            sourceBeatIds: ['B0001'],
            imagePrompt: '阿青拿出信封',
            actionDesc: 'Opening state: 阿青手持信封; Middle state 1: 阿青盯住小雨，压低呼吸并用拇指推着信封向前，肩膀随话音下沉; Ending state: 阿青将信封放在桌上'
        }
        expect(validateStoryboardProduction([{ ...shot, dialogue: '阿青：证据在这里。' }], beats).some(issue => issue.code === 'dialogue_mismatch')).toBe(true)
        expect(
            validateStoryboardProduction(
                [
                    { ...shot, dialogue: '阿青：你父亲还活着。' },
                    { ...shot, order: 2, dialogue: '阿青：证据在这里。' }
                ],
                beats
            )
        ).toEqual([])
        expect(validateStoryboardProduction([{ ...shot, dialogue: '小雨：你父亲还活着。证据在这里。' }], beats).some(issue => issue.code === 'dialogue_mismatch')).toBe(true)
    })

    it('keeps the final boundary without resetting later batches to the initial pose', () => {
        const batches = buildScriptProductionBatches(
            '【场景：门口/日/内】 （Opening state: 阿青站在门外）\n（场景描述：木门）\n（动作：阿青进门）\n（动作：阿青落座）\n（Ending state: 阿青坐在椅子上）',
            4500,
            1
        )
        expect(batches).toHaveLength(2)
        expect(batches[1].script).toContain('场景描述：木门')
        expect(batches[1].script).not.toContain('Opening state: 阿青站在门外')
        expect(batches[1].script).toContain('Ending state: 阿青坐在椅子上')
    })

    it('turns malformed model fields into actionable issues', () => {
        const issues = validateStoryboardProduction([{ order: 1, sourceBeatIds: [null], imagePrompt: {}, actionDesc: 2 }] as never, [{ id: 'B0001', text: '阿青进门' }])
        expect(issues.map(issue => issue.code)).toContain('missing_boundary')
        expect(issues.map(issue => issue.code)).toContain('unknown_source_beat')
    })

    it('keeps a new scene and delivery instructions with the beat that needs them', () => {
        const batches = buildScriptProductionBatches('【场景：门口/日/内】\n（动作：阿青进门）\n【场景：楼上/夜/内】\n（人物状态：小雨在桌边站定）\n（台词提示：压低声音）\n小雨：有人来了。', 4500, 1)
        expect(batches[0].script).not.toContain('楼上')
        expect(batches[1].script).toContain('人物状态：小雨在桌边站定')
        expect(batches[1].script).toContain('台词提示：压低声音')
    })

    it('groups performance direction and its spoken line into one semantic beat', () => {
        const [batch] = buildScriptProductionBatches(
            '【场景：门口/夜/内】\n（表情：门响后阿青眉心收紧，屏住呼吸。）\n（动作：阿青把信封藏到身后。）\n（台词提示：压低声音，停顿后试探。）\n阿青：谁在外面？'
        )
        expect(batch.beats).toHaveLength(1)
        expect(batch.beats[0].text).toContain('表情：')
        expect(batch.beats[0].text).toContain('动作：')
        expect(batch.beats[0].text).toContain('阿青：谁在外面？')
    })

    it('rejects reordered events even when all source IDs are present', () => {
        const beats = [
            { id: 'B0001', text: '（动作：交出信封）' },
            { id: 'B0002', text: '（动作：打开信封）' }
        ]
        const shot = { order: 1, imagePrompt: '信封', actionDesc: 'Opening state: 手持信封; Ending state: 信封打开' }
        expect(
            validateStoryboardProduction(
                [
                    { ...shot, sourceBeatIds: ['B0002'] },
                    { ...shot, order: 2, sourceBeatIds: ['B0001'] }
                ],
                beats
            ).some(issue => issue.code === 'source_order_changed')
        ).toBe(true)
    })

    it('requires an executable middle performance for voiced shots, independent of planned duration', () => {
        const beats = [{ id: 'B0001', text: '阿青：门外有人。' }]
        const base = { order: 1, sourceBeatIds: ['B0001'], imagePrompt: '门边的阿青', dialogue: '阿青：门外有人。' }
        expect(validateStoryboardProduction([{ ...base, duration: 6, actionDesc: 'Opening state: 阿青侧耳听门外; Ending state: 阿青握紧门把' }], beats).map(issue => issue.code)).toContain(
            'missing_middle_state'
        )
        expect(
            validateStoryboardProduction([{ ...base, duration: 6, actionDesc: 'Opening state: 阿青侧耳听门外; Middle state 1: 继续动作; Ending state: 阿青握紧门把' }], beats).map(issue => issue.code)
        ).toContain('weak_middle_state')
        expect(
            validateStoryboardProduction(
                [
                    {
                        ...base,
                        duration: 6,
                        actionDesc: 'Opening state: 阿青侧耳听门外; Middle state 1: 门外脚步触发阿青屏住呼吸，他盯住门把，右手缓慢抬起并收紧肩背; Ending state: 阿青握紧门把'
                    }
                ],
                beats
            )
        ).toEqual([])

        const silentBeats = [{ id: 'B0001', text: '（动作：阿青握紧门把。）' }]
        expect(
            validateStoryboardProduction(
                [{ order: 1, sourceBeatIds: ['B0001'], duration: 15, imagePrompt: '门边的阿青', actionDesc: 'Opening state: 阿青侧耳听门外; Ending state: 阿青握紧门把' }],
                silentBeats
            ).map(issue => issue.code)
        ).not.toContain('missing_middle_state')
    })

    it('keeps narration and internal monologue out of visible dialogue', () => {
        const beats = [
            { id: 'B0001', text: '旁白：暴雨已经下了三天。' },
            { id: 'B0002', text: '阿青（内心）：他还是来了。' }
        ]
        const actionDesc = 'Opening state: 阿青站在雨窗前; Middle state 1: 雷声触发阿青抬眼望向门口，他屏住呼吸，手指压紧窗框; Ending state: 阿青转身看向门口'
        const valid = [
            { order: 1, sourceBeatIds: ['B0001'], duration: 6, imagePrompt: '雨窗', narration: '旁白：暴雨已经下了三天。', actionDesc },
            { order: 2, sourceBeatIds: ['B0002'], duration: 6, imagePrompt: '阿青', narration: '阿青（内心）：他还是来了。', actionDesc }
        ]
        expect(validateStoryboardProduction(valid, beats)).toEqual([])
        const misplaced = valid.map(shot => ({ ...shot, dialogue: shot.narration, narration: '' }))
        const codes = validateStoryboardProduction(misplaced, beats).map(issue => issue.code)
        expect(codes).toContain('narration_mismatch')
    })

    it('requires visible dialogue and voice-over to be split into adjacent shots', () => {
        const beats = [
            { id: 'B0001', text: '旁白：门终于开了。' },
            { id: 'B0002', text: '阿青：进来吧。' }
        ]
        const issues = validateStoryboardProduction(
            [
                {
                    order: 1,
                    sourceBeatIds: ['B0001', 'B0002'],
                    duration: 6,
                    imagePrompt: '阿青站在门边',
                    narration: '旁白：门终于开了。',
                    dialogue: '阿青：进来吧。',
                    actionDesc: 'Opening state: 阿青握住门把; Middle state 1: 门锁声触发阿青看向门缝，他松开肩膀并向内拉动门把; Ending state: 阿青将门打开'
                }
            ],
            beats
        )
        expect(issues.map(issue => issue.code)).toContain('mixed_speech_modes')
    })

    it('rejects partially structured performance plans instead of trusting prose alone', () => {
        const beats = [{ id: 'B0001', text: '（动作：阿青抬头看向门口。）' }]
        const issues = validateStoryboardProduction(
            [
                {
                    order: 1,
                    sourceBeatIds: ['B0001'],
                    duration: 6,
                    imagePrompt: '阿青站在门边',
                    actionDesc: 'Opening state: 阿青低头; Middle state 1: 阿青抬头看门; Ending state: 阿青看向门口',
                    actionPlan: {
                        version: 1,
                        opening: '阿青低头',
                        middles: [{ index: 1, state: '阿青抬头看门', trigger: '门铃响起', gazeTarget: '门口' }],
                        ending: '阿青看向门口'
                    }
                }
            ],
            beats
        )
        expect(issues.map(issue => issue.code)).toContain('incomplete_performance_plan')
    })
})
