import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
    currentUserId: vi.fn<() => bigint | null>(),
    requireAdminPermission: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
    genId: vi.fn(() => 101n)
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/admin-permissions', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/id', () => ({ genId: mocks.genId }))
vi.mock('@/lib/prisma', () => ({
    prisma: {
        aiServiceConfig: {
            upsert: mocks.upsert,
            findMany: mocks.findMany
        }
    }
}))
vi.mock('@/services/llm', () => ({ normalizeTextModel: (value: unknown) => value }))

import { GET, POST } from './route'

function post(body: unknown) {
    return POST(
        new NextRequest('https://app.example.com/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })
    )
}

describe('settings model preference permissions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.currentUserId.mockReturnValue(7n)
        mocks.requireAdminPermission.mockResolvedValue({
            access: null,
            response: new Response(JSON.stringify({ success: false, error: '没有执行此操作的权限' }), { status: 403 })
        })
        mocks.upsert.mockImplementation(async ({ where, update }: { where: { provider: string }; update: { modelName?: string | null } }) => ({
            id: 101n,
            provider: where.provider,
            apiKey: 'server-secret',
            baseUrl: 'https://provider.example.com',
            modelName: update.modelName,
            extra: null
        }))
    })

    it.each(['seedance', 'seedance25', 'wan3', 'wan3prime', 'seedance-2.0-global', 'MiniMax-H3'] as const)('lets any signed-in member switch to the supported %s model', async modelName => {
        const response = await post({ provider: 'video', modelName })

        expect(response.status).toBe(200)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).toHaveBeenCalledWith({
            where: { provider: 'video' },
            update: { modelName },
            create: { id: 101n, provider: 'video', modelName },
            select: { provider: true, modelName: true }
        })
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            data: { provider: 'video', modelName }
        })
    })

    it('rejects unsupported video models', async () => {
        const response = await post({ provider: 'video', modelName: 'unknown-video-model' })

        expect(response.status).toBe(400)
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it.each(['wanx', 'veo3', 'veo-3.1-generate-001', 'veo-3.1-fast-generate-001', 'veo-3.1-lite-generate-001'])('rejects the retired %s video model', async modelName => {
        const response = await post({ provider: 'video', modelName })

        expect(response.status).toBe(400)
        expect(mocks.upsert).not.toHaveBeenCalled()
        await expect(response.json()).resolves.toMatchObject({ success: false, error: '不支持的视频模型' })
    })

    it.each(['zh', 'en'] as const)('lets any signed-in member switch video speech to %s', async modelName => {
        const response = await post({ provider: 'video_language', modelName })

        expect(response.status).toBe(200)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).toHaveBeenCalledWith({
            where: { provider: 'video_language' },
            update: { modelName },
            create: { id: 101n, provider: 'video_language', modelName },
            select: { provider: true, modelName: true }
        })
    })

    it.each([
        ['openai', 'gemini-3.7-flash'],
        ['chapter_model', 'gemini:gemini-3.7-flash'],
        ['script_model', 'gemini:gemini-3.7-flash'],
        ['image', 'banana'],
        ['image_quality', 'clear']
    ])('lets any signed-in member switch the %s preference', async (provider, modelName) => {
        const response = await post({ provider, modelName })

        expect(response.status).toBe(200)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).toHaveBeenCalledWith({
            where: { provider },
            update: { modelName },
            create: { id: 101n, provider, modelName },
            select: { provider: true, modelName: true }
        })
    })

    it('rejects retired provider configuration', async () => {
        const response = await post({ provider: 'tts_provider', modelName: 'openai' })

        expect(response.status).toBe(400)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it('rejects unsupported text models without changing the preference', async () => {
        const response = await post({ provider: 'openai', modelName: 'made-up-model' })

        expect(response.status).toBe(400)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it('rejects unsupported video speech languages before checking admin permissions', async () => {
        const response = await post({ provider: 'video_language', modelName: 'fr' })

        expect(response.status).toBe(400)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it.each(['apiKey', 'baseUrl', 'extra'])('rejects %s fields on preference updates', async field => {
        const response = await post({ provider: 'video', modelName: 'wan3', [field]: 'replacement-value' })
        expect(response.status).toBe(400)
        expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it.each(['himodels', 'seedance', 'happy_hours', 'openai', 'kling'])('rejects %s credential writes even for administrators', async provider => {
        mocks.requireAdminPermission.mockResolvedValue({ access: { superAdmin: true }, response: null })
        const response = await post({ provider, apiKey: 'new-key', baseUrl: 'https://provider.example', modelName: 'test-model' })
        expect(response.status).toBe(400)
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it('returns preferences without fetching or exposing provider credentials', async () => {
        mocks.findMany.mockResolvedValue([
            { provider: 'happy_hours', apiKey: 'old-key', baseUrl: 'https://provider.example', modelName: 'old-model' },
            { provider: 'openai', apiKey: 'old-key', baseUrl: 'https://provider.example', extra: 'private-settings', modelName: 'gemini-3.7-flash' }
        ])
        const response = await GET(new NextRequest('https://app.example.com/api/settings'))
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { provider: true, modelName: true } }))
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
        await expect(response.json()).resolves.toEqual({ success: true, data: [{ provider: 'openai', modelName: 'gemini-3.7-flash' }] })
    })

    it('reports a settings read failure instead of replacing saved values with defaults', async () => {
        mocks.findMany.mockRejectedValue(new Error('database unavailable'))

        const response = await GET(new NextRequest('https://app.example.com/api/settings'))

        expect(response.status).toBe(503)
        await expect(response.json()).resolves.toEqual({ success: false, error: '生成设置加载失败，请稍后重试' })
    })

    it('keeps the diagnostics switch restricted to settings administrators', async () => {
        expect((await post({ provider: 'safety_diagnostics', modelName: 'enabled' })).status).toBe(403)
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it('requires a valid login even for model-only updates', async () => {
        mocks.currentUserId.mockReturnValue(null)

        const response = await post({ provider: 'video', modelName: 'wan3' })

        expect(response.status).toBe(401)
        expect(mocks.upsert).not.toHaveBeenCalled()
    })
})
