import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { apiResponse, apiError, handleApiError } from '@/lib/utils'
import { getVisualStyleForSetup, getVisualStyleProfile, parseNovelSetup } from '@/lib/novel'
import { formatVisualStyleProfile } from '@/lib/visual-style-profile'
import { extractCharactersAndScenesBatched } from '@/services/llm'
import { createOrReuseActiveJob, getActiveJob, updateJob } from '@/lib/extractJobStore'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { extractionActiveKey } from '@/lib/extract-fingerprint'

// 启动一次异步提取任务，立即返回 jobId；前端轮询 /api/ai/extract/status/[jobId]
export const maxDuration = 600

async function startExtraction(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { projectId, resumeFromJobId } = await req.json()
    if (!projectId) return apiError('projectId required')
    const projectIdNum = parseApiId(projectId)
    if (projectIdNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectIdNum, userId)
    if (guard) return guard

    const project = await prisma.project.findFirst({
        where: { id: projectIdNum, deletedAt: null },
        include: {
            episodes: { where: { deletedAt: null }, orderBy: { episodeNumber: 'asc' } },
            characters: { where: { deletedAt: null } },
            scenes: { where: { deletedAt: null } }
        }
    })
    if (!project) return apiError('Project not found', 404)
    const projectSetup = parseNovelSetup(project.novelSetup)
    const visualStyle = getVisualStyleForSetup(projectSetup)
    const visualStyleProfile = getVisualStyleProfile(projectSetup)
    const { activeKey, withScripts } = extractionActiveKey(projectId, project.episodes, visualStyleProfile)

    if (withScripts.length === 0) return apiError('没有可用的剧本内容')
    if (project.novelStage !== 'scripted') {
        if (withScripts.length !== project.episodes.length) {
            return apiError('请先完成「拆分剧本」后再提取角色和场景')
        }
        // Repair projects imported by older flows that persisted every script
        // but failed to advance the aggregate project stage.
        await prisma.project.update({ where: { id: project.id }, data: { novelStage: 'scripted' } })
    }
    const activeJob = await getActiveJob(projectId, activeKey)
    if (activeJob) {
        return apiResponse({ jobId: activeJob.id, resumed: true })
    }
    const visualStyleContext = [
        formatVisualStyleProfile(visualStyleProfile),
        `图片风格前缀：${visualStyle.imagePromptPrefix}`,
        visualStyle.negativePrompt ? `负面约束：${visualStyle.negativePrompt}` : null
    ]
        .filter(Boolean)
        .join('\n')
    const billingInput = { episodes: withScripts, existingCharacterNames: project.characters.map(c => c.name), existingSceneNames: project.scenes.map(s => s.name), visualStyleContext }
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, Math.max(4_000, withScripts.length * 2_000)))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const { job, resumed } = await createOrReuseActiveJob(projectId, typeof resumeFromJobId === 'string' ? resumeFromJobId : undefined, activeKey)
    if (resumed) {
        return apiResponse({ jobId: job.id, resumed: true })
    }

    after(() =>
        withHiModelsUsageScope({ userId, jobId: job.id }, async () => {
            const heartbeat = setInterval(() => {
                void updateJob(job.id, {})
            }, 60_000)
            try {
                const { characters, scenes, chunkCount } = await extractCharactersAndScenesBatched({
                    episodes: withScripts,
                    existingCharacterNames: project.characters.map(c => c.name),
                    existingSceneNames: project.scenes.map(s => s.name),
                    visualStyleContext,
                    chunkTargetChars: 6000,
                    concurrency: 3,
                    resume:
                        job.chunksDone > 0 && job.result
                            ? {
                                  chunksDone: job.chunksDone,
                                  characters: job.result.characters,
                                  scenes: job.result.scenes
                              }
                            : undefined,
                    onChunkProgress: async (done, total, checkpoint) => {
                        await updateJob(job.id, {
                            chunksDone: done,
                            chunksTotal: total,
                            phase: 'analyzing',
                            result: { ...checkpoint, chunkCount: total }
                        })
                    },
                    onMergeStart: () => updateJob(job.id, { phase: 'merging' })
                })
                await prisma.$transaction(async tx => {
                    await updateJob(job.id, { phase: 'done', charactersFound: characters.length, scenesFound: scenes.length, result: { characters, scenes, chunkCount } }, tx)
                    await chargeLlmUsage({ userId, jobId: job.id, task: '角色与场景提取', input: billingInput, output: { characters, scenes }, tx })
                }, BILLING_TRANSACTION_OPTIONS)
            } catch (err) {
                await updateJob(job.id, {
                    phase: 'error',
                    error: err instanceof Error ? err.message : String(err)
                })
            } finally {
                clearInterval(heartbeat)
            }
        })
    )

    return apiResponse({ jobId: job.id, resumed: false, resumedChunks: job.chunksDone })
}

export async function POST(req: NextRequest) {
    try {
        return await startExtraction(req)
    } catch (error) {
        console.error('[extract/preview] failed to start extraction:', error)
        return handleApiError(error, '启动角色与场景提取失败')
    }
}
