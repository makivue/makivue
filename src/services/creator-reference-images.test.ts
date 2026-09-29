import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CREATOR_IMAGE_BYTES, validateCreatorReferenceImages } from '@/lib/creator-reference-images'

const mocks = vi.hoisted(() => ({ find: vi.fn() }))
vi.mock('./creator-assets', () => ({ findCreatorAssetReference: mocks.find }))
import { readCreatorReferenceImages } from './creator-reference-images'

const file = (name = 'reference.png', type = 'image/png') => new File(['image'], name, { type })

describe('creator reference image inputs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.find.mockImplementation(async (_userId, id) => ({ referenceUrl: `https://cdn.test/${id}.png` }))
    })

    it('accepts three uploads and preserves their order', async () => {
        const form = new FormData()
        for (const name of ['first.png', 'second.png', 'third.png']) form.append('image', file(name))
        const result = await readCreatorReferenceImages(form, 7n)
        expect(result.files.map(image => image.name)).toEqual(['first.png', 'second.png', 'third.png'])
        expect(result.count).toBe(3)
    })

    it('counts saved references toward the same three-image limit and checks ownership', async () => {
        const form = new FormData()
        form.append('referenceAssetId', '41')
        form.append('image', file())
        form.append('image', file())
        await expect(readCreatorReferenceImages(form, 7n)).resolves.toMatchObject({ savedUrls: ['https://cdn.test/41.png'], count: 3 })
        expect(mocks.find).toHaveBeenCalledWith(7n, 41n)
        form.append('image', file())
        await expect(readCreatorReferenceImages(form, 7n)).rejects.toThrow('最多上传 3 张参考图片')
    })

    it('rejects a fourth upload before looking up assets', async () => {
        const form = new FormData()
        for (let index = 0; index < 4; index++) form.append('image', file())
        await expect(readCreatorReferenceImages(form, 7n)).rejects.toMatchObject({ status: 400 })
        expect(mocks.find).not.toHaveBeenCalled()
    })

    it('validates every image, including a bad later image', () => {
        expect(validateCreatorReferenceImages([file(), file('unsafe.svg', 'image/svg+xml')])).toBe('参考图仅支持 JPG、PNG、WebP')
        expect(validateCreatorReferenceImages([file(), new File([new Uint8Array(MAX_CREATOR_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' })])).toBe('参考图不能超过 10MB')
        expect(validateCreatorReferenceImages([new File([], 'empty.png', { type: 'image/png' })])).toBe('参考图仅支持 JPG、PNG、WebP')
    })

    it('rejects references that do not belong to the current user', async () => {
        mocks.find.mockResolvedValue(null)
        const form = new FormData()
        form.append('referenceAssetId', '41')
        await expect(readCreatorReferenceImages(form, 7n)).rejects.toMatchObject({ status: 404 })
    })

    it('keeps the legacy single-image field working and rejects non-file inputs', async () => {
        const form = new FormData()
        form.set('image', file())
        await expect(readCreatorReferenceImages(form, 7n)).resolves.toMatchObject({ count: 1 })
        form.set('image', 'https://untrusted.test/image.png')
        await expect(readCreatorReferenceImages(form, 7n)).rejects.toMatchObject({ status: 400 })
    })
})
