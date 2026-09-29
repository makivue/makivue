import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { publishStylePreview } from './style-preview-publishing'

const input = { key: 'new-local-style', version: 'v-test', directory: 'regional-generated' as const }
let root: string
beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'bundled-style-test-'))
})
afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
})

async function source() {
    return sharp({ create: { width: 768, height: 1366, channels: 3, background: '#aaccee' } })
        .png()
        .toBuffer()
}

describe('bundled style preview processing', () => {
    it('writes real WebP images and both thumbnail sizes under public, with local URLs', async () => {
        const result = await publishStylePreview(input, await source(), 'image/png', root)
        expect(result.original.url).toBe('/style-previews/new-local-style.webp')
        expect(result.thumbnails.map(item => item.width)).toEqual([256, 384])
        for (const [index, item] of [result.original, ...result.thumbnails].entries()) {
            const bytes = await fs.readFile(path.join(root, item.url))
            const metadata = await sharp(bytes).metadata()
            expect(metadata.format).toBe('webp')
            expect(metadata.width).toBe([768, 256, 384][index])
            expect(item.bytes).toBe(bytes.length)
        }
    })

    it('preserves existing WebP bytes when migrating a real style image', async () => {
        const webp = await sharp(await source())
            .webp()
            .toBuffer()
        const result = await publishStylePreview(input, webp, 'image/webp', root)
        expect(await fs.readFile(path.join(root, result.original.url))).toEqual(webp)
    })

    it('allows a regenerated image to replace the local preview and its thumbnails', async () => {
        await publishStylePreview(input, await source(), 'image/png', root)
        const updated = await sharp({ create: { width: 600, height: 900, channels: 3, background: 'red' } })
            .webp()
            .toBuffer()
        const result = await publishStylePreview(input, updated, 'image/webp', root)
        expect(await fs.readFile(path.join(root, result.original.url))).toEqual(updated)
        expect((await fs.readdir(path.join(root, 'style-previews'))).some(name => name.endsWith('.tmp'))).toBe(false)
    })

    it('rejects disguised or corrupt images before creating output files', async () => {
        const png = await source()
        await expect(publishStylePreview(input, png, 'image/webp', root)).rejects.toMatchObject({ status: 422 })
        await expect(publishStylePreview(input, Buffer.from('RIFFabcdWEBPfake'), 'image/webp', root)).rejects.toMatchObject({ status: 422 })
        await expect(publishStylePreview(input, png, 'image/svg+xml', root)).rejects.toMatchObject({ status: 415 })
        expect(await fs.readdir(root)).toEqual([])
    })

    it('rejects traversal keys and symlink directories without modifying their target', async () => {
        const png = await source()
        await expect(publishStylePreview({ ...input, key: '../escape' }, png, 'image/png', root)).rejects.toMatchObject({ status: 400 })
        await fs.mkdir(path.join(root, 'outside'))
        await fs.symlink(path.join(root, 'outside'), path.join(root, 'style-previews'))
        await expect(publishStylePreview(input, png, 'image/png', root)).rejects.toMatchObject({ status: 400 })
        expect(await fs.readdir(path.join(root, 'outside'))).toEqual([])
    })
})
