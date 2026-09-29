import { parseNovelSetup } from './novel'

/** Finalization stores a second copy of the chapters in project.novel. */
export function compiledNovelResetPatch(project: {
    novel?: string | null
    novelSetup?: string | null
    episodes: Array<{ episodeNumber: number; chapterContent?: string | null; finalizedAt?: Date | string | null }>
}): { novel?: null } {
    // Imported source material is upstream input, not a generated descendant.
    if (!project.novel || parseNovelSetup(project.novelSetup ?? null).fieldSources?.episodeStatePlan === 'derived_from_import') return {}
    if (!project.episodes.some(episode => episode.finalizedAt)) return {}
    const compiled = [...project.episodes]
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map(episode => episode.chapterContent)
        .filter(Boolean)
        .join('\n\n')
    return project.novel === compiled ? { novel: null } : {}
}
