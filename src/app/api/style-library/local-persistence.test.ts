import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { GET, POST } from './route'
import { readLocalMedia } from '@/services/local-media'

let directory: string
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-style-library-'))
    vi.stubEnv('LOCAL_DATA_DIR', directory)
})
afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
})

describe('local style library storage', () => {
    it('persists normalized reference images under the local media directory and restores saved entries', async () => {
        const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#667788' } }).png().toBuffer()
        const body = new FormData()
        Object.entries({ kind: 'style', name: 'Local reference', description: '', baseStyle: 'pixel-art' }).forEach(([key, value]) => body.set(key, value))
        body.append('images', new File([new Uint8Array(bytes)], 'reference.png', { type: 'image/png' }))
        const response = await POST(new NextRequest('http://localhost/api/style-library', { method: 'POST', body }))
        expect(response.status).toBe(201)
        const { data } = await response.json()
        expect(data.referenceImages[0]).toMatch(/^\/api\/local-media\/style-library\/1\/[^/]+\.webp$/)
        const saved = await readLocalMedia(data.referenceImages[0])
        expect((await sharp(saved.data).metadata()).format).toBe('webp')
        const loaded = await GET(new NextRequest(`http://localhost/api/style-library?id=${data.id}`))
        expect((await loaded.json()).data.items).toEqual([data])
        const state = JSON.parse(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8'))
        expect(state.collections.StyleLibraryEntry).toHaveLength(1)
        expect(state.collections.StyleLibraryEntry[0].referenceImages).toEqual(data.referenceImages)
    })
})
