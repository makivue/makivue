import { NextRequest } from 'next/server'

const ALLOWED_HOSTS = new Set(['assets.example.invalid', 'assets.example.invalid', 'h5-test-static.staticjs.org', 'h5-static.staticjs.org'])
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024

function srtToVtt(srt: string) {
    return `WEBVTT\n\n${srt
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

async function readSubtitleText(response: Response) {
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > MAX_SUBTITLE_BYTES) throw new Error('subtitle too large')
    if (!response.body) return ''
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            received += value.byteLength
            if (received > MAX_SUBTITLE_BYTES) {
                await reader.cancel()
                throw new Error('subtitle too large')
            }
            chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }
    const merged = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
}

export async function GET(request: NextRequest) {
    const rawUrl = new URL(request.url).searchParams.get('url')
    if (!rawUrl) return new Response('url required', { status: 400 })

    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        return new Response('invalid url', { status: 400 })
    }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !ALLOWED_HOSTS.has(url.hostname)) {
        return new Response('subtitle host not allowed', { status: 403 })
    }

    const upstream = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000)
    })
    if (upstream.status >= 300 && upstream.status < 400) return new Response('subtitle redirect not allowed', { status: 502 })
    if (!upstream.ok) return new Response(`subtitle upstream ${upstream.status}`, { status: 502 })
    let srt: string
    try {
        srt = await readSubtitleText(upstream)
    } catch (error) {
        if (error instanceof Error && error.message === 'subtitle too large') return new Response('subtitle too large', { status: 413 })
        throw error
    }
    return new Response(srtToVtt(srt), {
        headers: {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400'
        }
    })
}
