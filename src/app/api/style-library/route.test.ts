import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { promises as fs } from 'node:fs'
import sharp from 'sharp'

const mocks = vi.hoisted(() => ({ currentUserId: vi.fn(), findMany: vi.fn(), create: vi.fn(), upload: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.currentUserId }))
vi.mock('@/lib/prisma', () => ({ prisma: { styleLibraryEntry: { findMany: mocks.findMany, create: mocks.create } } }))
vi.mock('@/lib/id', () => ({ genId: () => 456n }))
vi.mock('@/services/local-media', () => ({ saveLocalMediaFile: mocks.upload, deleteLocalMediaWithinSubdirectory: mocks.remove }))
import { GET, POST } from './route'

function request(values: Record<string, string> = {}, images: File[] = []) {
    const body = new FormData()
    Object.entries({ kind: 'style', name: '自定义风格', description: '柔和暖光', baseStyle: 'cinematic', ...values }).forEach(([key, value]) => body.set(key, value))
    images.forEach(file => body.append('images', file))
    return new NextRequest('http://localhost/api/style-library', { method: 'POST', body })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentUserId.mockReturnValue(123n)
    mocks.findMany.mockResolvedValue([])
    mocks.create.mockImplementation(async ({ data }) => data)
    mocks.upload.mockImplementation(async (_path, _subdir, name) => `/api/local-media/style-library/123/${name}`)
})

describe('style library ownership and input validation', () => {
    it('requires authentication before reading or parsing uploads', async () => {
        mocks.currentUserId.mockReturnValue(null)
        expect((await GET(new NextRequest('http://localhost/api/style-library'))).status).toBe(401)
        expect((await POST(request())).status).toBe(401)
        expect(mocks.findMany).not.toHaveBeenCalled()
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('scopes every lookup to the current account and disables caching', async () => {
        const response = await GET(new NextRequest('http://localhost/api/style-library'))
        expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: 123n }, orderBy: { id: 'desc' } })
        expect(response.headers.get('Cache-Control')).toContain('no-store')
        expect((await GET(new NextRequest('http://localhost/api/style-library?id=789'))).status).toBe(404)
        expect(mocks.findMany).toHaveBeenLastCalledWith({ where: { userId: 123n, id: 789n }, orderBy: { id: 'desc' } })
    })

    it('saves a text-only entry without uploading anything', async () => {
        const response = await POST(request({ name: '  胶片暖光  ' }))
        expect(response.status).toBe(201)
        expect((await response.json()).data).toMatchObject({ id: '456', name: '胶片暖光', referenceImages: [] })
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 123n, description: '柔和暖光' }) })
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it.each([
        { name: ' ' },
        { kind: 'other' },
        { name: 'a'.repeat(81) },
        { description: 'a'.repeat(4001) },
        { region: 'a'.repeat(101) },
        { baseStyle: 'unknown' },
        { genre: 'unknown' },
        { description: '' }
    ])('rejects invalid entry %j', async values => {
        expect((await POST(request(values))).status).toBe(400)
        expect(mocks.create).not.toHaveBeenCalled()
    })

    it('rejects a forged image and excessive file counts before uploading', async () => {
        const forged = new File(['not an image'], 'fake.png', { type: 'image/png' })
        expect((await POST(request({}, [forged]))).status).toBe(415)
        expect((await POST(request({}, [forged, forged, forged, forged]))).status).toBe(400)
        expect(mocks.upload).not.toHaveBeenCalled()
    })
})

describe('reference image persistence', () => {
    async function image() {
        const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#556677' } })
            .png()
            .toBuffer()
        return new File([new Uint8Array(buffer)], 'reference.png', { type: 'image/png' })
    }

    it('supports image-only direction, normalizes uploaded bytes and removes local temporary files', async () => {
        mocks.upload.mockImplementation(async (localPath, subdir, filename) => {
            expect((await sharp(localPath).metadata()).format).toBe('webp')
            expect(subdir).toBe('style-library/123')
            expect(filename).toMatch(/\.webp$/)
            return '/api/local-media/style-library/123/reference.webp'
        })
        const response = await POST(request({ description: '' }, [await image()]))
        expect(response.status).toBe(201)
        expect((await response.json()).data.referenceImages).toEqual(['/api/local-media/style-library/123/reference.webp'])
        await expect(fs.stat(mocks.upload.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('cleans uploaded objects if local record persistence fails', async () => {
        mocks.create.mockRejectedValue(new Error('local workspace unavailable'))
        expect((await POST(request({}, [await image()]))).status).toBe(503)
        expect(mocks.remove).toHaveBeenCalledWith(expect.stringContaining('/api/local-media/style-library/123/'), 'style-library/123')
        await expect(fs.stat(mocks.upload.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
    })
})
