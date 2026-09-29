import { after, NextRequest } from 'next/server'
import { withHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { generatePersonalStoryDirections } from '@/services/llm'
import { assertSufficientPoints, BillingError, chargeLlmUsage, quoteLlmBudgetPoints } from '@/services/billing'
import { createJob, updateJob } from '@/lib/projectAiJobStore'
import { prisma } from '@/lib/prisma'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'

export const maxDuration = 180

export async function POST(req: NextRequest) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)

    const body = await req.json()
    const answers = body?.answers
    if (!answers || typeof answers !== 'object') return apiError('answers required')

    const meaningfulText = Object.values(answers)
        .filter(value => typeof value === 'string')
        .join(' ')
        .trim()
    if (meaningfulText.length < 8) return apiError('请至少写下一些故事线索')

    try {
        await assertSufficientPoints(userId, quoteLlmBudgetPoints(answers, 2_000))
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        throw error
    }

    const job = await createJob(userId.toString(), 'story_directions')
    // `after` registers the promise with Next.js so Docker/server shutdown can
    // drain it, unlike a detached `void` promise that the runtime cannot track.
    after(() => withHiModelsUsageScope({ userId, jobId: job.id }, () => runStoryDirectionsJob(job.id, userId, answers)))
    return apiResponse({ jobId: job.id }, 202)
}

async function runStoryDirectionsJob(jobId: string, userId: bigint, answers: Record<string, unknown>) {
    try {
        await updateJob(jobId, { attempts: 1 })
        const result = await generatePersonalStoryDirections(answers)
        await prisma.$transaction(async tx => {
            await updateJob(jobId, { phase: 'done', result }, tx)
            await chargeLlmUsage({ userId, jobId: `story-directions:${jobId}`, task: '故事方向生成', input: answers, output: result, tx })
        }, BILLING_TRANSACTION_OPTIONS)
    } catch (error) {
        await updateJob(jobId, {
            phase: 'error',
            error: error instanceof Error ? error.message : '故事方向生成失败'
        })
    }
}
