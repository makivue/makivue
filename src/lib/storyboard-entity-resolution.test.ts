import { describe, expect, it } from 'vitest'
import { resolveStoryboardEntityLinks } from './storyboard-entity-resolution'

const characters = [
    { id: 1n, name: '青年', canonicalName: '青年', aliases: ['青年', '小子'] },
    { id: 2n, name: '老韩', canonicalName: '老韩', aliases: ['老韩', '韩叔'] },
    { id: 3n, name: '哑师傅', canonicalName: '哑师傅', aliases: ['哑师傅', '师傅'] }
]
const scenes = [
    { id: 11n, name: '护镖队营地', canonicalName: '护镖队营地', aliases: ['荒野营地'] },
    { id: 12n, name: '破败神庙', canonicalName: '破败神庙', aliases: ['破庙旧址', '神庙'] }
]

describe('storyboard entity resolution', () => {
    it('normalizes generated names and resolves project aliases', () => {
        const result = resolveStoryboardEntityLinks({ sceneName: ' 荒野 营地 ', characterNames: ['韩叔'], actionDesc: '青年跌坐在雨中，老韩挡在前方' }, { characters, scenes })
        expect(result.scene?.id).toBe(11n)
        expect(result.characters.map(character => character.id)).toEqual([2n, 1n])
    })

    it('recovers missing generated associations from visible action text', () => {
        const result = resolveStoryboardEntityLinks({ actionDesc: 'Opening state: 护镖队营地暴雨倾盆，老韩护住青年; Ending state: 妖风卷起泥水' }, { characters, scenes })
        expect(result.scene?.name).toBe('护镖队营地')
        expect(result.characters.map(character => character.name)).toEqual(['青年', '老韩'])
    })

    it('uses dialogue speakers but does not bind a character merely mentioned inside dialogue', () => {
        const result = resolveStoryboardEntityLinks({ dialogue: '青年：这是哑师傅留给我的剑。', actionDesc: '青年举起半截断剑' }, { characters, scenes })
        expect(result.characters.map(character => character.name)).toEqual(['青年'])
    })

    it('does not turn a referenced off-screen character in the image prompt into a visible character', () => {
        const result = resolveStoryboardEntityLinks({ actionDesc: '青年从行囊夹层抽出半截断剑', imagePrompt: '青年拿出哑师傅留给他的断剑' }, { characters, scenes })
        expect(result.characters.map(character => character.name)).toEqual(['青年'])
    })

    it('leaves unmatched locations unbound instead of inventing a project scene', () => {
        const result = resolveStoryboardEntityLinks({ actionDesc: '青年在戏班后院练功' }, { characters, scenes })
        expect(result.scene).toBeNull()
        expect(result.characters.map(character => character.name)).toEqual(['青年'])
    })
})
