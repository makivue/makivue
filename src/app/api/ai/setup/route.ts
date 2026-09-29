import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { apiError, apiResponse } from '@/lib/utils'
import { parseNovelSetup, stringifyNovelSetup, type NovelSetup } from '@/lib/novel'
import { generateNovelSetup, repairNovelSetupStatePlan } from '@/services/llm'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { buildEpisodeFactSnapshot, CONTENT_CONTRACT_VERSION, validateEpisodeStatePlan } from '@/lib/content-contracts'
import { syncSetupCharactersInTransaction } from '@/services/setup-characters'
import { presentSetupJobError } from '@/lib/setup-job-error'
import type { Prisma } from '@/generated/prisma/client'

// 生成小说 setup：立即返回 jobId，后台跑 LLM。前端轮询 /api/ai/setup/status/[jobId]。
export const maxDuration = 300

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { projectId: rawProjectId, setup: setupOverride } = await req.json()
    if (!rawProjectId) return apiError('projectId required')
    const projectId = parseApiId(rawProjectId)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null }
    })
    if (!project) return apiError('Project not found', 404)

    const currentSetup = parseNovelSetup(project.novelSetup)
    const requestedSetup = typeof setupOverride === 'object' && setupOverride ? (setupOverride as Partial<NovelSetup>) : {}
    const baseSetup: NovelSetup = {
        ...currentSetup,
        ...requestedSetup,
        // 视觉/比例属于制作设置，AI 生成故事架构时不能覆盖。
        visualStyle: currentSetup.visualStyle,
        visualStyleProfile: currentSetup.visualStyleProfile,
        videoAspectRatio: currentSetup.videoAspectRatio,
        styleReferenceImages: currentSetup.styleReferenceImages,
        styleReferencePrompt: currentSetup.styleReferencePrompt,
        contentLanguage: currentSetup.contentLanguage
    }
    const billingInput = {
        title: project.title,
        genre: project.genre,
        description: project.description,
        totalEpisodes: project.totalEpisodes,
        setup: baseSetup,
        sourceNovel: project.novel,
        sourceAnswers: project.sourceAnswers,
        directionCandidates: project.directionCandidates,
        selectedDirectionId: project.selectedDirectionId
    }
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, 4_000))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const job = await createJob(projectId.toString(), 'setup')
    after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runSetupJob(job.id, project, baseSetup, userId, billingInput)))
    return apiResponse({ jobId: job.id })
}

type Project = NonNullable<Awaited<ReturnType<typeof prisma.project.findFirst>>>

async function runSetupJob(jobId: string, project: Project, baseSetup: NovelSetup, userId: bigint, billingInput: Record<string, unknown>) {
    try {
        await updateJob(jobId, { attempts: 1 })
        const generated = await generateNovelSetup({
            title: project.title,
            genre: project.genre ?? undefined,
            description: project.description ?? undefined,
            totalEpisodes: project.totalEpisodes ?? 1,
            setup: baseSetup,
            sourceNovel: project.novel,
            sourceAnswers: project.sourceAnswers,
            directionCandidates: project.directionCandidates,
            selectedDirectionId: project.selectedDirectionId
        })

        let nextSetup: NovelSetup = {
            ...baseSetup,
            ...generated,
            primaryGenre: baseSetup.primaryGenre || project.genre || generated.primaryGenre || '',
            visualStyle: baseSetup.visualStyle,
            visualStyleProfile: baseSetup.visualStyleProfile,
            videoAspectRatio: baseSetup.videoAspectRatio,
            styleReferenceImages: baseSetup.styleReferenceImages,
            styleReferencePrompt: baseSetup.styleReferencePrompt,
            contentLanguage: baseSetup.contentLanguage
        }
        let stateIssues = validateEpisodeStatePlan(nextSetup.episodeStatePlan, project.totalEpisodes ?? 1)
        if (stateIssues.length > 0) {
            nextSetup = {
                ...nextSetup,
                episodeStatePlan: await repairNovelSetupStatePlan({
                    title: project.title,
                    totalEpisodes: project.totalEpisodes ?? 1,
                    setup: nextSetup,
                    issues: stateIssues
                })
            }
            stateIssues = validateEpisodeStatePlan(nextSetup.episodeStatePlan, project.totalEpisodes ?? 1)
        }
        if (stateIssues.length > 0) throw new Error(`故事架构连续性校验失败：${stateIssues.map(issue => issue.message).join('；')}`)

        const factLedger = (nextSetup.episodeStatePlan ?? []).map(state => buildEpisodeFactSnapshot({ episodeNumber: state.episodeNumber, statePlan: state, sourceVersion: project.sourceVersion + 1 }))
        nextSetup = {
            ...nextSetup,
            factLedger,
            fieldSources: {
                ...(baseSetup.fieldSources ?? {}),
                coreSeed: 'model',
                mainCharacters: 'model',
                supportingCharacters: 'model',
                episodeStatePlan: 'model_validated',
                visualStyle: 'inherited',
                visualStyleProfile: 'inherited',
                videoAspectRatio: 'inherited'
            },
            promptVersions: { ...(baseSetup.promptVersions ?? {}), setup: CONTENT_CONTRACT_VERSION }
        }
        await updateJob(jobId, { phase: 'writing_db' })
        const characterSync = await prisma.$transaction(async tx => {
            await updateJob(jobId, { phase: 'writing_db' }, tx)
            await chargeLlmUsage({ userId, jobId, task: '故事架构生成', input: billingInput, output: nextSetup, tx })
            await tx.project.update({
                where: { id: project.id },
                data: {
                    novelSetup: stringifyNovelSetup(nextSetup),
                    contentFacts: factLedger as unknown as Prisma.InputJsonValue,
                    sourceVersion: { increment: 1 }
                }
            })
            return syncSetupCharactersInTransaction(tx, project.id, nextSetup)
        }, BILLING_TRANSACTION_OPTIONS)

        await updateJob(jobId, {
            phase: 'done',
            result: { setup: nextSetup, characterSync, contractVersion: CONTENT_CONTRACT_VERSION }
        })
    } catch (err) {
        await updateJob(jobId, {
            phase: 'error',
            error: presentSetupJobError(err)
        })
    }
}
