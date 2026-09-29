import { preferChapterRepair, validateChapterContract, type ContractIssue } from '@/lib/content-contracts'
import type { NarrativeReview } from './narrative-review'
import { isRetryableLLMError } from './llm'

export interface ChapterRepairResult {
    content: string
    review: NarrativeReview
    warningIssues: ContractIssue[]
    blockingIssues: ContractIssue[]
    repairAttempts: number
}

interface RepairChapterDraftParams {
    content: string
    targetWords: number
    review: (content: string) => Promise<NarrativeReview>
    repair: (content: string, issues: ContractIssue[]) => Promise<string>
    maxLengthRepairs?: number
    maxNarrativeRepairs?: number
}

/**
 * Keeps the best existing draft while repairing it. Length alone is advisory
 * after the repair budget is exhausted; narrative conflicts remain blocking.
 */
export async function repairChapterDraft(params: RepairChapterDraftParams): Promise<ChapterRepairResult> {
    const maxLengthRepairs = params.maxLengthRepairs ?? 3
    const maxNarrativeRepairs = params.maxNarrativeRepairs ?? 1
    let content = params.content.trim()
    let repairAttempts = 0
    const repair = async (draft: string, issues: ContractIssue[]) => {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await params.repair(draft, issues)
            } catch (error) {
                if (attempt >= 1 || !isRetryableLLMError(error)) throw error
                await new Promise(resolve => setTimeout(resolve, 1000))
            }
        }
    }

    let lengthIssues = validateChapterContract({ content, targetWords: params.targetWords })
    for (let attempt = 0; lengthIssues.length > 0 && attempt < maxLengthRepairs; attempt += 1) {
        const candidate = await repair(content, lengthIssues)
        content = preferChapterRepair(content, candidate, params.targetWords)
        repairAttempts += 1
        lengthIssues = validateChapterContract({ content, targetWords: params.targetWords })
    }

    let review = await params.review(content)
    for (let attempt = 0; review.issues.length > 0 && attempt < maxNarrativeRepairs; attempt += 1) {
        const issues = [...validateChapterContract({ content, targetWords: params.targetWords }), ...review.issues]
        const candidate = (await repair(content, issues)).trim()
        // A factual correction may remove contradictory paragraphs. Review it
        // before selecting it; length must not silently restore the conflict.
        if (candidate) content = candidate
        repairAttempts += 1
        review = await params.review(content)
    }

    lengthIssues = validateChapterContract({ content, targetWords: params.targetWords })
    const blockingIssues = review.issues.length > 0 ? [...lengthIssues, ...review.issues] : []

    return {
        content,
        review,
        warningIssues: blockingIssues.length === 0 ? lengthIssues : [],
        blockingIssues,
        repairAttempts
    }
}
