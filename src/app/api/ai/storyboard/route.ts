import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { abortEpJobControllers } from '@/lib/episodeJobStore'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { genId } from '@/lib/id'
import { getEpisodeFormatSpec, parseNovelSetup } from '@/lib/novel'
import { assertEpisodeOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { DEFAULT_VIDEO_PROVIDER, getVideoProviderCapability, isAvailableProductionVideoProvider, type ProductionVideoProvider } from '@/lib/provider-capabilities'
import { buildStoryboardAudioPlan } from '@/lib/storyboard-audio-plan'
import { resolveStoryboardEntityLinks } from '@/lib/storyboard-entity-resolution'
import { resolveStoryboardGenerationMode } from '@/lib/storyboard-generation-request'
import { cancelRunningJobs, createJob, updateJob } from '@/lib/storyboardJobStore'
import { startTextJobHeartbeat } from '@/lib/text-job-lease'
import { apiError, apiErrorWithDetails, apiResponse } from '@/lib/utils'
import { deleteEpisodeArtifacts } from '@/services/artifacts'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { EPISODE_STORYBOARD_REPLACED_REASON, supersedeEpisodeStoryboardDataInTransaction } from '@/services/episode-storyboard-replacement'
import { generateStoryboards } from '@/services/llm'
import { factRecord } from '@/services/narrative-facts'
import { after, NextRequest } from 'next/server'

// AI 生成分镜：立即返回 jobId，后台调用 LLM + 写库，前端轮询 /api/ai/storyboard/status/[jobId]
// 之前是同步版本，长剧本会在网关层触发 upstream request timeout（60s）。
const DEFAULT_SCRIPT_MODEL = GEMINI_FLASH_TEXT_MODEL_ID
export const maxDuration = 2100

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { episodeId: rawEpisodeId, videoProvider: rawVideoProvider, generationMode: rawGenerationMode, overwriteExisting: rawOverwriteExisting } = await req.json()
    if (!rawEpisodeId) return apiError('episodeId required')
    const episodeId = parseApiId(rawEpisodeId)
    if (episodeId === null) return apiError('剧集 ID 格式无效')
    if (rawVideoProvider !== undefined && !isAvailableProductionVideoProvider(rawVideoProvider)) return apiError('不支持的视频模型')
    const configuredVideoProvider = rawVideoProvider === undefined ? await prisma.aiServiceConfig.findUnique({ where: { provider: 'video' }, select: { modelName: true } }) : null
    const videoProvider: ProductionVideoProvider = isAvailableProductionVideoProvider(rawVideoProvider)
        ? rawVideoProvider
        : isAvailableProductionVideoProvider(configuredVideoProvider?.modelName)
          ? configuredVideoProvider.modelName
          : DEFAULT_VIDEO_PROVIDER
    const generationMode = resolveStoryboardGenerationMode(rawGenerationMode, rawOverwriteExisting)
    if (!generationMode) return apiError('generationMode 与 overwriteExisting 参数不一致，请刷新页面后重试')
    const overwriteExisting = generationMode === 'overwrite'
    const guard = await assertEpisodeOwner(episodeId, userId)
    if (guard) return guard

    const episode = await prisma.episode.findFirst({
        where: { id: episodeId, deletedAt: null },
        include: {
            project: { include: { characters: { where: { deletedAt: null } }, scenes: { where: { deletedAt: null } } } },
            _count: { select: { storyboards: { where: { deletedAt: null } } } }
        }
    })
    if (!episode) return apiError('Episode not found', 404)
    if (!episode.script?.trim()) return apiError('Script not ready')
    if (factRecord(episode.contentFacts).scriptInvalidated) return apiError('正文已变更，请先重新改编本集剧本，再生成分镜', 409)
    if (episode.status === 'storyboarding') {
        return apiErrorWithDetails('本集已有分镜任务正在执行，请勿重复提交。', 409, {
            code: 'STORYBOARD_JOB_ALREADY_RUNNING'
        })
    }
    if (episode._count.storyboards > 0 && !overwriteExisting) {
        // 历史任务或人工加镜头可能已经有真实分镜，但 episode.status 仍停在
        // scripted。以未删除分镜为事实来源顺手修复，避免侧栏永远显示“未分镜”。
        if (episode.status !== 'storyboarded') {
            await prisma.episode.update({ where: { id: episodeId }, data: { status: 'storyboarded' } })
        }
        return apiErrorWithDetails('本集已有分镜，已安全跳过，原分镜未被覆盖。', 409, {
            code: 'STORYBOARDS_ALREADY_EXIST',
            storyboardCount: episode._count.storyboards,
            generationMode
        })
    }
    const billingInput = {
        script: episode.script,
        episodeNumber: episode.episodeNumber,
        synopsis: episode.synopsis,
        characters: episode.project?.characters.map(item => item.name),
        scenes: episode.project?.scenes.map(item => item.name),
        videoProvider
    }
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, 12_000))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    // Overwrite is a true episode-level replacement. Claim the episode row,
    // cancel the old production graph, and tombstone every current storyboard
    // in one transaction so no old batch can keep writing between those steps.
    const previousStatus = overwriteExisting ? 'scripted' : (episode.status ?? 'draft')
    const claim = await prisma.$transaction(async tx => {
        const locked = await tx.episode.findUnique({
            where: { id: episodeId },
            select: { status: true, operationVersion: true, deletedAt: true }
        })
        if (!locked || locked.deletedAt || locked.status !== episode.status || locked.operationVersion !== episode.operationVersion) return null
        const replacement = overwriteExisting
            ? await supersedeEpisodeStoryboardDataInTransaction(tx, episodeId, EPISODE_STORYBOARD_REPLACED_REASON)
            : { storyboardIds: [], epJobIds: [], artifacts: [] }
        const claimed = await tx.episode.updateMany({
            where: { id: episodeId, status: episode.status, operationVersion: episode.operationVersion },
            data: { status: 'storyboarding', operationVersion: { increment: 1 } }
        })
        return claimed.count === 1 ? { operationVersion: episode.operationVersion + 1, replacement } : null
    })
    if (!claim) {
        return apiErrorWithDetails('本集状态刚刚发生变化，可能已有分镜任务启动；请刷新后再试。', 409, {
            code: 'STORYBOARD_JOB_ALREADY_RUNNING'
        })
    }
    abortEpJobControllers(claim.replacement.epJobIds)
    if (claim.replacement.artifacts.length > 0) {
        after(() => deleteEpisodeArtifacts(claim.replacement.artifacts))
    }

    let job: Awaited<ReturnType<typeof createJob>>
    try {
        job = await createJob(episode.id.toString(), episode.projectId.toString())
    } catch (error) {
        await prisma.episode.updateMany({
            where: { id: episodeId, status: 'storyboarding', operationVersion: claim.operationVersion },
            data: { status: previousStatus }
        })
        throw error
    }

    after(() =>
        withHiModelsUsageScope({ userId, jobId: job.id }, () => runStoryboardJob(job.id, episode, previousStatus, userId, billingInput, overwriteExisting, claim.operationVersion, videoProvider))
    )

    return apiResponse({ jobId: job.id, generationMode })
}

type EpisodeWithProject = NonNullable<
    Awaited<
        ReturnType<
            typeof prisma.episode.findFirst<{
                include: { project: { include: { characters: true; scenes: true } } }
            }>
        >
    >
>

async function runStoryboardJob(
    jobId: string,
    episode: EpisodeWithProject,
    previousStatus: string,
    userId: bigint,
    billingInput: Record<string, unknown>,
    overwriteExisting = false,
    operationVersion = 0,
    videoProvider: ProductionVideoProvider = DEFAULT_VIDEO_PROVIDER
) {
    const episodeId = episode.id
    const stopHeartbeat = startTextJobHeartbeat(() => updateJob(jobId, {}))
    try {
        await updateJob(jobId, { attempts: 1 })

        const modelConfig = await prisma.aiServiceConfig.findUnique({ where: { provider: 'script_model' }, select: { modelName: true } })
        const model = modelConfig?.modelName ?? DEFAULT_SCRIPT_MODEL

        const result = await generateStoryboards({
            script: episode.script!,
            characters: episode.project!.characters,
            scenes: episode.project!.scenes,
            setup: parseNovelSetup(episode.project!.novelSetup),
            episodeNumber: episode.episodeNumber,
            episodeSynopsis: episode.synopsis,
            model,
            maxShotDuration: getVideoProviderCapability(videoProvider)?.duration.max ?? 15
        })
        // LLM 生成完后检查是否已被用户取消（status 被改回非 storyboarding）
        const currentEp = await prisma.episode.findFirst({ where: { id: episodeId }, select: { status: true, operationVersion: true } })
        if (currentEp?.status !== 'storyboarding' || currentEp.operationVersion !== operationVersion) {
            await updateJob(jobId, {
                phase: 'cancelled',
                result: { episodeId: episodeId.toString(), count: 0, cancelled: true }
            })
            return
        }

        await updateJob(jobId, { phase: 'writing_db' })

        if (!overwriteExisting) {
            const storyboardCount = await prisma.storyboard.count({
                where: { episodeId, deletedAt: null }
            })
            if (storyboardCount > 0) {
                await prisma.episode.update({
                    where: { id: episodeId },
                    data: { status: 'storyboarded' }
                })
                await updateJob(jobId, {
                    phase: 'cancelled',
                    result: { episodeId: episodeId.toString(), count: 0, cancelled: true }
                })
                return
            }
        }

        const orderedStoryboards = result.storyboards
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((sb, index) => ({ ...sb, order: index + 1 }))
        // 写库前按已验证的模型时长上限做最后兜底，避免仅凭 endpoint ID
        // 推断 Seedance 版本并写入服务端并不支持的长镜头。
        const providerReadyStoryboards = orderedStoryboards
        const linkedStoryboards = providerReadyStoryboards.map(sb => {
            const links = resolveStoryboardEntityLinks(sb, {
                characters: episode.project!.characters,
                scenes: episode.project!.scenes
            })
            return {
                ...sb,
                sceneId: links.scene?.id ?? null,
                sceneName: links.scene?.name ?? null,
                characterNames: links.characters.map(character => character.name),
                resolvedCharacterIds: links.characters.map(character => character.id)
            }
        })
        const normalizedStoryboards = linkedStoryboards.map(shot => ({ ...shot, continuityMode: 'independent' as const }))
        const spec = getEpisodeFormatSpec(parseNovelSetup(episode.project!.novelSetup).episodeFormat)
        const totalDuration = normalizedStoryboards.reduce((sum, shot) => sum + (shot.duration ?? 0), 0)
        const timingWarnings =
            totalDuration < spec.minDurationSeconds || totalDuration > spec.maxDurationSeconds
                ? [`当前分镜预计 ${totalDuration} 秒，目标为 ${spec.durationDescription}。请检查对白、动作与停顿的节奏，可调整镜头后再生成视频。`]
                : []
        const preparedStoryboards = normalizedStoryboards.map(sb => {
            const id = genId()
            const sceneId = sb.sceneId ?? undefined
            const characterIds = [...new Set(sb.resolvedCharacterIds)]
            const audioPlan = buildStoryboardAudioPlan(sb)
            return {
                id,
                characterIds,
                data: {
                    id,
                    episodeId,
                    order: sb.order,
                    shotType: sb.shotType?.slice(0, 50),
                    duration: Math.max(1, Math.min(60, sb.duration ?? 10)),
                    dialogue: sb.dialogue?.slice(0, 20_000),
                    narration: sb.narration?.slice(0, 20_000),
                    actionDesc: sb.actionDesc?.slice(0, 20_000),
                    ...(sb.actionPlan ? { actionPlan: sb.actionPlan as unknown as object } : {}),
                    ...(audioPlan ? { audioPlan: audioPlan as unknown as object } : {}),
                    imagePrompt: sb.imagePrompt?.slice(0, 20_000),
                    continuityMode: sb.continuityMode,
                    sceneId,
                    polishStatus: result.polishStatus,
                    promptVersion: result.promptVersion,
                    generationModel: result.model,
                    originalShotType: sb._originalShotType ?? sb.shotType?.slice(0, 50),
                    normalizationMetadata: {
                        ...(sb._normalizationMetadata ?? { version: 1, overrides: [] }),
                        polishError: result.polishError,
                        sourceBeatIds: sb.sourceBeatIds ?? [],
                        productionWarnings: sb.order === 1 ? timingWarnings : [],
                        estimatedEpisodeDuration: totalDuration
                    },
                    sourceVersion: episode.sourceVersion
                }
            }
        })

        const committed = await prisma.$transaction(
            async tx => {
                const lockedEpisode = await tx.episode.findUnique({ where: { id: episodeId }, select: { status: true, operationVersion: true, deletedAt: true } })
                if (!lockedEpisode || lockedEpisode.deletedAt || lockedEpisode.status !== 'storyboarding' || lockedEpisode.operationVersion !== operationVersion) {
                    throw new Error('STORYBOARD_OPERATION_CANCELLED')
                }
                if (!overwriteExisting) {
                    const existing = await tx.storyboard.count({ where: { episodeId, deletedAt: null } })
                    if (existing > 0) throw new Error('STORYBOARDS_ALREADY_EXIST')
                }
                // The accepted overwrite already cleared the previous graph.
                // Repeat the same cleanup under the final episode lock to
                // remove any manual/racing rows created while the LLM ran.
                const replacement = overwriteExisting
                    ? await supersedeEpisodeStoryboardDataInTransaction(tx, episodeId, EPISODE_STORYBOARD_REPLACED_REASON)
                    : { storyboardIds: [], epJobIds: [], artifacts: [] }
                if (preparedStoryboards.length) {
                    await tx.storyboard.createMany({ data: preparedStoryboards.map(item => item.data) })
                    const characterLinks = preparedStoryboards.flatMap(item => item.characterIds.map(characterId => ({ id: genId(), storyboardId: item.id, characterId })))
                    if (characterLinks.length) await tx.storyboardCharacter.createMany({ data: characterLinks })
                }
                const completed = await tx.episode.updateMany({
                    where: { id: episodeId, operationVersion, status: 'storyboarding' },
                    data: { status: 'storyboarded', staleReason: null }
                })
                if (completed.count !== 1) throw new Error('STORYBOARD_OPERATION_CANCELLED')
                await chargeLlmUsage({ userId, jobId, task: 'AI 分镜生成', input: billingInput, output: result, model, tx })
                return { createdCount: preparedStoryboards.length, replacement }
            },
            { timeout: 60_000 }
        )

        abortEpJobControllers(committed.replacement.epJobIds)
        await deleteEpisodeArtifacts(committed.replacement.artifacts)

        await updateJob(jobId, {
            phase: 'done',
            result: { episodeId: episodeId.toString(), count: committed.createdCount, cancelled: false }
        })
    } catch (err) {
        await prisma.episode.updateMany({
            where: { id: episodeId, operationVersion, status: 'storyboarding' },
            data: { status: previousStatus }
        })
        const message = err instanceof Error ? err.message : String(err)
        const cancelled = message === 'STORYBOARD_OPERATION_CANCELLED' || message === '任务已取消，停止写入'
        await updateJob(
            jobId,
            cancelled
                ? { phase: 'cancelled', result: { episodeId: episodeId.toString(), count: 0, cancelled: true } }
                : {
                      phase: 'error',
                      error: message
                  }
        )
    } finally {
        stopHeartbeat()
    }
}

// 取消正在进行的 AI 分镜生成：把 episode 状态改回 previousStatus（draft/storyboarded）
// 后端 LLM 调用完成后发现 status 已变，会丢弃结果不写入，并把 job 标记为 cancelled。
export async function DELETE(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { episodeId: rawEpisodeId } = await req.json()
    if (!rawEpisodeId) return apiError('episodeId required')
    const episodeId = parseApiId(rawEpisodeId)
    if (episodeId === null) return apiError('剧集 ID 格式无效')
    const guard = await assertEpisodeOwner(episodeId, userId)
    if (guard) return guard
    const episode = await prisma.episode.findFirst({
        where: { id: episodeId, deletedAt: null },
        select: { status: true }
    })
    if (!episode) return apiError('Episode not found', 404)
    if (episode.status !== 'storyboarding') return apiResponse({ ok: true, skipped: true })
    await prisma.$transaction(async tx => {
        const storyboards = await tx.storyboard.findMany({ where: { episodeId, deletedAt: null }, select: { id: true } })
        await tx.episode.update({
            where: { id: episodeId },
            data: { status: 'draft', operationVersion: { increment: 1 } }
        })
        if (storyboards.length) {
            await tx.generation.updateMany({
                where: { storyboardId: { in: storyboards.map(item => item.id) }, status: { in: ['queued', 'processing'] } },
                data: { status: 'cancelled', activeKey: null, errorMsg: '用户取消了分镜任务' }
            })
        }
    })
    await cancelRunningJobs(episodeId.toString())
    return apiResponse({ ok: true })
}
