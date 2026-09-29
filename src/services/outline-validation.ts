export interface OutlineChapterCandidate {
    chapterNumber: number
    title: string
    synopsis: string
    intensity?: number
    openingState?: string
    endingState?: string
    characterStateChanges?: string
    continuityBridge?: string
    requiredEvents?: string[]
    coldOpen?: string
    protagonistGoal?: string
    primaryObstacle?: string
    escalation?: string
    irreversibleChoice?: string
    cost?: string
    reversal?: string
    informationGain?: string
    cliffhanger?: string
    setupPayoffs?: string[]
}

import { countContentUnits } from '@/lib/content-contracts'

export const MIN_OUTLINE_SYNOPSIS_LENGTH = 200

export function selectUsableOutlineChapters<T extends OutlineChapterCandidate>(chapters: T[] | null | undefined, requestedChapterNumbers: number[]): T[] {
    const allowed = new Set(requestedChapterNumbers)
    const byChapterNumber = new Map<number, T>()

    for (const chapter of chapters ?? []) {
        const chapterNumber = Number(chapter?.chapterNumber)
        const title = typeof chapter?.title === 'string' ? chapter.title.trim() : ''
        const synopsis = typeof chapter?.synopsis === 'string' ? chapter.synopsis.trim() : ''
        const intensity = Number(chapter?.intensity)
        const hasContinuityContract = [chapter.openingState, chapter.endingState, chapter.characterStateChanges, chapter.continuityBridge].every(
            value => typeof value === 'string' && value.trim().length > 0
        )
        const hasDramaticContract = [
            [chapter.coldOpen, 6],
            [chapter.protagonistGoal, 6],
            [chapter.primaryObstacle, 6],
            [chapter.escalation, 6],
            [chapter.irreversibleChoice, 6],
            [chapter.cost, 4],
            [chapter.reversal, 6],
            [chapter.informationGain, 6],
            [chapter.cliffhanger, 6]
        ].every(([value, minimum]) => typeof value === 'string' && value.trim().length >= Number(minimum))
        if (
            !Number.isInteger(chapterNumber) ||
            !allowed.has(chapterNumber) ||
            !title ||
            countContentUnits(synopsis) < MIN_OUTLINE_SYNOPSIS_LENGTH ||
            !Number.isInteger(intensity) ||
            intensity < 1 ||
            intensity > 10 ||
            !hasContinuityContract ||
            !hasDramaticContract ||
            !Array.isArray(chapter.setupPayoffs) ||
            chapter.setupPayoffs.length === 0 ||
            chapter.setupPayoffs.some(item => typeof item !== 'string' || !item.trim())
        )
            continue
        if (!Array.isArray(chapter.requiredEvents) || chapter.requiredEvents.length < 3 || chapter.requiredEvents.some(event => typeof event !== 'string' || !event.trim())) continue
        if (!byChapterNumber.has(chapterNumber)) {
            byChapterNumber.set(chapterNumber, { ...chapter, chapterNumber, title, synopsis })
        }
    }

    return requestedChapterNumbers.flatMap(chapterNumber => {
        const chapter = byChapterNumber.get(chapterNumber)
        return chapter ? [chapter] : []
    })
}

export function findMissingOutlineChapterNumbers(requestedChapterNumbers: number[], chapters: Array<Pick<OutlineChapterCandidate, 'chapterNumber'>>): number[] {
    const received = new Set(chapters.map(chapter => Number(chapter.chapterNumber)))
    return requestedChapterNumbers.filter(chapterNumber => !received.has(chapterNumber))
}
