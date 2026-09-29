import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { prepareWanVideoReferenceImage } from './wan-video-reference-image'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), fetch: vi.fn() }))
vi.mock('./local-media', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/local-media')>()),
    saveLocalMediaFile: mocks.upload,
    toLocalMediaUrl: () => 'https://origin.example/video-input.jpg'
}))

beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.upload.mockResolvedValue('https://cdn.example/video-input.jpg')
})
afterEach(() => vi.unstubAllGlobals())

describe('Wan video reference images', () => {
    it('converts a PNG over the local storage 20 MiB limit into a small JPEG without changing the original', async () => {
        const png = await sharp({ create: { width: 3072, height: 5504, channels: 3, background: '#628ead' } })
            .png()
            .toBuffer()
        const original = Buffer.concat([png, Buffer.alloc(21 * 1024 * 1024)])
        mocks.fetch.mockResolvedValue(new Response(original))
        let uploaded: Buffer | undefined
        mocks.upload.mockImplementation(async (file: string) => {
            uploaded = await readFile(file)
            return 'https://cdn.example/video-input.jpg'
        })

        expect(await prepareWanVideoReferenceImage('https://cdn.example/original.png')).toBe('https://origin.example/video-input.jpg')
        expect(original.length).toBeGreaterThan(20 * 1024 * 1024)
        expect(uploaded!.length).toBeLessThan(10 * 1024 * 1024)
        const metadata = await sharp(uploaded).metadata()
        expect(metadata).toMatchObject({ format: 'jpeg', width: 1143, height: 2048 })
        const [file, subdir, name] = mocks.upload.mock.calls[0]
        expect(subdir).toBe('video-inputs')
        expect(name).toMatch(/^wan-reference-v1-[a-f0-9]{64}\.jpg$/)
        expect(existsSync(path.dirname(file))).toBe(false)
    })

    it('accepts inline local frames and does not enlarge small images', async () => {
        const png = await sharp({ create: { width: 64, height: 128, channels: 4, background: '#00000000' } })
            .png()
            .toBuffer()
        mocks.upload.mockImplementation(async (file: string) => {
            expect(await sharp(await readFile(file)).metadata()).toMatchObject({ width: 64, height: 128, format: 'jpeg', hasAlpha: false })
            return 'https://cdn.example/video-input.jpg'
        })
        await prepareWanVideoReferenceImage(`data:image/png;base64,${png.toString('base64')}`)
        expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('stops before upload when the source cannot be downloaded', async () => {
        mocks.fetch.mockResolvedValue(new Response('missing', { status: 404 }))
        await expect(prepareWanVideoReferenceImage('https://cdn.example/missing.png')).rejects.toThrow('视频参考图读取失败：HTTP 404')
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('removes temporary files even when upload fails', async () => {
        const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } })
            .png()
            .toBuffer()
        mocks.fetch.mockResolvedValue(new Response(png))
        mocks.upload.mockRejectedValue(new Error('upload failed'))
        await expect(prepareWanVideoReferenceImage('https://cdn.example/frame.png')).rejects.toThrow('upload failed')
        expect(existsSync(path.dirname(mocks.upload.mock.calls[0][0]))).toBe(false)
    })

    it('does not fetch or upload after cancellation', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(prepareWanVideoReferenceImage('https://cdn.example/frame.png', controller.signal)).rejects.toThrow()
        expect(mocks.fetch).not.toHaveBeenCalled()
        expect(mocks.upload).not.toHaveBeenCalled()
    })
})
