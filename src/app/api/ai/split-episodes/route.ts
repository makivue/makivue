import { parseApiId } from '@/lib/api-id'
import { currentUserId } from '@/lib/current-user'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { getEpisodeFormatSpec, parseNovelSetup } from '@/lib/novel'
import { assertProjectOwner } from '@/lib/ownership'
import { prisma } from '@/lib/prisma'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { deriveScriptCharacterScope } from '@/lib/script-character-scope'
import { startTextJobHeartbeat } from '@/lib/text-job-lease'
import { apiError, apiResponse } from '@/lib/utils'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { setupWithObservedFacts } from '@/services/narrative-facts'
import { saveGeneratedNarrative } from '@/services/narrative-persistence'
import { generateBasicScript } from '@/services/script-generation'
import { syncSetupCharacters } from '@/services/setup-characters'
import { after, NextRequest } from 'next/server'

// 定稿章节 → 分集剧本：串行调用 N 次 LLM，肯定顶网关。改为异步 job：
// 立即返回 jobId，后台逐集跑 LLM，前端轮询 /api/ai/split-episodes/status/[jobId] 拿进度。
export const maxDuration = 2100

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { projectId } = await req.json()
    if (!projectId) return apiError('projectId required')
    const projectIdNum = parseApiId(projectId)
    if (projectIdNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectIdNum, userId)
    if (guard) return guard

    const project = await prisma.project.findFirst({
        where: { id: projectIdNum, deletedAt: null },
        include: {
            episodes: { where: { deletedAt: null }, orderBy: { episodeNumber: 'asc' } }
        }
    })
    if (!project) return apiError('Project not found', 404)

    if (project.novelStage !== 'finalized' && project.novelStage !== 'scripted') {
        return apiError('请先完成所有章节的定稿')
    }

    const unfinalized = project.episodes.filter(e => e.status !== 'finalized' && e.status !== 'scripted' && e.status !== 'storyboarded')
    if (unfinalized.length > 0) {
        return apiError(`存在未定稿章节：${unfinalized.map(e => `第${e.episodeNumber}章`).join('、')}`)
    }

    const total = project.episodes.filter(e => !!e.chapterContent).length
    const billingInput = {
        projectTitle: project.title,
        genre: project.genre,
        episodes: project.episodes.map(episode => ({ episodeNumber: episode.episodeNumber, title: episode.title, synopsis: episode.synopsis, chapterContent: episode.chapterContent }))
    }
    const perEpisodeBudgetTokens = getEpisodeFormatSpec(parseNovelSetup(project.novelSetup).episodeFormat).scriptMaxTokens + 12_000
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, Math.max(4_000, total * perEpisodeBudgetTokens)))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }
    const job = await createJob(projectIdNum.toString(), 'split_episodes', total)
    if (!job.reused) after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runSplitEpisodesJob(job.id, project, userId)))
    return apiResponse({ jobId: job.id })
}

type ProjectWithEpisodes = NonNullable<
    Awaited<
        ReturnType<
            typeof prisma.project.findFirst<{
                include: { episodes: true }
            }>
        >
    >
>

async function runSplitEpisodesJob(jobId: string, project: ProjectWithEpisodes, userId: bigint) {
    const stopHeartbeat = startTextJobHeartbeat(() => updateJob(jobId, {}))
    try {
        await updateJob(jobId, { attempts: 1 })
        const setup = parseNovelSetup(project.novelSetup)
        await syncSetupCharacters(project.id, setup)
        const registeredCharacters = await prisma.character.findMany({
            where: { projectId: project.id, deletedAt: null },
            select: { name: true, canonicalName: true, aliases: true },
            orderBy: { createdAt: 'asc' }
        })
        const modelConfig = await prisma.aiServiceConfig.findUnique({ where: { provider: 'script_model' }, select: { modelName: true } })
        const model = modelConfig?.modelName ?? GEMINI_FLASH_TEXT_MODEL_ID
        let count = 0
        for (let i = 0; i < project.episodes.length; i++) {
            const ep = await prisma.episode.findUniqueOrThrow({ where: { id: project.episodes[i].id } })
            if (ep.deletedAt || !['finalized', 'scripted', 'storyboarded'].includes(ep.status ?? '')) throw new Error(`第 ${ep.episodeNumber} 集内容已变化，请重新定稿后再拆剧本`)
            const currentSetup = setupWithObservedFacts(setup, project.episodes, ep.episodeNumber, 'script')
            if (!ep.chapterContent) continue
            const previousEpisode = project.episodes[i - 1] ?? null
            const nextEpisode = project.episodes[i + 1] ?? null
            const currentEpisodeState = setup.episodeStatePlan?.find(state => state.episodeNumber === ep.episodeNumber)
            const { allowedCharacterNames, referenceOnlyCharacterNames, outOfScopeCharacterNames } = deriveScriptCharacterScope({
                characters: registeredCharacters,
                chapterTitle: ep.title,
                chapterSynopsis: ep.synopsis,
                chapterContent: ep.chapterContent!,
                currentEpisodeState
            })
            const result = await withHiModelsUsageScope({ billingKey: `job:${jobId}:${ep.id}` }, () =>
                generateBasicScript({
                    model,
                    title: project.title,
                    genre: project.genre ?? undefined,
                    chapterNumber: ep.episodeNumber,
                    chapterTitle: ep.title,
                    chapterSynopsis: ep.synopsis,
                    chapterContent: ep.chapterContent!,
                    setup: currentSetup,
                    previousContext: project.episodes.slice(0, i),
                    allowedCharacterNames,
                    referenceOnlyCharacterNames,
                    outOfScopeCharacterNames,
                    previousEpisode: previousEpisode
                        ? {
                              episodeNumber: previousEpisode.episodeNumber,
                              title: previousEpisode.title,
                              synopsis: previousEpisode.synopsis,
                              chapterContent: previousEpisode.chapterContent,
                              script: previousEpisode.script
                          }
                        : null,
                    nextEpisode: nextEpisode
                        ? {
                              episodeNumber: nextEpisode.episodeNumber,
                              title: nextEpisode.title,
                              synopsis: nextEpisode.synopsis,
                              chapterContent: nextEpisode.chapterContent,
                              script: nextEpisode.script
                          }
                        : null
                })
            )
            await updateJob(jobId, { phase: 'writing_db' })
            const updated = await saveGeneratedNarrative({
                episode: ep,
                stage: 'script',
                content: result.script,
                facts: result.facts,
                adaptation: { title: result.title, synopsis: result.synopsis, scenePlan: result.scenePlan },
                settleUsage: tx =>
                    chargeLlmUsage({
                        userId,
                        jobId: `${jobId}:${ep.id}`,
                        task: `第 ${ep.episodeNumber} 集剧本生成`,
                        input: { title: project.title, genre: project.genre, episodeNumber: ep.episodeNumber, chapterContent: ep.chapterContent },
                        output: result,
                        model,
                        tx
                    })
            })
            project.episodes[i] = updated
            count++
            await updateJob(jobId, { progress: count })
        }

        await updateJob(jobId, { phase: 'writing_db' })
        await prisma.project.update({
            where: { id: project.id },
            data: { novelStage: 'scripted' }
        })

        await updateJob(jobId, {
            phase: 'done',
            result: { count }
        })
    } catch (err) {
        await updateJob(jobId, {
            phase: 'error',
            error: err instanceof Error ? err.message : String(err)
        })
    } finally {
        stopHeartbeat()
    }
}
