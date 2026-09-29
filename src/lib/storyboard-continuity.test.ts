import { describe, expect, it } from 'vitest'
import { classifyStoryboardContinuity } from './storyboard-continuity'

describe('classifyStoryboardContinuity', () => {
    it('groups an explicit same-scene action continuation', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, sceneId: 7, sceneName: '走廊', characterNames: ['甲'], actionDesc: 'Opening state: 甲走向门口; Ending state: 甲右手握住门把手' },
            {
                order: 2,
                sceneId: 7,
                sceneName: '走廊',
                characterNames: ['甲'],
                actionDesc: 'Opening state: 甲右手握住门把手; Ending state: 甲继续推门进入',
                continuityMode: 'continuous',
                continuityReason: '强连续：上一镜握住门把手的推门动作尚未完成，本镜继续推门'
            }
        ])
        expect(result[0]).toMatchObject({ continuityGroup: 1 })
        expect(result[1]).toMatchObject({ continuityMode: 'continuous', continuityGroup: 1 })
    })

    it('downgrades a generic same-scene continuation even when boundary text matches', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, sceneId: 7, actionDesc: 'Opening state: 甲起身; Ending state: 甲站在门口' },
            {
                order: 2,
                sceneId: 7,
                actionDesc: 'Opening state: 甲站在门口; Ending state: 甲开口说话',
                continuityMode: 'continuous',
                continuityReason: '同一场景动作延续'
            }
        ])

        expect(result[1]).toMatchObject({ continuityMode: 'stateful' })
        expect(result[1].continuityReason).toContain('未证明是未中断的同一物理动作')
    })

    it('keeps system-created action segments continuous', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, sceneId: 7, actionDesc: 'Opening state: 甲举拳; Ending state: 甲拳头正在向前挥出' },
            {
                order: 2,
                sceneId: 7,
                actionDesc: 'Opening state: 甲拳头正在向前挥出; Ending state: 拳头命中目标',
                continuityMode: 'continuous',
                continuityReason: '复杂动作自动拆镜，第 2/2 段，Opening state 承接上一镜 Ending state'
            }
        ])

        expect(result[1]).toMatchObject({ continuityMode: 'continuous' })
    })

    it('keeps verified system-created segments continuous before a legacy scene binding is repaired', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, actionDesc: 'Opening state: 甲举拳; Ending state: 甲拳头正在向前挥出' },
            {
                order: 2,
                actionDesc: 'Opening state: 甲拳头正在向前挥出; Ending state: 拳头命中目标',
                continuityMode: 'continuous',
                continuityReason: '复杂动作自动拆镜，第 2/2 段，Opening state 承接上一镜 Ending state'
            }
        ])

        expect(result[1]).toMatchObject({ continuityMode: 'continuous' })
    })

    it('downgrades an old continuous label to stateful when scene binding is missing', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, actionDesc: 'Opening state: 甲跌倒; Ending state: 甲撑住地面' },
            {
                order: 2,
                actionDesc: 'Opening state: 甲撑住地面; Ending state: 甲站起',
                continuityMode: 'continuous',
                continuityReason: '同一场景动作延续'
            }
        ])

        expect(result[1]).toMatchObject({ continuityMode: 'stateful' })
    })

    it('downgrades an AI continuous label when boundary states cannot be verified', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, sceneId: 7, characterNames: ['甲'], actionDesc: '甲停在门口' },
            { order: 2, sceneId: 7, characterNames: ['甲'], actionDesc: '甲继续前进', continuityMode: 'continuous' }
        ])

        expect(result[1]).toMatchObject({ continuityMode: 'stateful', continuityGroup: 1 })
        expect(result[1].continuityReason).toContain('降级为状态继承')
    })

    it('keeps exact boundary handoffs continuous even when whole-shot character metadata changes', () => {
        const result = classifyStoryboardContinuity([
            {
                order: 1,
                sceneId: 7,
                characterNames: ['甲', '乙', '丙'],
                actionDesc: 'Opening state: 三人站在门前; Ending state: 甲乙握住门把手'
            },
            {
                order: 2,
                sceneId: 7,
                characterNames: ['甲', '乙'],
                actionDesc: 'Opening state: 甲乙握住门把手; Ending state: 甲乙推门',
                continuityMode: 'continuous',
                continuityReason: '强连续：两人握住门把手的推门动作尚未完成'
            }
        ])

        expect(result[1]).toMatchObject({ continuityMode: 'continuous' })
    })

    it('breaks a group across scene or time changes even if the model over-classifies it', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, sceneName: '走廊', characterNames: ['甲'] },
            { order: 2, sceneName: '街道', characterNames: ['甲'], actionDesc: '次日继续前进', continuityMode: 'seamless' }
        ])
        expect(result[1]).toMatchObject({ continuityMode: 'independent', continuityGroup: null })
    })

    it('keeps ordinary same-scene cuts stateful without forcing a seamless composition', () => {
        const result = classifyStoryboardContinuity([
            { order: 1, sceneName: '会议室', characterNames: ['甲'], actionDesc: '甲站在桌子左侧' },
            { order: 2, sceneName: '会议室', characterNames: ['乙'], actionDesc: '反打乙坐在桌子右侧回应' },
            { order: 3, sceneName: '会议室', characterNames: ['甲', '乙'], actionDesc: '双人中景，乙起身' }
        ])

        expect(result[0]).toMatchObject({ continuityGroup: 1 })
        expect(result[1]).toMatchObject({ continuityMode: 'stateful', continuityGroup: 1 })
        expect(result[2]).toMatchObject({ continuityMode: 'stateful', continuityGroup: 1 })
    })
})
