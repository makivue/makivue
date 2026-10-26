import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientFetchInit } from './client-fetch'
import { DRAMA_MAX_PART_BYTES, DRAMA_MIN_PART_BYTES, DRAMA_PART_BYTES, DRAMA_UPLOAD_PROTOCOL } from './drama-upload'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./client-fetch', async importOriginal => ({ ...(await importOriginal<typeof import('./client-fetch')>()), clientFetch: mocks.fetch }))
import { dramaUploadRequest, uploadDramaAsset } from './drama-upload-client'

type DramaUploadInit = ClientFetchInit & { onUploadProgress?: (loaded: number, total: number) => void }
type Call = [string, DramaUploadInit]
const success = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } })
const video = (size: number) => new File([new Uint8Array(size)], 'episode.mp4', { type: 'video/mp4' })
const result = { receipt: 'saved', name: 'episode.mp4', size: 12, url: '/api/local-media/drama-uploads/1/episode.mp4' }
const partCalls = () => (mocks.fetch.mock.calls as Call[]).filter(([, init]) => init.method === 'PUT')
const completeCalls = () => (mocks.fetch.mock.calls as Call[]).filter(([, init]) => init.method === 'POST' && JSON.parse(String(init.body)).action === 'complete')

function serveUploads(protocol: string | undefined = DRAMA_UPLOAD_PROTOCOL) {
    mocks.fetch.mockImplementation(async (url: string, init: DramaUploadInit) => {
        if (init.method === 'PUT') {
            const number = Number(new URL(url, 'https://example.com').searchParams.get('part'))
            return success({ number, etag: `etag-${number}`, size: (init.body as Blob).size })
        }
        if (init.method === 'DELETE') return success({ removed: true })
        const body = JSON.parse(String(init.body))
        return success(body.action === 'begin' ? { token: 'ticket', partSize: DRAMA_PART_BYTES, protocol } : result)
    })
}

beforeEach(() => {
    vi.resetAllMocks()
    serveUploads()
})
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('adaptive drama upload', () => {
    it('uploads the reported 67 MB file with nine serial parts, continuous progress and an exact manifest', async () => {
        const file = video(67_064_411)
        const progress = vi.fn()
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
        const normal = mocks.fetch.getMockImplementation()!
        mocks.fetch.mockImplementation(async (url: string, init: DramaUploadInit) => {
            if (init.method === 'PUT') {
                const size = (init.body as Blob).size
                init.onUploadProgress?.(size / 2, size)
                expect(completeCalls()).toHaveLength(0)
            }
            return normal(url, init)
        })
        expect(await uploadDramaAsset(file, 'video', new AbortController().signal, progress)).toEqual(result)
        const parts = partCalls()
        expect(parts).toHaveLength(9)
        expect((parts[0][1].body as Blob).size).toBe(DRAMA_PART_BYTES)
        expect((parts[1][1].body as Blob).size).toBe(DRAMA_MAX_PART_BYTES)
        const manifest = JSON.parse(String(completeCalls()[0][1].body)).parts
        expect(manifest.reduce((total: number, part: { size: number }) => total + part.size, 0)).toBe(file.size)
        expect(manifest.map((part: { number: number }) => part.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
        const values = progress.mock.calls.map(([value]) => value)
        expect(values.some(value => value > 0 && value < 100)).toBe(true)
        expect(values.at(-1)).toBe(100)
        expect(values.slice(0, -1).every(value => value < 100)).toBe(true)
        expect(values).toEqual([...values].sort((a, b) => a - b))
    })

    it('uses smaller parts on slow connections', async () => {
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20_000))
        await uploadDramaAsset(video(DRAMA_PART_BYTES * 2), 'video', new AbortController().signal, vi.fn())
        const sizes = partCalls().map(([, init]) => (init.body as Blob).size)
        expect(sizes).toEqual([DRAMA_PART_BYTES, DRAMA_MIN_PART_BYTES, DRAMA_MIN_PART_BYTES, DRAMA_MIN_PART_BYTES, DRAMA_MIN_PART_BYTES])
    })

    it('falls back to fixed 1 MiB parts when an older server ignores protocol negotiation', async () => {
        serveUploads(undefined)
        // An absent protocol is the response shape of the deployed legacy API.
        const normal = mocks.fetch.getMockImplementation()!
        mocks.fetch.mockImplementation(async (url: string, init: DramaUploadInit) => {
            const response = await normal(url, init)
            if (init.method === 'POST' && JSON.parse(String(init.body)).action === 'begin') return success({ token: 'legacy', partSize: DRAMA_PART_BYTES })
            return response
        })
        await uploadDramaAsset(video(DRAMA_PART_BYTES * 3 + 7), 'video', new AbortController().signal, vi.fn())
        expect(partCalls().map(([, init]) => (init.body as Blob).size)).toEqual([DRAMA_PART_BYTES, DRAMA_PART_BYTES, DRAMA_PART_BYTES, 7])
    })

    it.each([408, 200])('backs off and shrinks the same part after a gateway body timeout in HTTP %s', async status => {
        vi.useFakeTimers()
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
        const normal = mocks.fetch.getMockImplementation()!
        let failed = false
        const progress = vi.fn()
        mocks.fetch.mockImplementation(async (url: string, init: DramaUploadInit) => {
            if (init.method === 'PUT' && url.endsWith('part=2') && !failed) {
                failed = true
                init.onUploadProgress?.((init.body as Blob).size, (init.body as Blob).size)
                return new Response(JSON.stringify({ error_code: 'GW.0408', error_msg: 'request body timeout.' }), { status })
            }
            return normal(url, init)
        })
        const pending = uploadDramaAsset(video(DRAMA_PART_BYTES * 10), 'video', new AbortController().signal, progress)
        await vi.advanceTimersByTimeAsync(0)
        expect(partCalls()).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(999)
        expect(partCalls()).toHaveLength(2)
        await vi.runAllTimersAsync()
        await expect(pending).resolves.toEqual(result)
        const calls = partCalls()
        expect(calls[1][0]).toBe(calls[2][0])
        expect((calls[1][1].body as Blob).size).toBe(DRAMA_MAX_PART_BYTES)
        expect((calls[2][1].body as Blob).size).toBe(DRAMA_PART_BYTES)
        const values = progress.mock.calls.map(([value]) => value)
        expect(values).toEqual([...values].sort((a, b) => a - b))
        expect(JSON.parse(String(completeCalls()[0][1].body)).parts.reduce((total: number, part: { size: number }) => total + part.size, 0)).toBe(DRAMA_PART_BYTES * 10)
    })

    it('honors Retry-After without shrinking or immediately repeating a rate-limited part', async () => {
        vi.useFakeTimers()
        const normal = mocks.fetch.getMockImplementation()!
        let failed = false
        mocks.fetch.mockImplementation(async (url: string, init: DramaUploadInit) => {
            if (init.method === 'PUT' && !failed) {
                failed = true
                return new Response(JSON.stringify({ success: false, error: 'busy' }), { status: 429, headers: { 'Retry-After': '3' } })
            }
            return normal(url, init)
        })
        const pending = uploadDramaAsset(video(DRAMA_PART_BYTES), 'video', new AbortController().signal, vi.fn())
        await vi.advanceTimersByTimeAsync(2999)
        expect(partCalls()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        await pending
        expect(partCalls()).toHaveLength(2)
        expect((partCalls()[1][1].body as Blob).size).toBe(DRAMA_PART_BYTES)
    })

    it.each([504, 'TimeoutError'])('safely retries a smaller replacement when %s loses a response', async failure => {
        vi.useFakeTimers()
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
        const normal = mocks.fetch.getMockImplementation()!
        let failed = false
        mocks.fetch.mockImplementation(async (url: string, init: DramaUploadInit) => {
            if (init.method === 'PUT' && url.endsWith('part=2') && !failed) {
                failed = true
                const size = (init.body as Blob).size
                init.onUploadProgress?.(size, size)
                if (failure === 'TimeoutError') throw new DOMException('signal timed out', 'TimeoutError')
                return new Response(null, { status: failure })
            }
            return normal(url, init)
        })
        const pending = uploadDramaAsset(video(DRAMA_PART_BYTES * 10), 'video', new AbortController().signal, vi.fn())
        await vi.runAllTimersAsync()
        await expect(pending).resolves.toEqual(result)
        const calls = partCalls()
        expect(calls[1][0]).toBe(calls[2][0])
        expect((calls[2][1].body as Blob).size).toBe(DRAMA_PART_BYTES)
        expect(JSON.parse(String(completeCalls()[0][1].body)).parts.reduce((total: number, part: { size: number }) => total + part.size, 0)).toBe(DRAMA_PART_BYTES * 10)
    })

    it.each([401, 403, 413, 422])('does not retry HTTP %s and aborts the multipart session', async status => {
        const normal = mocks.fetch.getMockImplementation()!
        mocks.fetch.mockImplementation((url: string, init: DramaUploadInit) =>
            init.method === 'PUT' ? new Response(JSON.stringify({ success: false, error: 'invalid' }), { status }) : normal(url, init)
        )
        await expect(uploadDramaAsset(video(12), 'video', new AbortController().signal, vi.fn())).rejects.toThrow('invalid')
        expect(partCalls()).toHaveLength(1)
        expect(completeCalls()).toHaveLength(0)
        expect(mocks.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
    })

    it('falls back once to 1 MiB parts when the gateway rejects a larger body with 413', async () => {
        vi.useFakeTimers()
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
        const normal = mocks.fetch.getMockImplementation()!
        mocks.fetch.mockImplementation((url: string, init: DramaUploadInit) => {
            if (init.method === 'PUT' && (init.body as Blob).size > DRAMA_PART_BYTES) return new Response(null, { status: 413 })
            return normal(url, init)
        })
        const pending = uploadDramaAsset(video(DRAMA_PART_BYTES * 10), 'video', new AbortController().signal, vi.fn())
        await vi.runAllTimersAsync()
        await expect(pending).resolves.toEqual(result)
        expect((partCalls()[1][1].body as Blob).size).toBe(DRAMA_MAX_PART_BYTES)
        expect(
            partCalls()
                .slice(2)
                .every(([, init]) => (init.body as Blob).size <= DRAMA_PART_BYTES)
        ).toBe(true)
    })

    it('stops after three transient failures instead of retrying indefinitely', async () => {
        vi.useFakeTimers()
        const normal = mocks.fetch.getMockImplementation()!
        mocks.fetch.mockImplementation((url: string, init: DramaUploadInit) => (init.method === 'PUT' ? new Response(null, { status: 503 }) : normal(url, init)))
        const pending = uploadDramaAsset(video(12), 'video', new AbortController().signal, vi.fn())
        const assertion = expect(pending).rejects.toBeInstanceOf(Error)
        await vi.runAllTimersAsync()
        await assertion
        expect(partCalls()).toHaveLength(3)
        expect(completeCalls()).toHaveLength(0)
        expect(mocks.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
    })

    it('keeps subtitles in a single complete part for server-side cue validation, including timeout retries', async () => {
        vi.useFakeTimers()
        const file = new File(['1\n00:00:01,000 --> 00:00:02,000\n' + 'a'.repeat(700_000)], 'captions.srt')
        const normal = mocks.fetch.getMockImplementation()!
        let failed = false
        mocks.fetch.mockImplementation((url: string, init: DramaUploadInit) => {
            if (init.method === 'PUT' && !failed) {
                failed = true
                return new Response(null, { status: 408 })
            }
            return normal(url, init)
        })
        const pending = uploadDramaAsset(file, 'subtitle', new AbortController().signal, vi.fn())
        await vi.runAllTimersAsync()
        await expect(pending).resolves.toEqual(result)
        expect(partCalls().map(([, init]) => (init.body as Blob).size)).toEqual([file.size, file.size])
        expect(partCalls()[0][1].body).toBe(partCalls()[1][1].body)
    })

    it('cancels a pending retry immediately and cleans up without another PUT', async () => {
        vi.useFakeTimers()
        const abort = new AbortController()
        const normal = mocks.fetch.getMockImplementation()!
        mocks.fetch.mockImplementation((url: string, init: DramaUploadInit) => (init.method === 'PUT' ? new Response(null, { status: 503 }) : normal(url, init)))
        const pending = uploadDramaAsset(video(12), 'video', abort.signal, vi.fn())
        const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        await vi.advanceTimersByTimeAsync(100)
        abort.abort()
        await assertion
        await vi.runAllTimersAsync()
        expect(partCalls()).toHaveLength(1)
        expect(mocks.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
    })

    it('retries a lost completion response without uploading the file again or reporting 100 early', async () => {
        vi.useFakeTimers()
        const normal = mocks.fetch.getMockImplementation()!
        const progress = vi.fn()
        let failed = false
        mocks.fetch.mockImplementation((url: string, init: DramaUploadInit) => {
            if (init.method === 'POST' && JSON.parse(String(init.body)).action === 'complete' && !failed) {
                failed = true
                expect(progress).not.toHaveBeenCalledWith(100)
                return new Response(null, { status: 504 })
            }
            return normal(url, init)
        })
        const pending = uploadDramaAsset(video(12), 'video', new AbortController().signal, progress)
        await vi.runAllTimersAsync()
        await pending
        expect(partCalls()).toHaveLength(1)
        expect(completeCalls()).toHaveLength(2)
        expect(progress).toHaveBeenLastCalledWith(100)
    })

    it('shows the gateway timeout message instead of a generic JSON parsing error', async () => {
        mocks.fetch.mockResolvedValue(new Response('<html>Request Timeout</html>', { status: 408 }))
        await expect(dramaUploadRequest('/api/drama-uploads/media', { method: 'PUT' })).rejects.toThrow('请求体上传超时')
    })
})
