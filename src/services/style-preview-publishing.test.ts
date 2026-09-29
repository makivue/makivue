import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { publishStylePreview } from './style-preview-publishing'

const mocks = vi.hoisted(() => ({ put: vi.fn(), store: vi.fn() }))
vi.mock('./local-media', async importOriginal => ({ ...(await importOriginal<typeof import('@/services/local-media')>()), createLocalStylePreviewStore: mocks.store }))
const input = { key: 'new-undeployed-style', version: 'v-test', directory: 'regional-generated' as const }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.store.mockResolvedValue({ put: mocks.put })
    mocks.put.mockImplementation(async (_input, bytes, _hash, width) => ({ url: `https://example.com/${width || 'original'}`, bytes: bytes.length }))
})

describe('style preview processing', () => {
    it('publishes a new key and two decoded WebP thumbnail sizes', async () => {
        const png = await sharp({ create: { width: 768, height: 1366, channels: 3, background: '#aaccee' } })
            .png()
            .toBuffer()
        const result = await publishStylePreview(input, png, 'image/png')
        expect(result.thumbnails.map(item => item.width)).toEqual([256, 384])
        expect(mocks.put).toHaveBeenCalledTimes(3)
        for (const [index, width] of [768, 256, 384].entries()) {
            const [publication, bytes, hash] = mocks.put.mock.calls[index]
            const metadata = await sharp(bytes).metadata()
            expect(publication).toEqual(input)
            expect(metadata.format).toBe('webp')
            expect(metadata.width).toBe(width)
            expect(hash).toBe(createHash('sha256').update(png).digest('hex'))
        }
    })

    it('preserves the bytes of existing WebP originals during migration', async () => {
        const webp = await sharp({ create: { width: 400, height: 600, channels: 3, background: 'red' } })
            .webp()
            .toBuffer()
        await publishStylePreview(input, webp, 'image/webp')
        expect(mocks.put.mock.calls[0][1]).toEqual(webp)
    })

    it('does not write derived objects after an original conflict', async () => {
        const webp = await sharp({ create: { width: 400, height: 600, channels: 3, background: 'red' } })
            .webp()
            .toBuffer()
        mocks.put.mockRejectedValueOnce(new Error('conflict'))
        await expect(publishStylePreview(input, webp, 'image/webp')).rejects.toThrow('conflict')
        expect(mocks.put).toHaveBeenCalledTimes(1)
    })

    it('rejects disguised or corrupted images before any OSS access', async () => {
        const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
            .png()
            .toBuffer()
        await expect(publishStylePreview(input, png, 'image/webp')).rejects.toMatchObject({ status: 422 })
        await expect(publishStylePreview(input, Buffer.from('RIFFabcdWEBPfake'), 'image/webp')).rejects.toMatchObject({ status: 422 })
        await expect(publishStylePreview(input, png, 'image/svg+xml')).rejects.toMatchObject({ status: 415 })
        expect(mocks.store).not.toHaveBeenCalled()
    })
})
