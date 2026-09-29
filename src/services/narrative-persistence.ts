import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { genId } from '@/lib/id'
import { CONTENT_CONTRACT_VERSION, type ContractIssue } from '@/lib/content-contracts'
import { markFollowingEpisodesStaleInTransaction } from './content-lineage'
import { mergeObservedFacts, type ObservedEpisodeFacts } from './narrative-facts'
import { finishEpisodeDownstreamReset, resetEpisodeDownstreamInTransaction } from './episode-downstream-reset'
import type { NarrativeQualityScores } from './narrative-review'
import type { EpisodeScenePlan } from '@/lib/screenplay-plan'

export async function saveReviewedNarrative(params: {
    episode: { id: bigint; projectId: bigint; sourceVersion: number; operationVersion: number }
    stage: 'chapter' | 'script'
    content: string
    facts: ObservedEpisodeFacts
    quality?: NarrativeQualityScores | null
    issues?: ContractIssue[]
    adaptation?: { title: string; synopsis: string; scenePlan?: EpisodeScenePlan[] }
    settleUsage?: (tx: Prisma.TransactionClient) => Promise<unknown>
}) {
    const issues = params.issues ?? []
    const saved = await prisma.$transaction(
        async tx => {
            await tx.$queryRaw`SELECT id FROM projects WHERE id = ${params.episode.projectId} FOR UPDATE`
            await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${params.episode.id} FOR UPDATE`
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
            await tx.qualityReview.create({
                data: {
                    id: genId(),
                    projectId: current.projectId,
                    episodeId: current.id,
                    scope: params.stage,
                    reviewer: CONTENT_CONTRACT_VERSION,
                    status: issues.length > 0 ? 'needs_review' : 'passed',
                    score: params.quality?.overall ?? 100,
                    issueCount: issues.length,
                    blockerCount: 0,
                    issues: issues as unknown as Prisma.InputJsonValue,
                    redoPlan: {
                        reviewedSourceHash: params.facts.sourceHash,
                        eventCount: params.facts.events.length,
                        semanticReview: true,
                        lengthWarning: issues.some(issue => issue.code === 'too_short'),
                        ...(params.quality ? { quality: params.quality } : {})
                    } as unknown as Prisma.InputJsonValue
                }
            })
            return { updated, reset }
        },
        { timeout: 60_000 }
    )
    await finishEpisodeDownstreamReset(saved.reset)
    return saved.updated
}
