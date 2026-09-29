import { createHash } from 'node:crypto'

type ScriptEpisode = {
    episodeNumber: number
    script: string | null
}

function extractionScripts(episodes: ScriptEpisode[]) {
    return episodes
        .filter((episode): episode is ScriptEpisode & { script: string } => typeof episode.script === 'string' && episode.script.trim().length > 0)
        .map(episode => ({ episodeNumber: episode.episodeNumber, script: episode.script }))
}

export function extractionActiveKey(projectId: string, episodes: ScriptEpisode[], visualStyleProfile: unknown) {
    const withScripts = extractionScripts(episodes)
    const fingerprint = createHash('sha256').update(JSON.stringify({ withScripts, visualStyleProfile })).digest('hex')
    return { activeKey: `extract:${projectId}:${fingerprint}`, withScripts }
}
