import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { prisma } from '@/lib/prisma'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { apiResponse, apiError } from '@/lib/utils'
import { parseNovelSetup } from '@/lib/novel'
import { generateNovel } from '@/services/llm'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { parseApiId } from '@/lib/api-id'

// AI 写小说：立即返回 jobId，后台跑 LLM。前端轮询 /api/ai/novel/status/[jobId]。
// 同步版本在网关层会触发 upstream request timeout（60s）。
export const maxDuration = 300

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { projectId: rawProjectId } = await req.json()
    if (!rawProjectId) return apiError('projectId required')
    const projectId = parseApiId(rawProjectId)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null }
    })
    if (!project) return apiError('Project not found', 404)
    const billingInput = { title: project.title, genre: project.genre, description: project.description, totalEpisodes: project.totalEpisodes, setup: parseNovelSetup(project.novelSetup) }
    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(billingInput, 16_000))
    } catch (billingError) {
        if (billingError instanceof BillingError) return apiError(billingError.message, billingError.status)
        throw billingError
    }

    const job = await createJob(projectId.toString(), 'novel')
    after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runNovelJob(job.id, project, userId, billingInput)))
    return apiResponse({ jobId: job.id })
}

type Project = NonNullable<Awaited<ReturnType<typeof prisma.project.findFirst>>>

async function runNovelJob(jobId: string, project: Project, userId: bigint, billingInput: Record<string, unknown>) {
    try {
        await updateJob(jobId, { attempts: 1 })
        const novel = await generateNovel({
            title: project.title,
            genre: project.genre ?? undefined,
            description: project.description ?? undefined,
            totalEpisodes: project.totalEpisodes ?? 1,
            setup: parseNovelSetup(project.novelSetup)
        })
        await updateJob(jobId, { phase: 'writing_db' })
        await prisma.$transaction(async tx => {
            await updateJob(jobId, { phase: 'writing_db' }, tx)
            await chargeLlmUsage({ userId, jobId, task: '小说生成', input: billingInput, output: novel, tx })
            await tx.project.update({ where: { id: project.id }, data: { novel, status: 'in_production' } })
        }, BILLING_TRANSACTION_OPTIONS)

        await updateJob(jobId, {
            phase: 'done',
            result: { novel }
        })
    } catch (err) {
        await updateJob(jobId, {
            phase: 'error',
            error: err instanceof Error ? err.message : String(err)
        })
    }
}
