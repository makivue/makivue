import type { NovelEpisodeStatePlan } from './novel'

export const CONTENT_CONTRACT_VERSION = 'content-contracts/v8@2026-09-29'

export interface ContractIssue {
    path: string
    code: string
    message: string
}

export interface OutlineContractChapter extends Omit<NovelEpisodeStatePlan, 'episodeNumber'> {
    chapterNumber: number
    title: string
    synopsis: string
    intensity?: number
}

export function countContentUnits(text: string | null | undefined): number {
    const value = text?.trim() ?? ''
    const cjk = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
    const latinWords = (value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length
    return cjk + latinWords
}

export function getChapterMinimumUnits(targetWords: number): number {
    return Math.round(targetWords * 0.85)
}

function requiredText(value: unknown, path: string, issues: ContractIssue[], minLength = 1) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length < minLength) issues.push({ path, code: 'required', message: `${path} 不能为空` })
}
/** Basic shape and completeness checks; narrative quality is reviewed manually. */
export function validateOutlineContract(chapters: OutlineContractChapter[] | null | undefined, requestedNumbers: number[]): ContractIssue[] {
    const issues: ContractIssue[] = []
    if (!Array.isArray(chapters)) return [{ path: 'chapters', code: 'required', message: '章节列表不能为空' }]
    const allowed = new Set(requestedNumbers)
    const seen = new Set<number>()
    for (const [index, chapter] of chapters.entries()) {
        const base = 'chapters[' + index + ']'
        const number = Number(chapter?.chapterNumber)
        if (!chapter || typeof chapter !== 'object') {
            issues.push({ path: base, code: 'required', message: '章节必须是对象' })
            continue
        }
        if (!Number.isInteger(number) || !allowed.has(number)) issues.push({ path: base + '.chapterNumber', code: 'range', message: '章节号不在本批请求范围内' })
        if (seen.has(number)) issues.push({ path: base + '.chapterNumber', code: 'duplicate', message: '章节号重复' })
        seen.add(number)
        requiredText(chapter.title, base + '.title', issues)
        requiredText(chapter.synopsis, base + '.synopsis', issues)
    }
    for (const number of requestedNumbers) if (!seen.has(number)) issues.push({ path: 'chapters', code: 'missing_chapter', message: '缺少第 ' + number + ' 章' })
    return issues
}

export interface EpisodeFactSnapshot {
    episodeNumber: number
    summary: string
    openingState: string
    endingState: string
    characterStateChanges: string
    continuityBridge: string
    sourceVersion: number
    kind?: 'planned' | 'observed'
    events?: Array<{ description: string; evidence: string }>
}

export function buildEpisodeFactSnapshot(params: { episodeNumber: number; synopsis?: string | null; statePlan?: NovelEpisodeStatePlan | null; sourceVersion?: number }): EpisodeFactSnapshot {
    return {
        kind: 'planned',
        episodeNumber: params.episodeNumber,
        summary: params.synopsis?.trim() ?? '',
        openingState: params.statePlan?.openingState?.trim() ?? '',
        endingState: params.statePlan?.endingState?.trim() ?? '',
        characterStateChanges: params.statePlan?.characterStateChanges?.trim() ?? '',
        continuityBridge: params.statePlan?.continuityBridge?.trim() ?? '',
        sourceVersion: params.sourceVersion ?? 1
    }
}
