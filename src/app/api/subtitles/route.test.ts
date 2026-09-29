import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

afterEach(() => {
    vi.unstubAllGlobals()
})

function requestFor(url: string) {
    return new NextRequest(`https://app.example.com/api/subtitles?url=${encodeURIComponent(url)}`)
}

describe('subtitle proxy', () => {
    it('converts an allowed SRT response without following redirects', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('1\n00:00:01,000 --> 00:00:02,000\nHello'))
        )
        const response = await GET(requestFor('https://assets.example.invalid/subtitles/demo.srt'))
        expect(response.status).toBe(200)
        await expect(response.text()).resolves.toContain('00:00:01.000 --> 00:00:02.000')
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'manual' }))
    })

    it('rejects redirects and oversized subtitle objects', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(null, {
                        status: 302,
                        headers: { location: 'http://127.0.0.1/internal' }
                    })
            )
        )
        expect((await GET(requestFor('https://assets.example.invalid/redirect.srt'))).status).toBe(502)

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('small', {
                        headers: { 'content-length': String(2 * 1024 * 1024 + 1) }
                    })
            )
        )
        expect((await GET(requestFor('https://assets.example.invalid/large.srt'))).status).toBe(413)
    })

    it('rejects untrusted hosts and non-standard ports before fetching', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect((await GET(requestFor('https://127.0.0.1/internal.srt'))).status).toBe(403)
        expect((await GET(requestFor('https://assets.example.invalid:8443/demo.srt'))).status).toBe(403)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
