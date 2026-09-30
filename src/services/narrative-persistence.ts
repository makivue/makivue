import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { EpisodeScenePlan } from '@/lib/screenplay-plan'
import { markFollowingEpisodesStaleInTransaction } from './content-lineage'
import { finishEpisodeDownstreamReset, resetEpisodeDownstreamInTransaction } from './episode-downstream-reset'
import { mergeObservedFacts, type ObservedEpisodeFacts } from './narrative-facts'

export async function saveGeneratedNarrative(params: {
    episode: { id: bigint; projectId: bigint; sourceVersion: number; operationVersion: number }
    stage: 'chapter' | 'script'
    content: string
    facts: ObservedEpisodeFacts
    adaptation?: { title: string; synopsis: string; scenePlan?: EpisodeScenePlan[] }
    settleUsage?: (tx: Prisma.TransactionClient) => Promise<unknown>
}) {
    const saved = await prisma.$transaction(
        async tx => {
            const current = await tx.episode.findUnique({ where: { id: params.episode.id } })
            if (!current || current.deletedAt || current.sourceVersion !== params.episode.sourceVersion || current.operationVersion !== params.episode.operationVersion) {
                throw new Error('生成期间内容已修改，本次结果未覆盖新版本，请基于最新内容重试')
            }
            await params.settleUsage?.(tx)
            const reset = await resetEpisodeDownstreamInTransaction(tx, current, params.stage)
            const changed = (params.stage === 'chapter' ? current.chapterContent : current.script) !== params.content
            if (changed) {
                await markFollowingEpisodesStaleInTransaction(tx, current.projectId, current.episodeNumber, params.stage)
            }
            const updated = await tx.episode.update({
                where: { id: current.id },
                data: {
                    ...reset.patch,
                    ...(params.stage === 'chapter' ? { chapterContent: params.content, status: 'drafted' } : { script: params.content, status: 'scripted' }),
                    // Titles and synopses are the source outline, never the adaptation's summary.
                    contentFacts: mergeObservedFacts(
                        reset.patch.contentFacts,
                        params.stage,
                        { ...params.facts, sourceVersion: current.sourceVersion + 1 },
                        params.adaptation
                    ) as unknown as Prisma.InputJsonValue,
                    sourceVersion: { increment: 1 },
                    operationVersion: { increment: 1 },
                    staleReason: null
                }
            })
            return { updated, reset }
        },
        { timeout: 60_000 }
    )
    await finishEpisodeDownstreamReset(saved.reset)
    return saved.updated
}
