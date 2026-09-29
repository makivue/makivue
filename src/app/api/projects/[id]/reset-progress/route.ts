import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { cancelProjectOperationsInTransaction } from '@/lib/operation-cancellation'
import { issueDestructiveOperationToken, verifyDestructiveOperationToken } from '@/lib/destructive-operation-token'
import { Prisma } from '@/generated/prisma/client'
import { parseNovelSetup, stringifyNovelSetup } from '@/lib/novel'
import { supersedeEpisodeStoryboardDataInTransaction } from '@/services/episode-storyboard-replacement'
import { finishEpisodeDownstreamReset } from '@/services/episode-downstream-reset'
import type { EpisodeArtifact } from '@/services/artifacts'
import { clearProjectExtractedEntitiesInTransaction } from '@/services/extracted-entities'
import { compiledNovelResetPatch } from '@/lib/compiled-novel-reset'

type Params = { params: Promise<{ id: string }> }

// 保留项目设定，清空旧大纲及全部下游内容；新分集使用新 ID，阻止旧任务回写。
export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(idNum, userId)
    if (guard) return guard
    const project = await prisma.project.findFirst({
        where: { id: idNum, deletedAt: null },
        include: {
            episodes: {
                where: { deletedAt: null },
                include: { storyboards: { where: { deletedAt: null }, select: { id: true } } }
            }
        }
    })
    if (!project) return apiError('Project not found', 404)

    const body = (await req.json().catch(() => ({}))) as { confirmationToken?: unknown }
    const confirmationToken = typeof body.confirmationToken === 'string' ? body.confirmationToken : ''
    const confirmationScope = 'outline-reset'
    if (!verifyDestructiveOperationToken(confirmationToken, { projectId: project.id, operationVersion: project.operationVersion, scope: confirmationScope })) {
        if (confirmationToken) return apiError('项目进度已变化或确认已过期，请刷新后重新确认重置', 409)
        return apiResponse({
            confirmationRequired: true,
            confirmationToken: issueDestructiveOperationToken({ projectId: project.id, operationVersion: project.operationVersion, scope: confirmationScope }),
            operationVersion: project.operationVersion,
            message: '该操作会清空正文、剧本、角色、场景、分镜和媒体资产，需要二次确认',
            impact: {
                episodes: project.episodes.length,
                storyboards: project.episodes.reduce((sum, episode) => sum + episode.storyboards.length, 0),
                chapters: project.episodes.filter(episode => Boolean(episode.chapterContent)).length,
                scripts: project.episodes.filter(episode => Boolean(episode.script)).length
            }
        })
    }

    const totalEpisodes = project.totalEpisodes ?? 1
    const auditMetadata = {
        operationVersion: project.operationVersion,
        episodes: project.episodes.map(episode => ({
            id: episode.id.toString(),
            episodeNumber: episode.episodeNumber,
            status: episode.status,
            hadSynopsis: Boolean(episode.synopsis),
            hadChapterContent: Boolean(episode.chapterContent),
            hadScript: Boolean(episode.script),
            storyboardIds: episode.storyboards.map(storyboard => storyboard.id.toString())
        }))
    }
    const result = await prisma.$transaction(
        async tx => {
            await tx.$queryRaw`SELECT id FROM projects WHERE id = ${idNum} FOR UPDATE`
            const locked = await tx.project.findUnique({ where: { id: idNum }, select: { operationVersion: true, deletedAt: true, novelSetup: true } })
            if (!locked || locked.deletedAt || locked.operationVersion !== project.operationVersion) return null
            const { epJobIds } = await cancelProjectOperationsInTransaction(tx, idNum, '项目进度已重置，旧任务作废')
            // Include archived episode rows: (projectId, episodeNumber) is unique
            // even when deletedAt is set, and their child rows still hold FKs.
            const episodeIds = (await tx.episode.findMany({ where: { projectId: idNum }, select: { id: true } })).map(episode => episode.id)
            const artifacts: EpisodeArtifact[] = []
            for (const episodeId of episodeIds) {
                await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${episodeId} FOR UPDATE`
                const reset = await supersedeEpisodeStoryboardDataInTransaction(tx, episodeId, '重新生成大纲，旧分集内容已重置')
                artifacts.push(...reset.artifacts)
                epJobIds.push(...reset.epJobIds)
            }
            // Earlier regenerations leave tombstones for callback protection.
            // Include those rows before deleting their parent episodes as well.
            const allStoryboards = episodeIds.length ? await tx.storyboard.findMany({ where: { episodeId: { in: episodeIds } }, select: { id: true } }) : []
            const storyboardIds = allStoryboards.map(storyboard => storyboard.id)
            await tx.characterStateEvent.updateMany({ where: { projectId: idNum, status: 'active', sourceType: 'storyboard_plan' }, data: { status: 'superseded' } })
            if (storyboardIds.length > 0) {
                await tx.qualityReview.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.productionEvent.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.generation.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.storyboardCharacter.deleteMany({ where: { storyboardId: { in: storyboardIds } } })
                await tx.storyboard.deleteMany({ where: { id: { in: storyboardIds } } })
            }

            if (episodeIds.length > 0) {
                await tx.qualityReview.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.productionEvent.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.batchJob.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.chapterJob.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.scriptJob.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.storyboardJob.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.epJob.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.videoMerge.deleteMany({ where: { episodeId: { in: episodeIds } } })
                await tx.episode.deleteMany({ where: { id: { in: episodeIds } } })
            }

            await tx.extractJob.deleteMany({ where: { projectId: idNum } })
            const cleared = await clearProjectExtractedEntitiesInTransaction(tx, idNum)

            await tx.episode.createMany({
                data: Array.from({ length: totalEpisodes }, (_, index) => ({
                    id: genId(),
                    projectId: project.id,
                    episodeNumber: index + 1,
                    status: 'outlined'
                }))
            })

            await tx.project.update({
                where: { id: idNum },
                data: {
                    ...compiledNovelResetPatch(project),
                    novelStage: 'outlined',
                    status: 'in_production',
                    sourceVersion: { increment: 1 },
                    contentFacts: Prisma.DbNull,
                    staleScopes: Prisma.DbNull,
                    novelSetup: stringifyNovelSetup({ ...parseNovelSetup(locked.novelSetup), episodeStatePlan: [], factLedger: [] })
                }
            })
            await tx.productionEvent.create({
                data: {
                    id: genId(),
                    eventKey: `outline-reset:${project.id}:${project.operationVersion}`,
                    projectId: project.id,
                    eventType: 'destructive_outline_reset',
                    stage: 'storyboard',
                    status: 'completed',
                    metadata: auditMetadata as unknown as Prisma.InputJsonValue
                }
            })
            return { episodeIds, storyboardIds, epJobIds, artifacts, ...cleared }
        },
        { timeout: 60_000 }
    )

    if (!result) return apiError('项目进度已变化，请刷新后重新确认重置', 409)
    await finishEpisodeDownstreamReset(result)

    return apiResponse({
        episodes: result.episodeIds.length,
        storyboards: result.storyboardIds.length,
        characters: result.removedCharacters,
        scenes: result.removedScenes
    })
}
