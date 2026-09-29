import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { issueSessionToken } from '@/lib/session-token'
import { GET as imageStatus } from '@/app/api/create/image/status/[jobId]/route'
import { GET as referenceStatus } from '@/app/api/characters/[id]/reference/status/[jobId]/route'

const mocks = vi.hoisted(() => ({ getJob: vi.fn(), assertCharacterOwner: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/projectAiJobStore', () => ({ getJob: mocks.getJob }))
vi.mock('@/lib/refImageJobStore', () => ({ getJob: mocks.getJob }))
vi.mock('@/lib/ownership', () => ({ assertCharacterOwner: mocks.assertCharacterOwner }))
vi.mock('@/lib/prisma', () => ({ prisma: { hiModelsCall: { findMany: mocks.findMany } } }))

beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('APP_SESSION_SECRET', 'unit-test-only-secret')
    mocks.assertCharacterOwner.mockResolvedValue(null)
    mocks.findMany.mockResolvedValue([
        {
            callId: 'actual-model-call',
            model: 'gemini-3.1-flash-image',
            operationKey: 'one-image',
            endpoint: '/v1/images/generations',
            httpStatus: 200,
            captureState: 'received',
            requestId: 'provider-request',
            sentAt: new Date(),
            receivedAt: new Date(),
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, raw: { totalTokenCount: 30 } },
            rawUsage: { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } }
        }
    ])
})
afterEach(() => vi.unstubAllEnvs())

describe('HiModels status outputs independent of job result JSON and debug flags', () => {
    const request = () => new NextRequest('https://studio.test/api/status', { headers: { Authorization: `Bearer ${issueSessionToken({ userId: 1n, email: 'test@example.test' })}` } })
    it.each(['generating', 'done', 'error'])('returns creator usage when phase=%s even if final results contain only assets', async phase => {
        vi.stubEnv('HIMODELS_RESPONSE_DIAGNOSTICS', 'false')
        mocks.getJob.mockResolvedValue({ id: '2', projectId: '1', kind: 'creator_image', phase, result: { asset: { url: 'https://cdn.test/image.png' } } })
        const data = (await (await imageStatus(request(), { params: Promise.resolve({ jobId: '2' }) })).json()).data
        expect(data.tokenUsage).toMatchObject({ inputTokens: 10, outputTokens: 20, totalTokens: 30, complete: true })
        expect(data.himodelsUsageCalls[0]).toMatchObject({ id: 'actual-model-call', rawUsage: { usageMetadata: { totalTokenCount: 30 } } })
        expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: 1n, OR: [{ jobId: 2n }, { parentJobId: 2n }] }, orderBy: { id: 'asc' } })
    })

    it('returns reference usage even after saving the generated image fails', async () => {
        mocks.getJob.mockResolvedValue({ id: '2', targetId: '3', targetType: 'character', phase: 'error', error: 'image upload failed' })
        const data = (await (await referenceStatus(request(), { params: Promise.resolve({ id: '3', jobId: '2' }) })).json()).data
        expect(data.tokenUsage.totalTokens).toBe(30)
        expect(data.error).toBe('image upload failed')
    })

    it('checks resource ownership before reading usage', async () => {
        mocks.getJob.mockResolvedValue({ id: '2', projectId: '999', kind: 'creator_image' })
        expect((await imageStatus(request(), { params: Promise.resolve({ jobId: '2' }) })).status).toBe(404)
        mocks.getJob.mockResolvedValue({ id: '2', targetId: '3', targetType: 'character' })
        mocks.assertCharacterOwner.mockResolvedValue(new Response(null, { status: 404 }))
        expect((await referenceStatus(request(), { params: Promise.resolve({ id: '3', jobId: '2' }) })).status).toBe(404)
        expect(mocks.findMany).not.toHaveBeenCalled()
    })
})

describe('HiModels workflow wiring', () => {
    const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    it.each(['chapter', 'expand-prompt', 'novel', 'outline', 'script', 'setup', 'split-episodes', 'story-directions', 'storyboard'])(
        'binds %s inside after and exposes persisted usage on its status endpoint',
        task => {
            expect(source(`src/app/api/ai/${task}/route.ts`)).toMatch(/after\(\(\) =>\s*withHiModelsUsageScope\(\{ userId, jobId: job.id(?:, [^}]+)? \}/)
            expect(source(`src/app/api/ai/${task}/status/[jobId]/route.ts`)).toContain('readHiModelsUsage(userId, { jobId: job.id })')
        }
    )
    it.each([
        'src/app/api/ai/extract/status/[jobId]/route.ts',
        'src/app/api/create/image/status/[jobId]/route.ts',
        'src/app/api/create/video/job/[jobId]/route.ts',
        'src/app/api/scenes/[id]/reference/status/[jobId]/route.ts',
        'src/app/api/characters/[id]/reference/status/[jobId]/route.ts',
        'src/app/api/projects/[id]/character-references/status/[jobId]/route.ts',
        'src/app/api/projects/[id]/style-reference/status/[jobId]/route.ts',
        'src/app/api/projects/import/status/[jobId]/route.ts',
        'src/app/api/episodes/[id]/generate-all/status/[jobId]/route.ts'
    ])('exposes ledger usage from %s', file => {
        expect(source(file)).toContain('readHiModelsUsage(userId, { jobId: job.id })')
    })
    it('captures all four provider endpoints before downstream processing', () => {
        const provider = source('src/services/himodels.ts')
        expect(provider.match(/await fetchHiModels\(|=>\s*fetchHiModels\(/g)).toHaveLength(4)
        const wrapper = source('src/services/himodels-http.ts')
        expect(wrapper.indexOf('await startHiModelsUsage')).toBeLessThan(wrapper.indexOf('await fetchWithProviderQuota(url, {'))
        expect(wrapper.indexOf('call.usage = extractApiTokenUsage')).toBeLessThan(wrapper.indexOf('if (!diagnostics) return response'))
    })
})
