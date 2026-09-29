import { promises as fs } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { MAX_REFERENCE_VIDEO_BYTES } from '@/lib/storyboard-reference-videos'

const mocks = vi.hoisted(() => ({
    user: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    probe: vi.fn()
}))

vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.user }))
vi.mock('@/services/oss', () => ({ uploadToOSS: mocks.upload, deleteOSSObjectWithinSubdir: mocks.remove }))
vi.mock('@/services/ffmpeg', () => ({ probeMediaStreams: mocks.probe }))

import { DELETE, POST } from './route'

function uploadRequest(provider = 'wan3') {
    const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    const form = new FormData()
    form.set('provider', provider)
    form.set('file', new File([bytes], 'reference.mp4', { type: 'video/mp4' }))
    return new NextRequest('http://localhost/api/create/reference-videos', { method: 'POST', body: form })
}

describe('creator reference video uploads', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.user.mockReturnValue(7n)
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 4.25 })
        mocks.upload.mockResolvedValue('https://cdn.test/ssrStatic/aivideo/creator/7/reference-videos/reference.mp4')
        mocks.remove.mockResolvedValue(undefined)
    })

    it('uploads a valid reference video and returns its metadata', async () => {
        const response = await POST(uploadRequest())

        expect(response.status).toBe(201)
        expect(mocks.upload).toHaveBeenCalledOnce()
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            data: { referenceVideo: { name: 'reference.mp4', sizeBytes: 12, durationSeconds: 4.25 } }
        })
    })

    it('rejects a request declared larger than one 300MB reference video', async () => {
        const request = new NextRequest('http://localhost/api/create/reference-videos', {
            method: 'POST',
            headers: { 'content-length': String(MAX_REFERENCE_VIDEO_BYTES + 1024 * 1024 + 1) },
            body: new FormData()
        })

        const response = await POST(request)

        expect(response.status).toBe(413)
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('rejects a video outside the selected model duration range', async () => {
        mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, duration: 30.001 })

        const response = await POST(uploadRequest('seedance25'))

        expect(response.status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
        await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining('30 秒') })
    })

    it('deletes only through the creator reference-video subdirectory guard', async () => {
        const url = 'https://cdn.test/ssrStatic/aivideo/creator/7/reference-videos/reference.mp4'
        const response = await DELETE(
            new NextRequest('http://localhost/api/create/reference-videos', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            })
        )

        expect(response.status).toBe(200)
        expect(mocks.remove).toHaveBeenCalledWith(url, 'creator/7/reference-videos')
    })
})

function request(mode?: string, provider = 'seedance') {
    const form = new FormData()
    if (mode) form.set('mode', mode)
    form.set('provider', provider)
    form.set('file', new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109])], 'leaves.mp4', { type: 'video/mp4' }))
    return new NextRequest('http://localhost/api/create/reference-videos', { method: 'POST', body: form })
}

describe('creator reference video upload modes', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.user.mockReturnValue(7n)
        mocks.probe.mockResolvedValue({ hasVideo: true, duration: 40 })
        mocks.upload.mockResolvedValue('https://cdn.test/creator/7/reference-videos/leaves.mp4')
    })

    it('accepts image references independently of video model capabilities and duration rules', async () => {
        const response = await POST(request('image', 'banana'))
        expect(response.status).toBe(201)
        await expect(response.json()).resolves.toMatchObject({ data: { referenceVideo: { name: 'leaves.mp4', durationSeconds: 40 } } })
        expect(mocks.upload).toHaveBeenCalledWith(expect.any(String), 'creator/7/reference-videos', expect.any(String))
        await expect(fs.stat(path.dirname(mocks.upload.mock.calls[0][0]))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it.each([undefined, 'video'])('preserves video model duration validation for mode %s', async mode => {
        const response = await POST(request(mode))
        expect(response.status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('rejects files without a video stream in image mode', async () => {
        mocks.probe.mockResolvedValue({ hasVideo: false, duration: 40 })
        expect((await POST(request('image'))).status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('requires authentication before accepting image-mode uploads', async () => {
        mocks.user.mockReturnValue(null)
        expect((await POST(request('image'))).status).toBe(401)
        expect(mocks.probe).not.toHaveBeenCalled()
    })
})
