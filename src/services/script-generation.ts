import { generateEpisodeScript, planEpisodeScenes } from './llm'
import { createNarrativeSnapshot } from './narrative-facts'

export async function generateBasicScript(params: Parameters<typeof generateEpisodeScript>[0] & { allowedCharacterNames: string[] }) {
    const scenePlan = await planEpisodeScenes(params)
    const result = await generateEpisodeScript({ ...params, scenePlan })
    if (typeof result.script !== 'string' || !result.script.trim()) throw new Error('模型未返回剧本正文，请手动重试')
    return { ...result, scenePlan, facts: createNarrativeSnapshot(result.script, params.chapterNumber, 'script') }
}
