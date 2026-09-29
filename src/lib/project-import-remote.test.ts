import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitProjectImportRemotely, persistProjectImportThroughRemoteCrud, remoteImportResponse } from './project-import-remote'

const originalTarget = process.env.TEST_API_PROXY_TARGET

describe('remote project import bridge', () => {
    beforeEach(() => {
        process.env.TEST_API_PROXY_TARGET = 'https://test-import.example'
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        if (originalTarget === undefined) delete process.env.TEST_API_PROXY_TARGET
        else process.env.TEST_API_PROXY_TARGET = originalTarget
    })

    it('recovers an empty commit failure when the remote job was already queued', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('', { status: 500 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { phase: 'queued' } }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        const request = new Request('http://localhost:3000/api/projects/import/commit', { headers: { authorization: 'Bearer signed-session' } })

        const result = await commitProjectImportRemotely(request, {
            jobId: '789'
        })

        expect(result.status).toBe(202)
        expect(result.payload).toEqual({ success: true, data: { jobId: '789' } })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('persists through stable CRUD APIs when the dedicated commit endpoint is unusable', async () => {
        const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
            const url = new URL(String(input))
            const method = init?.method
            if (url.pathname === '/api/projects' && method === 'POST') return Response.json({ success: true, data: { id: '900' } }, { status: 201 })
            if (url.pathname === '/api/projects/900' && method === 'GET') {
                return Response.json({ success: true, data: { id: '900', episodes: [{ id: '901', episodeNumber: 1 }] } })
            }
            if (url.pathname === '/api/projects/900' && method === 'PATCH') return Response.json({ success: true, data: { id: '900' } })
            if (url.pathname === '/api/episodes/901' && method === 'PATCH') return Response.json({ success: true, data: { id: '901' } })
            if (url.pathname === '/api/episodes/901/finalize' && method === 'POST') return Response.json({ success: true, data: { ok: true } })
            if (url.pathname === '/api/episodes/901/storyboards' && method === 'POST') return Response.json({ success: true, data: [{ id: '902' }] }, { status: 201 })
            return Response.json({ success: false, error: `unexpected ${method} ${url.pathname}` }, { status: 500 })
        })
        vi.stubGlobal('fetch', fetchMock)
        const request = new Request('http://localhost:3000/api/projects/import/commit', { headers: { authorization: 'Bearer signed-session' } })

        const result = await persistProjectImportThroughRemoteCrud(
            request,
            { importId: 'storyboard-fallback-test', text: '完整分镜内容', visualStyle: 'cinematic', videoAspectRatio: '9:16' },
            {
                stage: 'storyboard',
                projectTitle: '测试项目',
                totalEpisodes: 1,
                episodes: [
                    {
                        episodeNumber: 1,
                        title: '第一集',
                        script: '林晓：你好。',
                        storyboards: [{ order: 1, duration: 5, actionDesc: '林晓走进客厅。' }]
                    }
                ]
            }
        )

        expect(result.status).toBe(200)
        expect(result.payload).toMatchObject({ success: true, data: { projectId: '900', stage: 'storyboard', totalStoryboards: 1 } })
        expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    it('normalizes a non-JSON upstream failure into a JSON API error', async () => {
        const response = remoteImportResponse({ status: 503, body: '', contentType: null, retryAfter: null, payload: null })

        expect(response.status).toBe(503)
        await expect(response.json()).resolves.toEqual({ success: false, error: '测试环境导入服务暂时不可用，请稍后重试' })
    })
})
