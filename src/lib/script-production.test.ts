import { describe, expect, it } from 'vitest'
import { buildScriptProductionBatches } from './script-production'

describe('script-to-storyboard coverage', () => {
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
})
