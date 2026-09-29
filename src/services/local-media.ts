import 'server-only'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID, createHash } from 'node:crypto'
import { localMediaDirectory } from '@/lib/local-paths'
import { stylePreviewObjectKey, type StylePreviewPublication } from '@/lib/style-preview-publishing'

export type LocalMediaEnvironment = 'test' | 'prod'
const PREFIX = '/api/local-media/'
const MIME: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.vtt': 'text/vtt',
    '.srt': 'text/plain',
    '.txt': 'text/plain'
}

function components(value: string): string[] {
    const parts = value.split('/')
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) throw new Error('Invalid local media path')
    return parts
}
export function localMediaKey(src: string): string | null {
    try {
        const url = new URL(src, 'http://localhost')
        if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith(PREFIX)) return null
        const key = decodeURIComponent(url.pathname.slice(PREFIX.length))
        components(key)
        return key
    } catch {
        return null
    }
}
async function mediaPath(key: string): Promise<string> {
    const root = localMediaDirectory()
    const parts = components(key)
    let current = root
    for (const part of ['', ...parts]) {
        if (part) current = path.join(current, part)
        try {
            if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Local media symlinks are not allowed')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }
    return current
}
/** Resolve only URLs owned by this workspace, with the same checks as downloads. */
export async function localMediaFilePath(src: string): Promise<string> {
    const key = localMediaKey(src)
    if (!key) throw new Error('Not a local media URL')
    return mediaPath(key)
}
function mediaUrl(key: string) {
    return PREFIX + components(key).map(encodeURIComponent).join('/')
}
async function save(key: string, write: (target: string) => Promise<void>): Promise<string> {
    const target = await mediaPath(key)
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    const temporary = path.join(path.dirname(target), `.media-${randomUUID()}.tmp`)
    try {
        await write(temporary)
        await fs.chmod(temporary, 0o600)
        await fs.rename(temporary, target)
    } finally {
        await fs.rm(temporary, { force: true })
    }
    return mediaUrl(key)
}
export async function saveLocalMediaFile(localPath: string, subdir: string, name: string, _environment?: LocalMediaEnvironment): Promise<string> {
    void _environment

    if (components(name).length !== 1) throw new Error('Media filename must not contain folders')
    return save(`${subdir.replace(/^\/+|\/+$/g, '')}/${name}`, target => fs.copyFile(localPath, target))
}
export async function saveImmutableLocalImage(localPath: string, subdir: string, name: string, environment?: LocalMediaEnvironment): Promise<string> {
    if (components(name).length !== 1) throw new Error('Media filename must not contain folders')
    const digest = createHash('sha256')
        .update(await fs.readFile(localPath))
        .digest('hex')
        .slice(0, 20)
    const extension = path.extname(name)
    const versioned = `${path.basename(name, extension)}-${digest}${extension}`
    return saveLocalMediaFile(localPath, subdir, versioned, environment)
}
export function toLocalMediaUrl(src: string) {
    const key = localMediaKey(src)
    return key ? mediaUrl(key) : src
}
export function localMediaMatchesSubdirectory(src: string, subdir: string, _environment?: LocalMediaEnvironment): boolean {
    void _environment

    const key = localMediaKey(src)
    try {
        return key !== null && key.startsWith(components(subdir).join('/') + '/')
    } catch {
        return false
    }
}
export async function deleteLocalMediaWithinSubdirectory(src: string, subdir: string, _environment?: LocalMediaEnvironment): Promise<void> {
    void _environment

    if (!localMediaMatchesSubdirectory(src, subdir)) throw new Error('Refusing to delete media outside the requested directory')
    await fs.rm(await mediaPath(localMediaKey(src)!), { force: true })
}
export async function deleteLocalCreatorArtifact(src: string) {
    await deleteLocalMediaWithinSubdirectory(src, 'creator')
}
export async function readLocalMedia(src: string, limit = 350 * 1024 * 1024): Promise<{ data: Buffer; mime: string }> {
    const key = localMediaKey(src)
    if (!key) throw new Error('Not a local media URL')
    const file = await mediaPath(key)
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > limit) throw new Error('Local media exceeds the allowed size')
    return { data: await fs.readFile(file), mime: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }
}
export async function localMediaResponse(src: string, init: RequestInit = {}): Promise<Response> {
    const key = localMediaKey(src)
    if (!key) return new Response('Not found', { status: 404 })
    try {
        const file = await mediaPath(key)
        const stat = await fs.stat(file)
        if (!stat.isFile()) return new Response('Not found', { status: 404 })
        let start = 0,
            end = stat.size - 1,
            status = 200
        const range = new Headers(init.headers).get('range')
        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range)
            if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
            start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]))
            end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size)
                return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
            status = 206
        }
        const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
        const headers: Record<string, string> = {
            'Content-Type': mime,
            'Content-Length': String(Math.max(0, end - start + 1)),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, no-cache',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'none'; sandbox"
        }
        if (mime === 'application/octet-stream') headers['Content-Disposition'] = 'attachment'
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
        const stream = init.method === 'HEAD' || stat.size === 0 ? null : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>)
        return new Response(stream, { status, headers })
    } catch {
        return new Response('Not found', { status: 404 })
    }
}
export async function createLocalStylePreviewStore() {
    return {
        async put(input: StylePreviewPublication, data: Buffer, _sourceSha256: string, width?: 256 | 384) {
            void _sourceSha256

            const key = stylePreviewObjectKey(input, width)
            const url = await save(key, target => fs.writeFile(target, data))
            return { url, sha256: createHash('sha256').update(data).digest('hex') }
        }
    }
}
