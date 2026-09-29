import { describe, expect, it } from 'vitest'
import { parsePersonalStoryDirections, resolvePersonalStoryModes } from './personal-story-directions'

function direction(mode: string, suffix: string) {
    return {
        title: `人生转折${suffix}`,
        mode,
        logline: `主人公在一次意外重逢后重新面对多年前没有说出口的选择，并必须在失去重要关系前完成真正的和解与改变${suffix}`,
        protagonistDesire: `主角愿望${suffix}`,
        coreConflict: `核心冲突${suffix}`,
        emotionalTone: `情绪基调${suffix}`,
        ending: `故事结局${suffix}`,
        genre: '现代'
    }
}

describe('personal story directions', () => {
    it('accepts three complete directions in the required order', () => {
        const raw = JSON.stringify({
            directions: [direction('真实克制', '一'), direction('强冲突短剧', '二'), direction('平行人生幻想', '三')]
        })
        expect(parsePersonalStoryDirections(raw)).toHaveLength(3)
    })

    it('changes all candidate modes when the user chooses a hard reality level', () => {
        expect(resolvePersonalStoryModes('戏剧增强')).toEqual(['强冲突短剧', '反转成长', '情感悬疑'])
    })

    it('rejects the previous one-direction response shape', () => {
        expect(parsePersonalStoryDirections(JSON.stringify({ directions: [direction('真实克制', '一')] }))).toBeNull()
    })

    it('rejects missing fields and restores the required mode order', () => {
        const missingField = direction('真实克制', '一')
        missingField.ending = ''
        expect(
            parsePersonalStoryDirections(
                JSON.stringify({
                    directions: [missingField, direction('强冲突短剧', '二'), direction('平行人生幻想', '三')]
                })
            )
        ).toBeNull()

        const reordered = parsePersonalStoryDirections(
            JSON.stringify({
                directions: [direction('强冲突短剧', '一'), direction('真实克制', '二'), direction('平行人生幻想', '三')]
            })
        )
        expect(reordered?.map(item => item.mode)).toEqual(['真实克制', '强冲突短剧', '平行人生幻想'])
    })

    it('normalizes unsupported genres and rejects duplicate directions', () => {
        const unsupported = direction('平行人生幻想', '三')
        unsupported.genre = '纪录片'
        const normalized = parsePersonalStoryDirections(
            JSON.stringify({
                directions: [direction('真实克制', '一'), direction('强冲突短剧', '二'), unsupported]
            })
        )
        expect(normalized?.[2].genre).toBe('剧情')

        const duplicate = direction('强冲突短剧', '一')
        expect(
            parsePersonalStoryDirections(
                JSON.stringify({
                    directions: [direction('真实克制', '一'), duplicate, direction('平行人生幻想', '三')]
                })
            )
        ).toBeNull()
    })
})
