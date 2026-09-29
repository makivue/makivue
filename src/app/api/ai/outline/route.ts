import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { apiResponse, apiError } from '@/lib/utils'
import { parseNovelSetup, stringifyNovelSetup, NovelSetup } from '@/lib/novel'
import { generateOutlineBatch, fillMissingChapters, repairOutlineSeriesChapters, reviewOutlineSeries, GeneratedOutlineChapter } from '@/services/llm'
import { genId } from '@/lib/id'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { appendOutlineHiModelsResponse, assertJobActive, createJob, getActiveProjectJob, updateJob } from '@/lib/outlineJobStore'
import type { HiModelsRawResponse } from '@/lib/himodels-response-diagnostics'
import { createProviderTokenUsageCollector, type ProviderTokenUsageCall } from '@/lib/himodels-token-usage'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { findMissingOutlineChapterNumbers, selectUsableOutlineChapters } from '@/services/outline-validation'
import { buildEpisodeFactSnapshot, CONTENT_CONTRACT_VERSION, validateOutlineContract } from '@/lib/content-contracts'
import { outlineRepairEpisodeNumbers, type OutlineSeriesReview } from '@/lib/outline-series-review'
import type { Prisma } from '@/generated/prisma/client'
import { withActiveOutlineWrite } from '@/services/outline-persistence-guard'
import { finishEpisodeDownstreamReset, resetEpisodeDownstreamInTransaction } from '@/services/episode-downstream-reset'

export const maxDuration = 2100

function collectOutlineUsage(jobId: string) {
    const collector = createProviderTokenUsageCollector()
    return {
        snapshot: () => (collector.snapshot().tokenUsage.calls > 0 ? collector.snapshot() : {}),
        onTokenUsage: async (call: ProviderTokenUsageCall) => {
            collector.record(call)
            await updateJob(jobId, { result: collector.snapshot() })
        }
    }
}

function storedOutlineChapter(
    episode: { episodeNumber: number; title: string | null; synopsis: string | null; intensity: number | null; stateSnapshot?: unknown },
    setup: NovelSetup
): GeneratedOutlineChapter {
    const snapshot = episode.stateSnapshot && typeof episode.stateSnapshot === 'object' && !Array.isArray(episode.stateSnapshot) ? (episode.stateSnapshot as Record<string, unknown>) : {}
    const planned = setup.episodeStatePlan?.find(item => item.episodeNumber === episode.episodeNumber)
    const plannedRecord = planned ? (planned as unknown as Record<string, unknown>) : {}
    const value = (key: keyof GeneratedOutlineChapter) => snapshot[key] ?? plannedRecord[key]
    const text = (key: keyof GeneratedOutlineChapter) => (typeof value(key) === 'string' ? (value(key) as string) : undefined)
    const list = (key: keyof GeneratedOutlineChapter) => (Array.isArray(value(key)) ? (value(key) as unknown[]).filter((item): item is string => typeof item === 'string') : undefined)
    return {
        chapterNumber: episode.episodeNumber,
        title: episode.title ?? `第${episode.episodeNumber}章`,
        synopsis: episode.synopsis ?? '',
        intensity: episode.intensity ?? 5,
        coldOpen: text('coldOpen'),
        protagonistGoal: text('protagonistGoal'),
        primaryObstacle: text('primaryObstacle'),
        escalation: text('escalation'),
        irreversibleChoice: text('irreversibleChoice'),
        cost: text('cost'),
        reversal: text('reversal'),
        informationGain: text('informationGain'),
        cliffhanger: text('cliffhanger'),
        setupPayoffs: list('setupPayoffs'),
        openingState: text('openingState'),
        endingState: text('endingState'),
        characterStateChanges: text('characterStateChanges'),
        continuityBridge: text('continuityBridge'),
        requiredEvents: list('requiredEvents')
    }
}

async function reviewAndRepairCompleteOutline(params: {
    jobId: string
    title: string
    totalEpisodes: number
    setup: NovelSetup
    chapters: GeneratedOutlineChapter[]
    sourceNovel?: string | null
    onHiModelsResponse: (response: HiModelsRawResponse) => void | Promise<void>
    onTokenUsage: (call: ProviderTokenUsageCall) => void | Promise<void>
}) {
    let chapters = params.chapters.slice().sort((a, b) => a.chapterNumber - b.chapterNumber)
    let review = await reviewOutlineSeries(params)
    const repairNumbers = outlineRepairEpisodeNumbers(review, params.totalEpisodes)
    const repaired: GeneratedOutlineChapter[] = []

    for (let start = 0; start < repairNumbers.length; start += 5) {
        await assertJobActive(params.jobId)
        const requested = repairNumbers.slice(start, start + 5)
        const raw = await repairOutlineSeriesChapters({ ...params, chapters, chapterNumbers: requested, review })
        const batch = selectUsableOutlineChapters(raw, requested)
        const missing = findMissingOutlineChapterNumbers(requested, batch)
        if (missing.length > 0) throw new Error(`全剧统稿返修未返回合格章节：${missing.join('、')}`)
        const replacements = new Map(batch.map(chapter => [chapter.chapterNumber, chapter]))
        chapters = chapters.map(chapter => replacements.get(chapter.chapterNumber) ?? chapter)
        repaired.push(...batch)
    }

    const contractIssues = validateOutlineContract(
        chapters,
        Array.from({ length: params.totalEpisodes }, (_, index) => index + 1)
    )
    if (contractIssues.length > 0) throw new Error(`全剧统稿返修未通过结构校验：${contractIssues.map(issue => issue.message).join('；')}`)
    if (repairNumbers.length > 0) {
        review = await reviewOutlineSeries({ ...params, chapters })
        if (review.issues.length > 0) throw new Error(`全剧统稿复核未通过：${review.issues.map(issue => issue.message).join('；')}`)
    }
    return { chapters, repaired, review }
}

export async function GET(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const projectId = parseApiId(req.nextUrl.searchParams.get('projectId'))
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard
    const job = await getActiveProjectJob(projectId)
    return apiResponse({ jobId: job?.id ?? null })
}

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { projectId: rawProjectId, continueMissing = false } = await req.json()
    if (!rawProjectId) return apiError('projectId required')
    const projectId = parseApiId(rawProjectId)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        include: { episodes: { where: { deletedAt: null }, orderBy: { episodeNumber: 'asc' }, include: { _count: { select: { storyboards: true } } } } }
    })
    if (!project) return apiError('Project not found', 404)
    if (project.novelStage === 'scripted') {
        return apiError('已完成剧本拆分，如需重新规划请先重置进度')
    }
    if (!continueMissing && project.episodes.some(episode => Boolean(episode.synopsis || episode.chapterContent || episode.script || episode.finalizedAt) || (episode._count?.storyboards ?? 0) > 0)) {
        return apiError('项目已有大纲或下游内容，请先通过受保护的“重置进度”操作获取二次确认令牌后再生成', 409)
    }

    const totalEpisodes = project.totalEpisodes ?? 1
    // 前端刷新后接回当前任务；状态轮询会识别失去心跳的 worker，
    // 并由客户端从已经落库的章节检查点自动续写剩余部分。
    const activeJob = await getActiveProjectJob(projectId)
    if (activeJob) return apiResponse({ jobId: activeJob.id, resumed: true })

    const missingChapterNumbers = Array.from({ length: totalEpisodes }, (_, i) => i + 1).filter(n => {
        const episode = project.episodes.find(item => item.episodeNumber === n)
        return !episode?.synopsis?.trim()
    })
    if (continueMissing && missingChapterNumbers.length === 0) {
        return apiError('大纲已经完整，无需继续生成')
    }
    const billingInput = {
        title: project.title,
        genre: project.genre,
        description: project.description,
        totalEpisodes,
        setup: parseNovelSetup(project.novelSetup),
        sourceNovel: project.novel,
        requestedChapters: continueMissing ? missingChapterNumbers : totalEpisodes
    }
    const requestedCount = continueMissing ? missingChapterNumbers.length : totalEpisodes
    const expectedOutputTokens = Math.max(16_384, requestedCount * 1_500 + totalEpisodes * 1_700 + 16_384)
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, expectedOutputTokens))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const job = await createJob(rawProjectId, continueMissing ? missingChapterNumbers.length : totalEpisodes)

    // A concurrent request may have created the same active job after our
    // preflight query. Only the request that actually inserted it may start
    // the worker; the other caller simply reconnects to that job.
    if (job.createdByRequest) {
        if (continueMissing) {
            after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runMissingOutlineJob(job.id, project, missingChapterNumbers, userId, billingInput)))
        } else {
            after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runOutlineJob(job.id, project, userId, billingInput)))
        }
    }

    return apiResponse({ jobId: job.id, resumed: !job.createdByRequest })
}

async function runMissingOutlineJob(
    jobId: string,
    project: NonNullable<Awaited<ReturnType<typeof prisma.project.findFirst>>> & {
        episodes: Array<{ id: bigint; episodeNumber: number; title: string | null; synopsis: string | null; intensity: number | null; stateSnapshot?: unknown }>
    },
    missingChapterNumbers: number[],
    userId: bigint,
    billingInput: Record<string, unknown>
) {
    const totalEpisodes = project.totalEpisodes ?? 1
    const setup = parseNovelSetup(project.novelSetup)
    const existingChapters: GeneratedOutlineChapter[] = project.episodes.filter(ep => ep.synopsis?.trim()).map(ep => storedOutlineChapter(ep, setup))
    const generated: GeneratedOutlineChapter[] = []
    const usage = collectOutlineUsage(jobId)
    const onTokenUsage = usage.onTokenUsage
    const onHiModelsResponse = (response: HiModelsRawResponse) => appendOutlineHiModelsResponse(jobId, response)
    const heartbeat = setInterval(() => {
        void updateJob(jobId, {})
    }, 60_000)
    heartbeat.unref()

    try {
        const batchSize = 5
        for (let start = 0; start < missingChapterNumbers.length; start += batchSize) {
            await assertJobActive(jobId)
            const chapterNumbers = missingChapterNumbers.slice(start, start + batchSize)
            const rawBatch = await generateOutlineBatch({
                title: project.title,
                genre: project.genre ?? undefined,
                description: project.description ?? undefined,
                totalEpisodes,
                setup,
                sourceNovel: project.novel,
                chapterNumbers,
                existingChapters: [...existingChapters, ...generated],
                onHiModelsResponse,
                onTokenUsage
            })
            await assertJobActive(jobId)
            const batch = selectUsableOutlineChapters(rawBatch, chapterNumbers)
            const known = new Set(generated.map(c => c.chapterNumber))
            for (const chapter of batch) {
                if (!known.has(chapter.chapterNumber)) generated.push(chapter)
            }
            await persistOutlineChapters(project.id, project, batch, totalEpisodes, jobId)

            const batchMissing = findMissingOutlineChapterNumbers(chapterNumbers, batch)
            if (batchMissing.length > 0) {
                try {
                    const rawFilled = await fillMissingChapters({
                        title: project.title,
                        genre: project.genre ?? undefined,
                        description: project.description ?? undefined,
                        totalEpisodes,
                        setup,
                        sourceNovel: project.novel,
                        existingChapters: [...existingChapters, ...generated],
                        missingChapterNumbers: batchMissing,
                        onHiModelsResponse,
                        onTokenUsage
                    })
                    await assertJobActive(jobId)
                    const filled = selectUsableOutlineChapters(rawFilled, batchMissing)
                    const generatedNumbers = new Set(generated.map(chapter => chapter.chapterNumber))
                    for (const chapter of filled) {
                        if (!generatedNumbers.has(chapter.chapterNumber)) generated.push(chapter)
                    }
                    await persistOutlineChapters(project.id, project, filled, totalEpisodes, jobId)
                } catch (error) {
                    console.warn(`[outline] immediate batch fill failed for chapters ${batchMissing.join(', ')}:`, error)
                }
            }
            await updateJob(jobId, { receivedChapters: generated.length })
        }

        const stillMissing = findMissingOutlineChapterNumbers(missingChapterNumbers, generated)
        if (stillMissing.length > 0) {
            await updateJob(jobId, { phase: 'filling' })
            try {
                const rawFilled = await fillMissingChapters({
                    title: project.title,
                    genre: project.genre ?? undefined,
                    description: project.description ?? undefined,
                    totalEpisodes,
                    setup,
                    sourceNovel: project.novel,
                    existingChapters: [...existingChapters, ...generated],
                    missingChapterNumbers: stillMissing,
                    onHiModelsResponse,
                    onTokenUsage
                })
                await assertJobActive(jobId)
                const filled = selectUsableOutlineChapters(rawFilled, stillMissing)
                const known = new Set(generated.map(c => c.chapterNumber))
                for (const chapter of filled) {
                    if (!known.has(chapter.chapterNumber)) generated.push(chapter)
                }
                await persistOutlineChapters(project.id, project, filled, totalEpisodes, jobId)
                await updateJob(jobId, { receivedChapters: generated.length })
            } catch (err) {
                console.warn('[outline] continue fill missing chapters failed:', err)
            }
        }

        await assertJobActive(jobId)
        const generatedNumbers = new Set(generated.map(c => c.chapterNumber))
        const remaining = missingChapterNumbers.filter(n => !generatedNumbers.has(n))
        let seriesQuality: Record<string, number> | undefined
        if (remaining.length === 0) {
            const replacements = new Map(generated.map(chapter => [chapter.chapterNumber, chapter]))
            const completeChapters = project.episodes
                .filter(episode => episode.episodeNumber >= 1 && episode.episodeNumber <= totalEpisodes)
                .map(episode => replacements.get(episode.episodeNumber) ?? storedOutlineChapter(episode, setup))
                .sort((a, b) => a.chapterNumber - b.chapterNumber)
            const contractIssues = validateOutlineContract(
                completeChapters,
                Array.from({ length: totalEpisodes }, (_, index) => index + 1)
            )
            if (contractIssues.length > 0) throw new Error(`补齐后的大纲合同校验失败：${contractIssues.map(issue => issue.message).join('；')}`)
            const reviewed = await reviewAndRepairCompleteOutline({
                jobId,
                title: project.title,
                totalEpisodes,
                setup,
                chapters: completeChapters,
                sourceNovel: project.novel,
                onHiModelsResponse,
                onTokenUsage
            })
            if (reviewed.repaired.length > 0) await persistOutlineChapters(project.id, project, reviewed.repaired, totalEpisodes, jobId)
            seriesQuality = reviewed.review.scores
            await persistOutline(
                project.id,
                project,
                reviewed.chapters,
                totalEpisodes,
                setup,
                jobId,
                tx => chargeLlmUsage({ userId, jobId, task: '续写分集大纲', input: billingInput, output: reviewed.chapters, tx }),
                reviewed.review
            )
        } else {
            await withActiveOutlineWrite(project.id, project.operationVersion, jobId, tx => chargeLlmUsage({ userId, jobId, task: '续写分集大纲', input: billingInput, output: generated, tx }))
        }
        await updateJob(jobId, {
            phase: 'done',
            result: {
                count: generated.length,
                seriesQuality,
                ...usage.snapshot(),
                requested: missingChapterNumbers.length,
                missing: remaining,
                warning: remaining.length > 0 ? `仍有 ${remaining.length} 章未生成：${remaining.join(', ')}。可以再次点击“继续生成剩余大纲”。` : undefined
            }
        })
    } catch (err) {
        await updateJob(jobId, { phase: 'error', error: err instanceof Error ? err.message : String(err), result: usage.snapshot() })
    } finally {
        clearInterval(heartbeat)
    }
}

async function runOutlineJob(
    jobId: string,
    project: NonNullable<Awaited<ReturnType<typeof prisma.project.findFirst>>> & {
        episodes: Array<{ id: bigint; episodeNumber: number }>
    },
    userId: bigint,
    billingInput: Record<string, unknown>
) {
    const projectId = project.id
    const totalEpisodes = project.totalEpisodes ?? 1
    const setup = parseNovelSetup(project.novelSetup)
    const usage = collectOutlineUsage(jobId)
    const onTokenUsage = usage.onTokenUsage
    const onHiModelsResponse = (response: HiModelsRawResponse) => appendOutlineHiModelsResponse(jobId, response)
    const heartbeat = setInterval(() => {
        void updateJob(jobId, {})
    }, 60_000)
    heartbeat.unref()

    try {
        const chapters: GeneratedOutlineChapter[] = []
        // 每批控制在 5 章，避免长大纲超过模型输出上限。每批完成立即落库，
        // 前端轮询可以边生成边展示，不必等待全剧结束。
        const batchSize = 5
        for (let start = 1; start <= totalEpisodes; start += batchSize) {
            await assertJobActive(jobId)
            const chapterNumbers = Array.from({ length: Math.min(batchSize, totalEpisodes - start + 1) }, (_, i) => start + i)
            const rawBatch = await generateOutlineBatch({
                title: project.title,
                genre: project.genre ?? undefined,
                description: project.description ?? undefined,
                totalEpisodes,
                setup,
                sourceNovel: project.novel,
                chapterNumbers,
                existingChapters: chapters,
                onHiModelsResponse,
                onTokenUsage
            })
            await assertJobActive(jobId)
            const batch = selectUsableOutlineChapters(rawBatch, chapterNumbers)
            const known = new Set(chapters.map(c => c.chapterNumber))
            for (const chapter of batch) {
                if (!known.has(chapter.chapterNumber)) chapters.push(chapter)
            }
            chapters.sort((a, b) => a.chapterNumber - b.chapterNumber)
            await persistOutlineChapters(projectId, project, batch, totalEpisodes, jobId)

            const batchMissing = findMissingOutlineChapterNumbers(chapterNumbers, batch)
            if (batchMissing.length > 0) {
                try {
                    const rawFilled = await fillMissingChapters({
                        title: project.title,
                        genre: project.genre ?? undefined,
                        description: project.description ?? undefined,
                        totalEpisodes,
                        setup,
                        sourceNovel: project.novel,
                        existingChapters: chapters,
                        missingChapterNumbers: batchMissing,
                        onHiModelsResponse,
                        onTokenUsage
                    })
                    await assertJobActive(jobId)
                    const filled = selectUsableOutlineChapters(rawFilled, batchMissing)
                    const chapterNumbersAlreadyGenerated = new Set(chapters.map(chapter => chapter.chapterNumber))
                    for (const chapter of filled) {
                        if (!chapterNumbersAlreadyGenerated.has(chapter.chapterNumber)) chapters.push(chapter)
                    }
                    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber)
                    await persistOutlineChapters(projectId, project, filled, totalEpisodes, jobId)
                } catch (error) {
                    console.warn(`[outline] immediate batch fill failed for chapters ${batchMissing.join(', ')}:`, error)
                }
            }
            await updateJob(jobId, { receivedChapters: chapters.length })
        }

        const allChapterNumbers = Array.from({ length: totalEpisodes }, (_, index) => index + 1)
        const initialMissing = findMissingOutlineChapterNumbers(allChapterNumbers, chapters)
        if (initialMissing.length > 0) {
            await updateJob(jobId, { phase: 'filling' })
            try {
                const rawFilled = await fillMissingChapters({
                    title: project.title,
                    genre: project.genre ?? undefined,
                    description: project.description ?? undefined,
                    totalEpisodes,
                    setup,
                    sourceNovel: project.novel,
                    existingChapters: chapters,
                    missingChapterNumbers: initialMissing,
                    onHiModelsResponse,
                    onTokenUsage
                })
                await assertJobActive(jobId)
                const filled = selectUsableOutlineChapters(rawFilled, initialMissing)
                const known = new Set(chapters.map(c => c.chapterNumber))
                for (const c of filled) {
                    if (!known.has(c.chapterNumber)) chapters.push(c)
                }
                await persistOutlineChapters(projectId, project, filled, totalEpisodes, jobId)
                await updateJob(jobId, { receivedChapters: chapters.length })
            } catch (err) {
                console.warn('[outline] fill missing chapters failed:', err)
            }
        }

        await assertJobActive(jobId)
        await updateJob(jobId, { phase: 'writing_db' })

        const received = new Set(chapters.map(c => c.chapterNumber))
        const missingNumbers: number[] = []
        for (let n = 1; n <= totalEpisodes; n++) {
            if (!received.has(n)) missingNumbers.push(n)
        }
        let seriesQuality: Record<string, number> | undefined
        if (missingNumbers.length === 0) {
            const contractIssues = validateOutlineContract(chapters, allChapterNumbers)
            if (contractIssues.length > 0) throw new Error(`大纲合同校验失败：${contractIssues.map(issue => issue.message).join('；')}`)
            await updateJob(jobId, { phase: 'filling' })
            const reviewed = await reviewAndRepairCompleteOutline({
                jobId,
                title: project.title,
                totalEpisodes,
                setup,
                chapters,
                sourceNovel: project.novel,
                onHiModelsResponse,
                onTokenUsage
            })
            chapters.splice(0, chapters.length, ...reviewed.chapters)
            if (reviewed.repaired.length > 0) await persistOutlineChapters(projectId, project, reviewed.repaired, totalEpisodes, jobId)
            seriesQuality = reviewed.review.scores
            await persistOutline(
                projectId,
                project,
                chapters,
                totalEpisodes,
                setup,
                jobId,
                tx => chargeLlmUsage({ userId, jobId, task: '分集大纲生成', input: billingInput, output: chapters, tx }),
                reviewed.review
            )
        } else {
            await withActiveOutlineWrite(projectId, project.operationVersion, jobId, tx => chargeLlmUsage({ userId, jobId, task: '分集大纲生成', input: billingInput, output: chapters, tx }))
        }

        await updateJob(jobId, {
            phase: 'done',
            result: {
                count: chapters.length,
                seriesQuality,
                ...usage.snapshot(),
                requested: totalEpisodes,
                missing: missingNumbers,
                warning:
                    missingNumbers.length > 0
                        ? `要求 ${totalEpisodes} 章，当前仅有 ${chapters.length} 章通过结构与连续性校验。缺失或不合格章节：${missingNumbers.join(', ')}。项目不会进入大纲完成态，请点击“继续生成剩余大纲”。`
                        : undefined
            }
        })
    } catch (err) {
        await updateJob(jobId, {
            phase: 'error',
            error: err instanceof Error ? err.message : String(err),
            result: usage.snapshot()
        })
    } finally {
        clearInterval(heartbeat)
    }
}

async function persistOutlineChapters(
    projectId: bigint,
    project: { operationVersion: number; episodes: Array<{ id: bigint; episodeNumber: number }> },
    chapters: GeneratedOutlineChapter[],
    totalEpisodes: number,
    jobId: string
) {
    const resets = await withActiveOutlineWrite(projectId, project.operationVersion, jobId, async tx => {
        const completed = []
        for (const data of chapters) {
            const n = data.chapterNumber
            if (n < 1 || n > totalEpisodes) continue
            const intensity = typeof data.intensity === 'number' && Number.isFinite(data.intensity) ? Math.max(1, Math.min(10, Math.round(data.intensity))) : 5
            const existing = project.episodes.find(e => e.episodeNumber === n)
            if (existing) {
                await tx.$queryRaw`SELECT id FROM episodes WHERE id = ${existing.id} FOR UPDATE`
                const current = await tx.episode.findUnique({ where: { id: existing.id } })
                if (!current || current.deletedAt) throw new Error('章节已重置，请重新生成大纲')
                const reset = await resetEpisodeDownstreamInTransaction(tx, current, 'outline')
                completed.push(reset)
                await tx.episode.update({
                    where: { id: existing.id },
                    data: {
                        ...reset.patch,
                        title: data.title ?? `第${n}章`,
                        synopsis: data.synopsis ?? null,
                        intensity,
                        status: 'outlined',
                        stateSnapshot: {
                            episodeNumber: n,
                            coldOpen: data.coldOpen ?? '',
                            protagonistGoal: data.protagonistGoal ?? '',
                            primaryObstacle: data.primaryObstacle ?? '',
                            escalation: data.escalation ?? '',
                            irreversibleChoice: data.irreversibleChoice ?? '',
                            cost: data.cost ?? '',
                            reversal: data.reversal ?? '',
                            informationGain: data.informationGain ?? '',
                            cliffhanger: data.cliffhanger ?? '',
                            setupPayoffs: data.setupPayoffs ?? [],
                            openingState: data.openingState ?? '',
                            endingState: data.endingState ?? '',
                            characterStateChanges: data.characterStateChanges ?? '',
                            continuityBridge: data.continuityBridge ?? '',
                            requiredEvents: data.requiredEvents ?? []
                        } as Prisma.InputJsonValue,
                        contentFacts: buildEpisodeFactSnapshot({
                            episodeNumber: n,
                            synopsis: data.synopsis,
                            statePlan: {
                                episodeNumber: n,
                                coldOpen: data.coldOpen,
                                protagonistGoal: data.protagonistGoal,
                                primaryObstacle: data.primaryObstacle,
                                escalation: data.escalation,
                                irreversibleChoice: data.irreversibleChoice,
                                cost: data.cost,
                                reversal: data.reversal,
                                informationGain: data.informationGain,
                                cliffhanger: data.cliffhanger,
                                setupPayoffs: data.setupPayoffs ?? [],
                                openingState: data.openingState,
                                endingState: data.endingState,
                                characterStateChanges: data.characterStateChanges,
                                continuityBridge: data.continuityBridge,
                                requiredEvents: data.requiredEvents ?? []
                            }
                        }) as unknown as Prisma.InputJsonValue,
                        sourceVersion: { increment: 1 },
                        operationVersion: { increment: 1 },
                        staleReason: null
                    }
                })
            } else {
                const created = await tx.episode.create({
                    data: {
                        id: genId(),
                        projectId,
                        episodeNumber: n,
                        title: data.title ?? `第${n}章`,
                        synopsis: data.synopsis,
                        intensity,
                        status: 'outlined',
                        stateSnapshot: {
                            episodeNumber: n,
                            coldOpen: data.coldOpen ?? '',
                            protagonistGoal: data.protagonistGoal ?? '',
                            primaryObstacle: data.primaryObstacle ?? '',
                            escalation: data.escalation ?? '',
                            irreversibleChoice: data.irreversibleChoice ?? '',
                            cost: data.cost ?? '',
                            reversal: data.reversal ?? '',
                            informationGain: data.informationGain ?? '',
                            cliffhanger: data.cliffhanger ?? '',
                            setupPayoffs: data.setupPayoffs ?? [],
                            openingState: data.openingState ?? '',
                            endingState: data.endingState ?? '',
                            characterStateChanges: data.characterStateChanges ?? '',
                            continuityBridge: data.continuityBridge ?? '',
                            requiredEvents: data.requiredEvents ?? []
                        } as Prisma.InputJsonValue,
                        contentFacts: buildEpisodeFactSnapshot({ episodeNumber: n, synopsis: data.synopsis, statePlan: { episodeNumber: n, ...data } }) as unknown as Prisma.InputJsonValue
                    }
                })
                project.episodes.push({ id: created.id, episodeNumber: n })
            }
        }
        return completed
    })
    await Promise.all(resets.map(finishEpisodeDownstreamReset))
}

async function persistOutline(
    projectId: bigint,
    project: { operationVersion: number; episodes: Array<{ id: bigint; episodeNumber: number }> },
    chapters: GeneratedOutlineChapter[],
    totalEpisodes: number,
    setup: NovelSetup,
    jobId: string,
    settleUsage: (tx: Prisma.TransactionClient) => Promise<unknown>,
    seriesReview?: OutlineSeriesReview
) {
    const requestedNumbers = Array.from({ length: totalEpisodes }, (_, index) => index + 1)
    const contractIssues = validateOutlineContract(chapters, requestedNumbers)
    if (contractIssues.length > 0) throw new Error(`大纲合同校验失败，禁止覆盖现有内容：${contractIssues.map(issue => issue.message).join('；')}`)
    const received = new Map(chapters.map(c => [c.chapterNumber, c]))

    const clampIntensity = (v: number | undefined) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return null
        return Math.max(1, Math.min(10, Math.round(v)))
    }

    const fallbackIntensity = (i: number, total: number) => {
        if (total <= 1) return 5
        const pos = i / (total - 1)
        const climax = 0.85
        const distance = Math.abs(pos - climax)
        const peak = Math.max(0, 1 - Math.pow(distance / 0.55, 2))
        const raw = 2 + 8 * peak + (pos < climax ? pos * 1.5 : -(pos - climax) * 3)
        return Math.max(1, Math.min(10, Math.round(raw)))
    }

    const anyReturnedIntensity = chapters.some(c => clampIntensity(c.intensity) != null)
    const episodeStatePlan = chapters
        .filter(c => c.chapterNumber >= 1 && c.chapterNumber <= totalEpisodes)
        .map(c => ({
            episodeNumber: c.chapterNumber,
            openingState: c.openingState ?? '',
            endingState: c.endingState ?? '',
            characterStateChanges: c.characterStateChanges ?? '',
            continuityBridge: c.continuityBridge ?? '',
            requiredEvents: c.requiredEvents ?? [],
            coldOpen: c.coldOpen ?? '',
            protagonistGoal: c.protagonistGoal ?? '',
            primaryObstacle: c.primaryObstacle ?? '',
            escalation: c.escalation ?? '',
            irreversibleChoice: c.irreversibleChoice ?? '',
            cost: c.cost ?? '',
            reversal: c.reversal ?? '',
            informationGain: c.informationGain ?? '',
            cliffhanger: c.cliffhanger ?? '',
            setupPayoffs: c.setupPayoffs ?? []
        }))
        .filter(item => item.openingState || item.endingState || item.characterStateChanges || item.continuityBridge)

    await withActiveOutlineWrite(projectId, project.operationVersion, jobId, async tx => {
        await settleUsage(tx)
        // Checkpoints already saved the complete outline. Do not clear prose/scripts
        // created from those checkpoints while the remaining outline was generating.
        for (const existing of project.episodes) {
            const n = existing.episodeNumber
            if (n < 1 || n > totalEpisodes) continue
            const intensity = clampIntensity(received.get(n)?.intensity) ?? (!anyReturnedIntensity ? fallbackIntensity(n - 1, totalEpisodes) : 5)
            await tx.episode.update({ where: { id: existing.id }, data: { intensity } })
        }

        await tx.project.update({
            where: { id: projectId },
            data: {
                novelStage: 'outlined',
                status: 'in_production',
                contentFacts: episodeStatePlan.map(state =>
                    buildEpisodeFactSnapshot({ episodeNumber: state.episodeNumber, synopsis: received.get(state.episodeNumber)?.synopsis, statePlan: state })
                ) as unknown as Prisma.InputJsonValue,
                sourceVersion: { increment: 1 },
                novelSetup: stringifyNovelSetup({
                    ...setup,
                    episodeStatePlan,
                    ...(seriesReview ? { outlineQuality: seriesReview } : {}),
                    factLedger: episodeStatePlan.map(state =>
                        buildEpisodeFactSnapshot({ episodeNumber: state.episodeNumber, synopsis: received.get(state.episodeNumber)?.synopsis, statePlan: state })
                    ),
                    promptVersions: { ...(setup.promptVersions ?? {}), outline: CONTENT_CONTRACT_VERSION }
                })
            }
        })
    })
}
