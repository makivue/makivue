import { Prisma } from '@/generated/prisma/client'
import { abortEpJobControllers } from '@/lib/episodeJobStore'
import { deleteEpisodeArtifacts } from './artifacts'
import { factRecord } from './narrative-facts'
import { supersedeEpisodeStoryboardDataInTransaction } from './episode-storyboard-replacement'
import { clearProjectExtractedEntitiesInTransaction } from './extracted-entities'

export type NarrativeSourceStage = 'outline' | 'chapter' | 'script'

/** These fields describe only descendants; the caller writes the new source. */
export function episodeDownstreamResetPatch(stage: NarrativeSourceStage, contentFacts: unknown): Prisma.EpisodeUpdateInput {
    if (stage === 'outline') {
        return {
            chapterContent: null,
            script: null,
            videoUrl: null,
            finalizedAt: null,
            status: 'outlined',
            contentFacts: Prisma.DbNull,
            stateSnapshot: Prisma.DbNull,
            staleReason: null
        }
    }
    const facts = factRecord(contentFacts)
    return {
        ...(stage === 'chapter' ? { script: null, finalizedAt: null, status: 'drafted' } : { status: 'scripted' }),
        videoUrl: null,
        staleReason: null,
        contentFacts: {
            ...facts,
            ...(stage === 'chapter' ? { chapter: null } : {}),
            script: null,
            adaptation: null,
            scriptInvalidated: stage === 'chapter'
        } as Prisma.InputJsonValue
    }
}

/** Caller must lock the episode row and apply the returned patch in this transaction. */
export async function resetEpisodeDownstreamInTransaction(
    tx: Prisma.TransactionClient,
    episode: { id: bigint; projectId: bigint; contentFacts: unknown; chapterContent?: string | null; script?: string | null },
    stage: NarrativeSourceStage
) {
    const reason = `${stage === 'outline' ? '大纲' : stage === 'chapter' ? '正文' : '剧本'}已更新，旧下游内容已重置，请重新生成`
    const where = { episodeId: episode.id, phase: { in: ['queued', 'running', 'generating', 'writing_db', 'processing'] } }
    const cancelled = { phase: 'error', activeKey: null, leaseOwner: null, leaseExpiresAt: null, error: reason }
    if (stage === 'outline') await tx.chapterJob.updateMany({ where, data: cancelled })
    if (stage !== 'script') await tx.scriptJob.updateMany({ where, data: cancelled })
    await tx.storyboardJob.updateMany({ where, data: cancelled })

    const replacement = await supersedeEpisodeStoryboardDataInTransaction(tx, episode.id, reason)
    // Extraction combines all episode scripts. A regenerated source invalidates
    // the shared characters/scenes and their references as well as episode media.
    await tx.extractJob.deleteMany({ where: { projectId: episode.projectId } })
    if ((stage === 'script' ? episode.script : episode.chapterContent) || (stage === 'outline' && episode.script)) {
        await clearProjectExtractedEntitiesInTransaction(tx, episode.projectId)
    }
    if (stage !== 'script') {
        await tx.qualityReview.deleteMany({ where: { episodeId: episode.id, scope: { in: stage === 'outline' ? ['chapter', 'script'] : ['script'] } } })
    }
    await tx.project.update({
        where: { id: episode.projectId },
        data: { status: 'in_production', ...(stage === 'outline' ? { novelStage: 'outlined' } : stage === 'chapter' ? { novelStage: 'drafting' } : {}) }
    })
    return { ...replacement, patch: episodeDownstreamResetPatch(stage, episode.contentFacts) }
}

export async function finishEpisodeDownstreamReset(reset: Pick<Awaited<ReturnType<typeof resetEpisodeDownstreamInTransaction>>, 'epJobIds' | 'artifacts'>) {
    abortEpJobControllers(reset.epJobIds)
    // Database detachment is already committed; storage cleanup must never
    // turn a successful content save into a reported generation failure.
    if (reset.artifacts.length) await deleteEpisodeArtifacts(reset.artifacts)
}
