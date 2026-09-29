import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_REFERENCE_VIDEO_BYTES } from '@/lib/storyboard-reference-videos'

const mocks = vi.hoisted(() => ({ userId: vi.fn(), upload: vi.fn(), probe: vi.fn() }))
vi.mock('@/lib/current-user', () => ({ currentUserId: mocks.userId }))
vi.mock('@/services/local-media', async importOriginal => ({ ...(await importOriginal<typeof import('@/services/local-media')>()), saveLocalMediaFile: mocks.upload }))
vi.mock('@/services/ffmpeg', () => ({ probeMediaStreams: mocks.probe }))

import { POST } from './route'

const mp4Bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
const mediaUrl = 'https://media.example.com/replica/7/reference-videos/reference.mp4'

function request(file: File | string = new File([mp4Bytes], 'reference.mp4', { type: 'video/mp4' })) {
    const body = new FormData()
    body.set('file', file)
    return new NextRequest('http://localhost/api/replica/reference-video', { method: 'POST', body })
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.userId.mockReturnValue(7n)
    mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: true, duration: 12.3456 })
    mocks.upload.mockResolvedValue(mediaUrl)
})

describe('replica reference video upload', () => {
    it('rejects unauthenticated uploads before parsing the body', async () => {
        mocks.userId.mockReturnValue(null)
        const input = request()
        const parse = vi.spyOn(input, 'formData')
        expect((await POST(input)).status).toBe(401)
        expect(parse).not.toHaveBeenCalled()
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('rejects an oversized declared body before parsing', async () => {
        const input = request()
        input.headers.set('content-length', String(MAX_REFERENCE_VIDEO_BYTES + 2 * 1024 * 1024))
        const parse = vi.spyOn(input, 'formData')
        expect((await POST(input)).status).toBe(413)
        expect(parse).not.toHaveBeenCalled()
    })

    it('also enforces file size without a content-length header', async () => {
        const file = new File([mp4Bytes], 'reference.mp4', { type: 'video/mp4' })
        Object.defineProperty(file, 'size', { value: MAX_REFERENCE_VIDEO_BYTES + 1 })
        const body = new FormData()
        body.set('file', file)
        const input = request()
        vi.spyOn(input, 'formData').mockResolvedValue(body)
        expect((await POST(input)).status).toBe(413)
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it.each([
        ['a string instead of a file', 'reference.mp4', 400],
        ['an empty file', new File([], 'reference.mp4', { type: 'video/mp4' }), 400],
        ['an unsupported format', new File(['text'], 'note.txt', { type: 'text/plain' }), 415],
        ['a renamed non-video', new File(['not a video'], 'reference.mp4', { type: 'video/mp4' }), 422]
    ])('rejects %s without uploading', async (_description, file, status) => {
        expect((await POST(request(file))).status).toBe(status)
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it('rejects malformed multipart data', async () => {
        const input = new NextRequest('http://localhost/api/replica/reference-video', { method: 'POST', body: 'not multipart' })
        expect((await POST(input)).status).toBe(400)
        expect(mocks.upload).not.toHaveBeenCalled()
    })

    it.each([
        ['reference.mp4', 'video/mp4', mp4Bytes, '.mp4'],
        ['reference.MOV', '', mp4Bytes, '.mov'],
        ['reference.webm', 'video/webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0]), '.webm']
    ])('uploads %s to the authenticated user directory and cleans local files', async (name, mimeType, bytes, extension) => {
        mocks.upload.mockImplementation(async (localPath: string, subdir: string, filename: string) => {
            expect(await fs.readFile(localPath)).toEqual(Buffer.from(bytes))
            expect(subdir).toBe('replica/7/reference-videos')
            expect(filename).toMatch(new RegExp(`^[a-f0-9-]{36}\\${extension}$`))
            return mediaUrl
        })
        const response = await POST(request(new File([bytes], name, { type: mimeType })))
        expect(response.status).toBe(201)
        expect(await response.json()).toMatchObject({ success: true, data: { url: mediaUrl, name, sizeBytes: bytes.length, durationSeconds: 12.346 } })
        expect(mocks.probe).toHaveBeenCalledBefore(mocks.upload)
        await expect(fs.stat(path.dirname(mocks.upload.mock.calls[0][0]))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it.each([false, true])('rejects invalid video streams and cleans local files (probe throws: %s)', async probeThrows => {
        if (probeThrows) mocks.probe.mockRejectedValue(new Error('invalid container'))
        else mocks.probe.mockResolvedValue({ hasVideo: false, hasAudio: true, duration: 10 })
        expect((await POST(request())).status).toBe(422)
        expect(mocks.upload).not.toHaveBeenCalled()
        await expect(fs.stat(path.dirname(mocks.probe.mock.calls[0][0]))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('returns a safe error and cleans local files when local storage fails', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.upload.mockRejectedValue(new Error('internal provider detail'))
        try {
            const response = await POST(request())
            expect(response.status).toBe(500)
            expect(await response.json()).toEqual({ success: false, error: '参考视频上传失败，请稍后重试' })
            await expect(fs.stat(path.dirname(mocks.upload.mock.calls[0][0]))).rejects.toMatchObject({ code: 'ENOENT' })
        } finally {
            log.mockRestore()
        }
    })
})
