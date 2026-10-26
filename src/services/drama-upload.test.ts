import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createDramaUploadStore } from './drama-upload'
import { localMediaFilePath, readLocalMedia } from './local-media'
import { DRAMA_MIN_PART_BYTES, DRAMA_UPLOAD_PROTOCOL } from '@/lib/drama-upload'
import { POST, GET } from '@/app/api/drama-uploads/route'
import { GET as detail, DELETE as remove } from '@/app/api/drama-uploads/[id]/route'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

const run = promisify(execFile)
let directory: string
let fixtures: string
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-drama-test-'))
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-drama-fixtures-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
})
afterEach(async () => {
    vi.unstubAllEnvs()
    const scope = createHash('sha256').update(directory).digest('hex').slice(0, 24)
    await fs.rm(path.join(os.tmpdir(), `makivue-drama-uploads-${scope}`), { recursive: true, force: true })
    await fs.rm(directory, { recursive: true, force: true })
    await fs.rm(fixtures, { recursive: true, force: true })
})
async function save(kind: 'cover' | 'video' | 'subtitle', name: string, bytes: Buffer) {
    const store = await createDramaUploadStore(1n)
    const session = await store.begin(kind, name, bytes.length, DRAMA_UPLOAD_PROTOCOL)
    const ticket = store.readTicket(session.token)
    const part = await store.part(ticket, 1, bytes)
    return { result: await store.complete(ticket, [part]), store, ticket, part }
}
async function media() {
    const cover = await sharp({ create: { width: 16, height: 24, channels: 3, background: '#123456' } })
        .png()
        .toBuffer()
    const video = path.join(fixtures, 'episode.mp4')
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x48:d=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video])
    return { cover, video: await fs.readFile(video) }
}

describe('local drama upload', () => {
    it('validates and saves media, survives new store instances, and completes idempotently', async () => {
        const fixture = await media()
        const cover = await save('cover', 'cover.png', fixture.cover)
        expect((await sharp((await readLocalMedia(cover.result.url)).data).metadata()).format).toBe('png')
        const video = await save('video', 'episode.mp4', fixture.video)
        const fresh = await createDramaUploadStore(1n)
        expect(fresh.readReceipt(video.result.receipt, 'video').duration).toBeGreaterThan(0)
        expect(await fresh.complete(video.ticket, [video.part])).toEqual(video.result)
        expect(await fs.readFile(await localMediaFilePath(video.result.url))).toEqual(fixture.video)
        expect((await fs.stat(path.join(directory, '.drama-upload-key'))).mode & 0o777).toBe(0o600)
        expect(() => fresh.readTicket(video.result.receipt)).toThrow('上传内容无效')
        expect(() => fresh.readReceipt(video.result.receipt, 'cover')).toThrow('上传内容无效')
        const other = await createDramaUploadStore(2n)
        expect(() => other.readReceipt(video.result.receipt, 'video')).toThrow('上传凭证')
        expect(() => fresh.readReceipt(video.result.receipt + 'x', 'video')).toThrow('上传凭证')
    })

    it('rejects invalid images, disguised video, corrupt parts and oversized manifests', async () => {
        const store = await createDramaUploadStore(1n)
        const session = await store.begin('cover', 'cover.png', 20, DRAMA_UPLOAD_PROTOCOL)
        const ticket = store.readTicket(session.token)
        const part = await store.part(ticket, 1, Buffer.alloc(20))
        await expect(store.complete(ticket, [part])).rejects.toThrow('文件校验失败')
        await expect(store.complete(ticket, [{ ...part, etag: '0'.repeat(64) }])).rejects.toThrow('上传内容无效')
        const video = store.readTicket((await store.begin('video', 'fake.mp4', 20, DRAMA_UPLOAD_PROTOCOL)).token)
        await expect(store.part(video, 1, Buffer.alloc(20))).rejects.toThrow('实际内容')
        const large = store.readTicket((await store.begin('video', 'large.mp4', DRAMA_MIN_PART_BYTES * 2, DRAMA_UPLOAD_PROTOCOL)).token)
        const bytes = Buffer.alloc(DRAMA_MIN_PART_BYTES * 2)
        bytes.write('ftyp', 4)
        await store.part(large, 1, bytes)
        await expect(store.part(large, 2, bytes)).rejects.toThrow('上传内容无效')
    })

    it('persists completed uploads atomically, lists/details them and soft deletes the work', async () => {
        const fixture = await media()
        const cover = await save('cover', 'cover.png', fixture.cover)
        const video = await save('video', 'episode.mp4', fixture.video)
        const subtitle = await save('subtitle', 'captions.srt', Buffer.from('1\n00:00:00,000 --> 00:00:00,400\n本地字幕\n'))
        const body = {
            title: '本地作品',
            description: '上传作品说明',
            cover: cover.result.receipt,
            language: 'zh',
            subtitleLanguage: 'zh',
            year: 2026,
            cast: [{ name: '演员', role: '主角' }],
            episodes: [{ title: '第一集', video: video.result.receipt, subtitle: subtitle.result.receipt }]
        }
        const request = () => new NextRequest('http://localhost/api/drama-uploads', { method: 'POST', body: JSON.stringify(body) })
        const response = await POST(request())
        expect(response.status).toBe(201)
        const id = (await response.json()).data.id
        expect((await POST(request())).status).toBe(200)
        expect(await prisma.project.count()).toBe(1)
        expect(await prisma.episode.count()).toBe(1)
        expect(await prisma.videoMerge.count()).toBe(1)
        const all = await (await GET(new NextRequest('http://localhost/api/drama-uploads'))).json()
        expect(all.data).toHaveLength(1)
        expect(all.data[0]).toMatchObject({ id, title: body.title, visibility: 'public', year: 2026 })
        expect(all.data[0]).not.toHaveProperty('reviewStatus')
        const context = { params: Promise.resolve({ id }) }
        const loaded = await (await detail(new NextRequest(`http://localhost/api/drama-uploads/${id}`), context)).json()
        expect(loaded.data.episodes[0]).toMatchObject({ title: '第一集', videoUrl: video.result.url })
        expect(JSON.parse(loaded.data.episodes[0].merges[0].subtitleUrls)).toEqual({ zh: subtitle.result.url })
        expect((await remove(new NextRequest(`http://localhost/api/drama-uploads/${id}`, { method: 'DELETE' }), context)).status).toBe(200)
        expect((await detail(new NextRequest(`http://localhost/api/drama-uploads/${id}`), context)).status).toBe(404)
        expect((await (await GET(new NextRequest('http://localhost/api/drama-uploads'))).json()).data).toEqual([])
        expect(await prisma.project.count()).toBe(1)
        expect((await fs.stat(await localMediaFilePath(video.result.url))).isFile()).toBe(true)
    })

    it('refuses invalid or reused receipts before creating any records', async () => {
        const fixture = await media()
        const cover = await save('cover', 'cover.png', fixture.cover)
        const body = { title: 'Invalid', description: 'description', cover: cover.result.receipt, episodes: [{ video: cover.result.receipt }] }
        const response = await POST(new NextRequest('http://localhost/api/drama-uploads', { method: 'POST', body: JSON.stringify(body) }))
        expect(response.status).toBe(400)
        expect(await prisma.project.count()).toBe(0)
        expect(await prisma.episode.count()).toBe(0)
    })
})
