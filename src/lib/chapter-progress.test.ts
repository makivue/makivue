import { describe, expect, it } from 'vitest'
import { getChapterProgress, getMissingChapterOutlineNumbers, isScriptGenerated } from './chapter-progress'

describe('chapter workflow progress', () => {
    it('allows a complete outline to open drafting before any chapter text exists', () => {
        const episodes = Array.from({ length: 12 }, (_, index) => ({ episodeNumber: index + 1, synopsis: '本章大纲', status: 'outlined', chapterContent: null }))
        expect(getMissingChapterOutlineNumbers(episodes, 12)).toEqual([])
        expect(getChapterProgress(episodes).generated).toBe(0)
    })

    it('requires every planned chapter outline, including missing rows and blank synopses', () => {
        expect(
            getMissingChapterOutlineNumbers(
                [
                    { episodeNumber: 1, synopsis: '第一章' },
                    { episodeNumber: 3, synopsis: '  ' }
                ],
                3
            )
        ).toEqual([2, 3])
        expect(
            getMissingChapterOutlineNumbers(
                [
                    { episodeNumber: 1, synopsis: '第一章' },
                    { episodeNumber: 1, synopsis: '重复章节' }
                ],
                2
            )
        ).toEqual([2])
        expect(getMissingChapterOutlineNumbers([], 2)).toEqual([1, 2])
    })

    it('counts generated text from lazy summaries without requiring an adapted script', () => {
        const progress = getChapterProgress(Array.from({ length: 12 }, () => ({ status: 'drafted', hasChapterContent: true, chapterContent: null })))
        expect(progress).toEqual({ total: 12, generated: 12, finalized: 0, missing: 0, allFinalized: false })
    })

    it('requires missing text before the remaining chapters can be finalized', () => {
        const progress = getChapterProgress([
            { status: 'drafted', chapterContent: '正文' },
            { status: 'outlined', chapterContent: '  ' },
            { status: 'finalized', hasChapterContent: true }
        ])
        expect(progress).toEqual({ total: 3, generated: 2, finalized: 1, missing: 1, allFinalized: false })
    })

    it('allows adapted and storyboarded episodes to continue without repeating finalization', () => {
        const progress = getChapterProgress(['finalized', 'scripted', 'storyboarded'].map(status => ({ status, hasChapterContent: true })))
        expect(progress).toEqual({ total: 3, generated: 3, finalized: 3, missing: 0, allFinalized: true })
    })

    it.each(['scripting', 'scripted', 'storyboarding', 'storyboarded', 'generating', 'completed'])('retains 12 completed chapters after advancing to %s, even with legacy summary flags', status => {
        const episodes = Array.from({ length: 12 }, () => ({ status, chapterContent: null, hasChapterContent: false }))

        expect(getChapterProgress(episodes)).toEqual({ total: 12, generated: 12, finalized: 12, missing: 0, allFinalized: true })
        expect(isScriptGenerated(status)).toBe(status !== 'scripting')
    })

    it('keeps genuinely missing chapters separate from episodes already in production', () => {
        const episodes = [
            { status: 'completed', hasChapterContent: false },
            { status: 'generating', hasChapterContent: false },
            { status: 'drafted', hasChapterContent: true },
            { status: 'outlined', chapterContent: null },
            { status: 'drafting', chapterContent: null },
            { status: 'draft', chapterContent: ' ' }
        ]

        expect(getChapterProgress(episodes)).toEqual({ total: 6, generated: 3, finalized: 2, missing: 3, allFinalized: false })
    })

    it('keeps the workflow on review when any chapter is not finalized', () => {
        expect(
            getChapterProgress([
                { status: 'finalized', hasChapterContent: true },
                { status: 'drafted', hasChapterContent: true }
            ]).allFinalized
        ).toBe(false)
        expect(getChapterProgress([]).allFinalized).toBe(false)
    })
})
