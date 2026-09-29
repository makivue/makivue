import { localFetch } from '@/lib/local-fetch'
import 'server-only'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import { toLocalMediaUrl, saveLocalMediaFile } from './local-media'

const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024

async function readImage(src: string, signal?: AbortSignal): Promise<Buffer> {
    const inline = /^data:image\/(?:png|jpe?g|webp);base64,([\s\S]+)$/i.exec(src)
    if (inline) {
        if (inline[1].length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) throw new Error('视频参考图超过 64 MiB，无法处理')
        return Buffer.from(inline[1], 'base64')
    }
    const response = await localFetch(src, { signal: fetchTimeoutSignal(180_000, signal) })
    if (!response.ok || !response.body) throw new Error(`视频参考图读取失败：HTTP ${response.status}`)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_SOURCE_BYTES) throw new Error('视频参考图超过 64 MiB，无法处理')
            chunks.push(value)
        }
    } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
    }
    return Buffer.concat(chunks)
}

/** Keep original illustrations intact; Wan receives a bounded JPEG from local storage. */
export async function prepareWanVideoReferenceImage(src: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const source = await readImage(src, signal)
    // Bound the source size before generating a reference image.
    // Decode locally so 4K PNGs can still produce a valid video input.
    const image = sharp(source, { limitInputPixels: 40_000_000, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new Error('视频参考图仅支持静态 PNG、JPEG、WebP')
    const reference = await image.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
    if (!reference.length || reference.length > MAX_REFERENCE_BYTES) throw new Error('视频参考图压缩后仍超过 10 MiB，无法提交')
    signal?.throwIfAborted()
    const filename = `wan-reference-v1-${createHash('sha256').update(reference).digest('hex')}.jpg`
    const directory = await mkdtemp(path.join(tmpdir(), 'wan-video-reference-'))
    try {
        const localPath = path.join(directory, filename)
        await writeFile(localPath, reference)
        signal?.throwIfAborted()
        const uploaded = await saveLocalMediaFile(localPath, 'video-inputs', filename)
        signal?.throwIfAborted()
        return toLocalMediaUrl(uploaded)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
