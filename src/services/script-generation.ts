import { generateEpisodeScript, correctEpisodeScript, planEpisodeScenes } from './llm'
import { validateScriptContract } from '@/lib/content-contracts'
import { getEpisodeFormatSpec } from '@/lib/novel'
import { reviewNarrativeContent } from './narrative-review'

export async function generateReviewedScript(params: Parameters<typeof generateEpisodeScript>[0] & { allowedCharacterNames: string[] }) {
    const setup = params.setup ?? {}
    const scenePlan = await planEpisodeScenes(params)
    let result = await generateEpisodeScript({ ...params, scenePlan })
    const validate = () =>
        validateScriptContract({
            ...result,
            spec: getEpisodeFormatSpec(setup.episodeFormat),
            allowedCharacterNames: params.allowedCharacterNames,
            referenceOnlyCharacterNames: params.referenceOnlyCharacterNames,
            outOfScopeCharacterNames: params.outOfScopeCharacterNames
        })
    const review = () =>
        reviewNarrativeContent({
            stage: 'script',
            episodeNumber: params.chapterNumber,
            content: result.script,
            source: params.chapterContent,
            setup,
            statePlan: setup.episodeStatePlan?.find(state => state.episodeNumber === params.chapterNumber),
            previousEnding: params.previousEpisode?.script?.slice(-1800),
            model: params.model
        })
    let issues = validate()
    let reviewed = issues.length ? null : await review()
    issues.push(...(reviewed?.issues ?? []))
    if (issues.length) {
        result = await correctEpisodeScript({
            ...params,
            scenePlan,
            current: result,
            chapterSynopsis: params.chapterSynopsis,
            chapterTitle: params.chapterTitle,
            issues
        })
        issues = validate()
        reviewed = issues.length ? null : await review()
        issues.push(...(reviewed?.issues ?? []))
    }
    if (issues.length || !reviewed) throw new Error(`剧本质量检查未通过：${issues.map(issue => issue.message).join('；')}`)
    return { ...result, scenePlan, facts: reviewed.facts, quality: reviewed.quality }
}
