import { describe, expect, it } from 'vitest'
import { generatePersonalStoryDirections } from './llm'

describe.skipIf(process.env.RUN_LLM_INTEGRATION !== '1')('personal story directions LLM integration', () => {
    it('returns three validated directions through the configured text model', async () => {
            const result = await generatePersonalStoryDirections({
                source: '梦想与遗憾',
                moment: '虚构人物小林在学校天文台错过了一场只出现几分钟的流星雨。',
                desire: '他想完成一张能让大家重新关注旧天文台的摄影作品。',
                change: '多年后，他终于明白珍贵的不只是照片，也是共同等待的人。',
                realityLevel: '戏剧增强'
            })

        expect(result).toHaveLength(3)
        expect(result.map(direction => direction.mode)).toEqual(['强冲突短剧', '反转成长', '情感悬疑'])
    }, 170_000)
})
