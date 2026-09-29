import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { getEpisodeFormatSpec, parseNovelSetup } from '@/lib/novel'
import { correctChapterContent, generateChapter } from '@/services/llm'
import { currentUserId } from '@/lib/current-user'
import { assertEpisodeOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { createJob, updateJob } from '@/lib/chapterJobStore'
import { startTextJobHeartbeat } from '@/lib/text-job-lease'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { countContentUnits, getChapterMinimumUnits } from '@/lib/content-contracts'
import { GEMINI_FLASH_TEXT_MODEL_ID } from '@/lib/gemini-models'
import { setupWithObservedFacts } from '@/services/narrative-facts'
import { reviewNarrativeContent } from '@/services/narrative-review'
import { saveReviewedNarrative } from '@/services/narrative-persistence'
import { createProviderTokenUsageCollector, type ProviderTokenUsageCall } from '@/lib/himodels-token-usage'
import { repairChapterDraft } from '@/services/chapter-repair'

const CHAPTER_GENERATE_RETRIES = 3
const DEFAULT_CHAPTER_MODEL = GEMINI_FLASH_TEXT_MODEL_ID

export const maxDuration = 2100

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function collectChapterUsage(jobId: string) {
    const collector = createProviderTokenUsageCollector()
    return {
        snapshot: () => (collector.snapshot().tokenUsage.calls > 0 ? collector.snapshot() : {}),
        onTokenUsage: async (call: ProviderTokenUsageCall) => {
            collector.record(call)
            await updateJob(jobId, { result: collector.snapshot() })
        }
    }
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { episodeId: rawEpisodeId } = await req.json()
    if (!rawEpisodeId) return apiError('episodeId required')
    const episodeId = parseApiId(rawEpisodeId)
    if (episodeId === null) return apiError('剧集 ID 格式无效', 400)
    const guard = await assertEpisodeOwner(episodeId, userId)
    if (guard) return guard

    const episode = await prisma.episode.findFirst({
        where: { id: episodeId, deletedAt: null },
        include: { project: true }
    })
    if (!episode) return apiError('Episode not found', 404)
    if (['finalized', 'scripted', 'storyboarded'].includes(episode.status ?? '')) {
        return apiError('本章已定稿，如需重新生成请先解除定稿')
    }
    const project = episode.project
    if (!project || project.deletedAt) return apiError('Project not found', 404)

    // If the browser lost the POST response after the job was created, its
    // recovery POST must reconnect to the same job instead of charging twice.
    const activeJob = await prisma.chapterJob.findFirst({
        where: {
            episodeId: episode.id,
            phase: { in: ['generating', 'writing_db'] },
            leaseExpiresAt: { gt: new Date() }
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true }
    })
    if (activeJob) return apiResponse({ jobId: activeJob.id.toString(), resumed: true })

    const allEpisodes = await prisma.episode.findMany({
        where: { projectId: project.id, deletedAt: null },
        orderBy: { episodeNumber: 'asc' }
    })

    const missingPrevious = allEpisodes.filter(e => e.episodeNumber < episode.episodeNumber && !e.chapterContent?.trim())
    if (missingPrevious.length > 0) {
        return apiError(`请先生成前文正文：第 ${missingPrevious.map(e => e.episodeNumber).join('、')} 章。后续章节必须基于全部前文顺序生成，避免剧情断层。`)
    }
    const billingInput = {
        projectTitle: project.title,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        synopsis: episode.synopsis,
        previousChapters: allEpisodes.filter(item => item.episodeNumber < episode.episodeNumber).map(item => item.chapterContent)
    }
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, 12_000))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const job = await createJob(episode.id.toString(), project.id.toString())
    const usage = collectChapterUsage(job.id)

    if (job.createdByRequest)
        after(() => withHiModelsUsageScope({ userId, jobId: job.id, onUsage: usage.onTokenUsage }, () => runChapterJob(job.id, episode, project, allEpisodes, userId, billingInput, usage)))

    return apiResponse({ jobId: job.id })
}

type EpisodeRow = Awaited<ReturnType<typeof prisma.episode.findMany>>[number]

async function runChapterJob(
    jobId: string,
    episode: NonNullable<Awaited<ReturnType<typeof prisma.episode.findFirst>>>,
    project: NonNullable<Awaited<ReturnType<typeof prisma.project.findFirst>>>,
    allEpisodes: EpisodeRow[],
    userId: bigint,
    billingInput: Record<string, unknown>,
    usage: ReturnType<typeof collectChapterUsage>
) {
    const stopHeartbeat = startTextJobHeartbeat(() => updateJob(jobId, {}))
    try {
        const setup = setupWithObservedFacts(parseNovelSetup(project.novelSetup), allEpisodes, episode.episodeNumber)
        const targetWords = setup.targetWordCount ? Math.round(setup.targetWordCount / Math.max(project.totalEpisodes ?? 1, 1)) : getEpisodeFormatSpec(setup.episodeFormat).chapterWordHint
        const statePlan = setup.episodeStatePlan?.find(item => item.episodeNumber === episode.episodeNumber) ?? null
        const modelConfig = await prisma.aiServiceConfig.findUnique({ where: { provider: 'chapter_model' }, select: { modelName: true } })

        const allOutline = allEpisodes.map(e => ({
            chapterNumber: e.episodeNumber,
            title: e.title,
            synopsis: e.synopsis
        }))

        const previousContext = allEpisodes
            .filter(e => e.episodeNumber < episode.episodeNumber)
            .map(e => ({
                chapterNumber: e.episodeNumber,
                title: e.title,
                synopsis: e.synopsis,
                content: e.chapterContent,
                finalized: e.status === 'finalized'
            }))

        const model = modelConfig?.modelName ?? DEFAULT_CHAPTER_MODEL
        const review = (candidate: string) =>
            reviewNarrativeContent({
                stage: 'chapter',
                episodeNumber: episode.episodeNumber,
                content: candidate,
                source: episode.synopsis ?? '',
                setup,
                statePlan,
                previousEnding: previousContext.at(-1)?.content?.slice(-1800),
                model
            })

        let content = ''
        let lastErr: unknown

        for (let attempt = 0; attempt <= CHAPTER_GENERATE_RETRIES; attempt++) {
            await updateJob(jobId, { attempts: attempt + 1 })
            try {
                content = await generateChapter({
                    title: project.title,
                    genre: project.genre ?? undefined,
                    description: project.description ?? undefined,
                    totalEpisodes: project.totalEpisodes ?? 1,
                    setup,
                    allOutline,
                    previousContext,
                    current: {
                        chapterNumber: episode.episodeNumber,
                        title: episode.title,
                        synopsis: episode.synopsis
                    },
                    model,
                    retryAttempt: attempt,
                    retryFeedback: attempt > 0 ? '正文未满足章节合同' : undefined
                })
                if (!content.trim()) throw new Error('模型返回了空章节正文')
                break
            } catch (err) {
                if (err instanceof BillingError) throw err
                lastErr = err
                if (attempt >= CHAPTER_GENERATE_RETRIES) {
                    const msg = err instanceof Error ? err.message : String(err)
                    throw new Error(`章节生成失败，已自动重试 ${CHAPTER_GENERATE_RETRIES} 次：${msg}`)
                }
                const msg = err instanceof Error ? err.message : String(err)
                console.warn(`[Chapter] 第${episode.episodeNumber}章生成失败，准备第 ${attempt + 1}/${CHAPTER_GENERATE_RETRIES} 次重试：`, msg)
                await sleep(2000 * Math.pow(2, attempt))
            }
        }

        if (!content.trim()) {
            const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown error')
            throw new Error(`章节生成失败，已自动重试 ${CHAPTER_GENERATE_RETRIES} 次：${msg}`)
        }

        const repaired = await repairChapterDraft({
            content,
            targetWords,
            review,
            repair: (candidate, issues) =>
                correctChapterContent({
                    content: candidate,
                    targetWords,
                    chapterNumber: episode.episodeNumber,
                    synopsis: episode.synopsis,
                    statePlan,
                    issues,
                    model
                })
        })
        if (repaired.blockingIssues.length > 0) {
            throw new Error(`章节合同校验失败：${repaired.blockingIssues.map(issue => issue.message).join('；')}`)
        }
        content = repaired.content
        const reviewed = repaired.review
        if (!reviewed) throw new Error('正文尚未通过剧情事实复核')
        const actualWords = countContentUnits(content)
        const minimumWords = getChapterMinimumUnits(targetWords)
        const warning = repaired.warningIssues.length > 0 ? repaired.warningIssues.map(issue => issue.message).join('；') : undefined

        await updateJob(jobId, { phase: 'writing_db' })

        await saveReviewedNarrative({
            episode,
            stage: 'chapter',
            content,
            facts: reviewed.facts,
            quality: reviewed.quality,
            issues: repaired.warningIssues,
            settleUsage: tx => chargeLlmUsage({ userId, jobId, task: '章节正文生成', input: billingInput, output: content, model, tx })
        })

        await updateJob(jobId, {
            phase: 'done',
            result: {
                episodeId: episode.id.toString(),
                chapterContent: content,
                actualWords,
                minimumWords,
                targetWords,
                repairAttempts: repaired.repairAttempts,
                warning,
                ...usage.snapshot()
            }
        })
    } catch (err) {
        await updateJob(jobId, {
            phase: 'error',
            error: err instanceof Error ? err.message : String(err),
            result: usage.snapshot()
        })
    } finally {
        stopHeartbeat()
    }
}
