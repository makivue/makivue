import type { EpisodeFactSnapshot } from '@/lib/content-contracts'
import type { NovelSetup } from '@/lib/novel'
import type { EpisodeScenePlan } from '@/lib/screenplay-plan'
import { createHash } from 'node:crypto'

export interface ObservedEpisodeFacts extends EpisodeFactSnapshot {
    kind: 'observed'
    sourceStage: 'chapter' | 'script'
    sourceHash: string
    events: Array<{ description: string; evidence: string }>
}

type EpisodeFactsInput = {
    episodeNumber: number
    chapterContent?: string | null
    script?: string | null
    contentFacts?: unknown
    staleReason?: string | null
}

export function narrativeContentHash(content: string) {
    return createHash('sha256').update(content.trim()).digest('hex')
}

export function factRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function readObservedFacts(episode: EpisodeFactsInput, stage: 'chapter' | 'script'): ObservedEpisodeFacts | null {
    const candidate = factRecord(factRecord(episode.contentFacts)[stage])
    const content = stage === 'chapter' ? episode.chapterContent : episode.script
    if (!content || candidate.kind !== 'observed' || candidate.sourceStage !== stage || candidate.sourceHash !== narrativeContentHash(content)) return null
    if (!Array.isArray(candidate.events) || typeof candidate.summary !== 'string' || typeof candidate.endingState !== 'string') return null
    return candidate as unknown as ObservedEpisodeFacts
}

/** Future episode plans never become historical facts merely because they were outlined. */
export function setupWithObservedFacts(setup: NovelSetup, episodes: EpisodeFactsInput[], currentEpisodeNumber: number, stage: 'chapter' | 'script' = 'chapter'): NovelSetup {
    const factLedger = episodes
        .filter(episode => episode.episodeNumber < currentEpisodeNumber && !episode.staleReason)
        .map(episode =>
            stage === 'script' && !factRecord(episode.contentFacts).scriptInvalidated
                ? (readObservedFacts(episode, 'script') ?? readObservedFacts(episode, 'chapter'))
                : readObservedFacts(episode, 'chapter')
        )
        .filter((facts): facts is ObservedEpisodeFacts => !!facts)
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
    return { ...setup, factLedger }
}

export function mergeObservedFacts(current: unknown, stage: 'chapter' | 'script', facts: ObservedEpisodeFacts, adaptation?: { title: string; synopsis: string; scenePlan?: EpisodeScenePlan[] }) {
    const previous = factRecord(current)
    return {
        ...previous,
        // Preserve the detailed outline separately from summaries of later stages.
        [stage]: facts,
        ...(stage === 'chapter' ? { script: null, scriptInvalidated: true } : { scriptInvalidated: false }),
        ...(adaptation ? { adaptation } : {})
    }
}

/** Store a source excerpt for later context without scoring or reviewing its content. */
export function createNarrativeSnapshot(content: string, episodeNumber: number, sourceStage: 'chapter' | 'script'): ObservedEpisodeFacts {
    return {
        kind: 'observed',
        sourceStage,
        sourceHash: narrativeContentHash(content),
        episodeNumber,
        summary: content.trim().slice(0, 1200),
        openingState: '',
        endingState: '',
        characterStateChanges: '',
        continuityBridge: '',
        sourceVersion: 1,
        events: []
    }
}
