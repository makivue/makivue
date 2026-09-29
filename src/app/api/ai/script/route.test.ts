import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    episode: vi.fn(),
    model: vi.fn(),
    configured: vi.fn(),
    createJob: vi.fn(),
    balance: vi.fn()
}))
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: mocks.after }))
vi.mock('@/lib/prisma', () => ({ prisma: { episode: { findFirst: mocks.episode }, aiServiceConfig: { findUnique: mocks.model } } }))
vi.mock('@/lib/current-user', () => ({ currentUserId: () => 7n }))
vi.mock('@/lib/ownership', () => ({ assertEpisodeOwner: vi.fn().mockResolvedValue(null) }))
vi.mock('@/services/llm', () => ({ assertTextModelConfigured: mocks.configured }))
vi.mock('@/services/script-generation', () => ({ generateReviewedScript: vi.fn() }))
vi.mock('@/lib/scriptJobStore', () => ({ createJob: mocks.createJob, updateJob: vi.fn() }))
vi.mock('@/services/billing', () => ({ assertSufficientPoints: mocks.balance, quoteLlmBudgetPoints: () => 1, BillingError: class extends Error {}, chargeLlmUsage: vi.fn() }))

import { POST } from './route'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.episode.mockResolvedValue({ id: 11n, projectId: 1n, episodeNumber: 11, status: 'finalized', chapterContent: '正文', project: { id: 1n, title: '测试项目' } })
    mocks.model.mockResolvedValue({ modelName: 'gemini-3.7-flash' })
    mocks.createJob.mockResolvedValue({ id: 'job-11', createdByRequest: true })
    mocks.configured.mockResolvedValue(undefined)
})

const request = () => new NextRequest('http://localhost/api/ai/script', { method: 'POST', body: JSON.stringify({ episodeId: '11' }) })

describe('script configuration preflight', () => {
    it('returns model-not-configured before creating, scheduling or billing a task', async () => {
        mocks.configured.mockRejectedValue(new Error('Himodels API key 未配置，请在 .env 填写自己的 HIMODELS_API_KEY'))
        const response = await POST(request())
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
            success: false,
            error: '拆剧本模型未配置。请联系管理员完成模型配置，或选择其他已配置的模型后重试。',
            code: 'MODEL_NOT_CONFIGURED',
            model: 'gemini-3.7-flash',
            retryable: false
        })
        expect(mocks.balance).not.toHaveBeenCalled()
        expect(mocks.createJob).not.toHaveBeenCalled()
        expect(mocks.after).not.toHaveBeenCalled()
    })

    it('does not expose malformed credential contents in the public error', async () => {
        mocks.configured.mockRejectedValue(new Error('Nano Banana credentials unavailable: Unexpected token fixture-private-value'))
        const response = await POST(request())
        const body = await response.json()
        expect(body).toMatchObject({ code: 'MODEL_CONFIGURATION_INVALID', retryable: false })
        expect(body.error).toContain('拆剧本模型配置无效')
        expect(JSON.stringify(body)).not.toContain('fixture-private-value')
        expect(mocks.createJob).not.toHaveBeenCalled()
    })

    it('accepts a job only after checking the exact selected model', async () => {
        const response = await POST(request())
        expect(response.status).toBe(200)
        expect(mocks.configured).toHaveBeenCalledWith('gemini-3.7-flash')
        expect(mocks.createJob).toHaveBeenCalledTimes(1)
        expect(mocks.after).toHaveBeenCalledTimes(1)
    })
})
