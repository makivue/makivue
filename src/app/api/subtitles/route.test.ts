import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const transport = vi.hoisted(() => vi.fn())
vi.mock('@/lib/local-fetch', () => ({ localFetch: transport }))
import { GET } from './route'
afterEach(() => vi.clearAllMocks())
const request = (url: string) => new NextRequest(`http://localhost/api/subtitles?url=${encodeURIComponent(url)}`)
it('converts a local SRT file to VTT', async () => {
    transport.mockResolvedValue(new Response('1\n00:00:01,000 --> 00:00:02,000\nHello'))
    const response = await GET(request('/api/local-media/subtitles/example.srt'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('00:00:01.000 --> 00:00:02.000')
})
it('rejects remote sources and oversized local files', async () => {
    expect((await GET(request('https://example.com/example.srt'))).status).toBe(403)
    expect(transport).not.toHaveBeenCalled()
    transport.mockResolvedValue(new Response('small', { headers: { 'content-length': '2097153' } }))
    expect((await GET(request('/api/local-media/subtitles/large.srt'))).status).toBe(413)
})
