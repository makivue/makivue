import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { POST, PUT, DELETE } from './route'
import { DRAMA_MAX_PART_BYTES, DRAMA_UPLOAD_PROTOCOL } from '@/lib/drama-upload'

let directory: string
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-drama-route-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
})
afterEach(async () => {
    vi.unstubAllEnvs()
    const scope = createHash('sha256').update(directory).digest('hex').slice(0, 24)
    await fs.rm(path.join(os.tmpdir(), `makivue-drama-uploads-${scope}`), { recursive: true, force: true })
    await fs.rm(directory, { recursive: true, force: true })
})
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/drama-uploads/media', { method: 'POST', body: JSON.stringify(body) }))

it('accepts bounded local chunks, finalizes them and rejects invalid upload requests', async () => {
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: 'blue' } })
        .png()
        .toBuffer()
    const started = await post({ action: 'begin', kind: 'cover', name: 'cover.png', size: bytes.length, protocol: DRAMA_UPLOAD_PROTOCOL })
    expect(started.status).toBe(201)
    const { token } = (await started.json()).data
    const uploaded = await PUT(new NextRequest('http://localhost/api/drama-uploads/media?part=1', { method: 'PUT', headers: { 'x-upload-token': token }, body: new Uint8Array(bytes) }))
    expect(uploaded.status).toBe(200)
    const part = (await uploaded.json()).data
    const completed = await post({ action: 'complete', token, parts: [part] })
    expect(completed.status).toBe(201)
    expect((await completed.json()).data.url).toMatch(/^\/api\/local-media\/drama-uploads\/1\//)
    const oversized = await PUT(
        new NextRequest('http://localhost/api/drama-uploads/media?part=1', {
            method: 'PUT',
            headers: { 'x-upload-token': token, 'content-length': String(DRAMA_MAX_PART_BYTES + 1) },
            body: new Uint8Array(1)
        })
    )
    expect(oversized.status).toBe(413)
    expect((await post({ action: 'begin', kind: 'video', name: 'escape.txt', size: 2 })).status).toBe(400)
    expect((await post({ action: 'complete', token: 'forged', parts: [part] })).status).toBe(403)
    const pending = await post({ action: 'begin', kind: 'cover', name: 'cancel.png', size: bytes.length })
    const cancelToken = (await pending.json()).data.token
    expect((await DELETE(new NextRequest('http://localhost/api/drama-uploads/media', { method: 'DELETE', headers: { 'x-upload-token': cancelToken } }))).status).toBe(200)
})
