import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError, apiErrorWithDetails } from '@/lib/utils'
import { getEpisodeFormatSpec, parseNovelSetup } from '@/lib/novel'
import { generateReviewedScript } from '@/services/script-generation'
import { setupWithObservedFacts } from '@/services/narrative-facts'
import { saveReviewedNarrative } from '@/services/narrative-persistence'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { createJob, updateJob } from '@/lib/scriptJobStore'
import { startTextJobHeartbeat } from '@/lib/text-job-lease'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { syncSetupCharacters } from '@/services/setup-characters'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { deriveScriptCharacterScope } from '@/lib/script-character-scope'
import { assertTextModelConfigured } from '@/services/llm'
import { getGenerationErrorGuidance } from '@/lib/generation-error-guidance'

const DEFAULT_SCRIPT_MODEL = GEMINI_FLASH_TEXT_MODEL_ID
export const maxDuration = 600

// 单集拆剧本：立即返回 jobId，后台调用 LLM，前端轮询 /api/ai/script/status/[jobId]
// 之前是同步版本，长章节会在网关层触发 upstream request timeout（60s）。
export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { episodeId } = await req.json()
    if (!episodeId) return apiError('episodeId required')
    const episodeIdNum = parseApiId(episodeId)
    if (episodeIdNum === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(episodeIdNum, userId)
    if (guard) return guard

    const episode = await prisma.episode.findFirst({
        where: { id: episodeIdNum, deletedAt: null },
        include: { project: true }
    })
    if (!episode) return apiError('Episode not found', 404)
    if (!episode.project) return apiError('Project not found', 404)
    if (!episode.chapterContent) return apiError('本章还未定稿或未有正文')
    if (episode.status !== 'finalized' && episode.status !== 'scripted' && episode.status !== 'storyboarded') {
        return apiError('本章尚未定稿，不能拆剧本')
    }
    const modelConfig = await prisma.aiServiceConfig.findUnique({ where: { provider: 'script_model' }, select: { modelName: true } })
    const model = modelConfig?.modelName?.trim() || DEFAULT_SCRIPT_MODEL
    try {
        await assertTextModelConfigured(model)
    } catch (error) {
        const guidance = getGenerationErrorGuidance(error instanceof Error ? error.message : String(error))
        const missing = guidance.configurationIssue === 'missing'
        return apiErrorWithDetails(`拆剧本${missing ? '模型未配置' : '模型配置无效'}。请联系管理员完成模型配置，或选择其他已配置的模型后重试。`, 503, {
            code: missing ? 'MODEL_NOT_CONFIGURED' : 'MODEL_CONFIGURATION_INVALID',
            model,
            retryable: false
        })
    }
    const billingInput = {
        projectTitle: episode.project.title,
        episodeNumber: episode.episodeNumber,
        chapterTitle: episode.title,
        chapterSynopsis: episode.synopsis,
        chapterContent: episode.chapterContent
    }
    const scriptBudgetTokens = getEpisodeFormatSpec(parseNovelSetup(episode.project.novelSetup).episodeFormat).scriptMaxTokens + 12_000
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, scriptBudgetTokens))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const job = await createJob(episode.id.toString(), episode.projectId.toString())

    if (job.createdByRequest) after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runScriptJob(job.id, episode, userId, billingInput, model)))

    return apiResponse({ jobId: job.id })
}

type EpisodeWithProject = NonNullable<
    Awaited<
        ReturnType<
            typeof prisma.episode.findFirst<{
                include: { project: true }
            }>
        >
    >
>

async function runScriptJob(jobId: string, episode: EpisodeWithProject, userId: bigint, billingInput: Record<string, unknown>, model: string) {
    const stopHeartbeat = startTextJobHeartbeat(() => updateJob(jobId, {}))
    try {
        await updateJob(jobId, { attempts: 1 })
        const project = episode.project!
        let setup = parseNovelSetup(project.novelSetup)
        await syncSetupCharacters(project.id, setup)
        const registeredCharacters = await prisma.character.findMany({
            where: { projectId: project.id, deletedAt: null },
            select: { name: true, canonicalName: true, aliases: true },
            orderBy: { createdAt: 'asc' }
        })
        const currentEpisodeState = setup.episodeStatePlan?.find(state => state.episodeNumber === episode.episodeNumber)
        const characterScope = deriveScriptCharacterScope({
            characters: registeredCharacters,
            chapterTitle: episode.title,
            chapterSynopsis: episode.synopsis,
            chapterContent: episode.chapterContent!,
            currentEpisodeState
        })
        const { allowedCharacterNames, referenceOnlyCharacterNames, outOfScopeCharacterNames } = characterScope
        const siblingEpisodes = await prisma.episode.findMany({
            where: { projectId: episode.projectId, deletedAt: null },
            orderBy: { episodeNumber: 'asc' }
        })
        const previousEpisode = siblingEpisodes.filter(e => e.episodeNumber < episode.episodeNumber).at(-1)
        const nextEpisode = siblingEpisodes.find(e => e.episodeNumber > episode.episodeNumber)

        setup = setupWithObservedFacts(setup, siblingEpisodes, episode.episodeNumber, 'script')
        const result = await generateReviewedScript({
            title: project.title,
            genre: project.genre ?? undefined,
            chapterNumber: episode.episodeNumber,
            chapterTitle: episode.title,
            chapterSynopsis: episode.synopsis,
            chapterContent: episode.chapterContent!,
            setup,
            allowedCharacterNames,
            referenceOnlyCharacterNames,
            outOfScopeCharacterNames,
            previousContext: siblingEpisodes
                .filter(e => e.episodeNumber < episode.episodeNumber)
                .map(e => ({
                    episodeNumber: e.episodeNumber,
                    title: e.title,
                    synopsis: e.synopsis,
                    chapterContent: e.chapterContent,
                    script: e.script
                })),
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
                : null,
            model
        })
        await updateJob(jobId, { phase: 'writing_db' })

        const updated = await saveReviewedNarrative({
            episode,
            stage: 'script',
            content: result.script,
            facts: result.facts,
            quality: result.quality,
            adaptation: { title: result.title, synopsis: result.synopsis, scenePlan: result.scenePlan },
            settleUsage: tx => chargeLlmUsage({ userId, jobId, task: '单集剧本生成', input: billingInput, output: result, model, tx })
        })

        const siblings = await prisma.episode.findMany({
            where: { projectId: episode.projectId, deletedAt: null },
            select: { status: true }
        })
        const allScripted = siblings.every(e => e.status === 'scripted' || e.status === 'storyboarded')
        if (allScripted && project.novelStage !== 'scripted') {
            await prisma.project.update({
                where: { id: episode.projectId },
                data: { novelStage: 'scripted' }
            })
        }

        await updateJob(jobId, {
            phase: 'done',
            result: {
                episodeId: updated.id.toString(),
                episodeNumber: updated.episodeNumber,
                title: updated.title,
                synopsis: updated.synopsis,
                script: updated.script ?? '',
                allScripted
            }
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
