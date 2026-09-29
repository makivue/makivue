import { describe, expect, it } from 'vitest'
import { findMissingOutlineChapterNumbers, MIN_OUTLINE_SYNOPSIS_LENGTH, selectUsableOutlineChapters } from './outline-validation'

function chapter(chapterNumber: number | string, synopsis = '具'.repeat(MIN_OUTLINE_SYNOPSIS_LENGTH)) {
    return {
        chapterNumber: chapterNumber as number,
        title: `第${chapterNumber}章标题`,
        synopsis,
        intensity: 5,
        coldOpen: '主角刚进办公室，警报突然响起',
        protagonistGoal: '在下班前找回丢失的证据',
        primaryObstacle: '对手封锁系统并逼近办公室',
        escalation: '备用权限也被撤销，旧办法彻底失效',
        irreversibleChoice: '主角公开自己的秘密换取访问权限',
        cost: '主角失去同事信任',
        reversal: '证据其实由最信任的同事提前转移',
        informationGain: '主角得知泄密者就在项目组内',
        cliffhanger: '办公室门打开，泄密者的影子落在桌上',
        setupPayoffs: ['推进：失踪的门禁卡'],
        openingState: '办公室清晨，主角站在窗边',
        endingState: '夜色中主角握紧证据',
        characterStateChanges: '主角从犹疑变为坚定',
        continuityBridge: '用手机亮屏承接下一章',
        requiredEvents: ['警报响起', '主角寻找证据', '泄密者出现']
    }
}

describe('outline chapter validation', () => {
    it('accepts complete chapters and normalizes numeric chapter numbers', () => {
        const selected = selectUsableOutlineChapters([chapter('5')], [5])
        expect(selected).toHaveLength(1)
        expect(selected[0].chapterNumber).toBe(5)
    })

    it('treats empty and too-short synopses as missing', () => {
        const selected = selectUsableOutlineChapters([chapter(4), chapter(5, ''), chapter(6, '短')], [4, 5, 6])
        expect(selected.map(item => item.chapterNumber)).toEqual([4])
        expect(findMissingOutlineChapterNumbers([4, 5, 6], selected)).toEqual([5, 6])
    })

    it('drops duplicate and out-of-range chapters', () => {
        const selected = selectUsableOutlineChapters([chapter(5), chapter(5), chapter(99)], [5, 6])
        expect(selected.map(item => item.chapterNumber)).toEqual([5])
    })

    it('rejects chapters with incomplete continuity fields', () => {
        const invalid = { ...chapter(5), endingState: '' }
        expect(selectUsableOutlineChapters([invalid], [5])).toEqual([])
    })

    it('rejects placeholder dramatic beats before persisting a partial batch', () => {
        expect(selectUsableOutlineChapters([{ ...chapter(5), reversal: '反转', setupPayoffs: ['   '] }], [5])).toEqual([])
    })
})
