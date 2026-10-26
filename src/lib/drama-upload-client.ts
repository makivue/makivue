import { clientFetch, type ClientFetchInit } from './client-fetch'
import { CreatorUploadServiceTimeoutError, creatorUploadErrorMessage, readCreatorApiResponse } from './creator-api-response'
import { DRAMA_PART_BYTES, DRAMA_MIN_PART_BYTES, DRAMA_MAX_PART_BYTES, DRAMA_UPLOAD_PROTOCOL, validateDramaFile, validateDramaSubtitle, type DramaAsset, type DramaAssetKind } from './drama-upload'

const endpoint = '/api/drama-uploads/media'
const targetPartDuration = 8_000
const partTimeout = 30_000

type UploadPart = { number: number; etag: string; size?: number }
type UploadSession = { token: string; partSize?: number; protocol?: typeof DRAMA_UPLOAD_PROTOCOL }

class UploadRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly timeout: boolean,
        readonly retryAfterMs: number
    ) {
        super(message)
    }

    get retryable() {
        return this.timeout || [429, 502, 503, 504].includes(this.status)
    }
}

export async function dramaUploadRequest<T>(url: string, init: ClientFetchInit): Promise<T> {
    const response = await clientFetch(url, init)
    try {
        const body = await readCreatorApiResponse(response, 'upload')
        if (!response.ok || !body?.success) throw new Error(typeof body?.error === 'string' ? body.error : '上传失败，请稍后重试')
        return body.data as T
    } catch (error) {
        const retryAfter = response.headers.get('Retry-After')
        const seconds = retryAfter === null ? NaN : Number(retryAfter)
        const retryAfterMs = retryAfter === null ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()
        const timeout = response.status === 408 || response.status === 504 || error instanceof CreatorUploadServiceTimeoutError
        throw new UploadRequestError(
            error instanceof Error ? error.message : '上传失败，请稍后重试',
            response.status,
            timeout,
            Number.isFinite(retryAfterMs) ? Math.max(0, Math.min(30_000, retryAfterMs)) : 0
        )
    }
}

function isTimeout(error: unknown) {
    return (error instanceof UploadRequestError && error.timeout) || (error instanceof Error && error.name === 'TimeoutError')
}

function canRetry(error: unknown) {
    return error instanceof UploadRequestError ? error.retryable : error instanceof TypeError || isTimeout(error)
}

function waitToRetry(error: unknown, attempt: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const delay = Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 250), error instanceof UploadRequestError ? error.retryAfterMs : 0)
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer)
            reject(signal.reason)
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort)
            resolve()
        }, delay)
        signal.addEventListener('abort', abort, { once: true })
    })
}

export async function uploadDramaAsset(file: File, kind: DramaAssetKind, signal: AbortSignal, onProgress: (progress: number) => void): Promise<DramaAsset> {
    const invalid = validateDramaFile(kind, file)
    if (invalid) throw new Error(invalid)
    if (kind === 'subtitle') {
        const issue = validateDramaSubtitle(file.name, new Uint8Array(await file.arrayBuffer()))
        if (issue) throw new Error(issue)
    }
    signal.throwIfAborted()
    onProgress(0)
    const session = await dramaUploadRequest<UploadSession>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action: 'begin', kind, name: file.name, size: file.size, protocol: DRAMA_UPLOAD_PROTOCOL }),
        signal
    })
    const { token } = session
    const adaptive = session.protocol === DRAMA_UPLOAD_PROTOCOL
    let partSize = adaptive ? DRAMA_PART_BYTES : (session.partSize ?? DRAMA_PART_BYTES)
    let maximumPartSize = DRAMA_MAX_PART_BYTES
    let reportedProgress = 0
    const reportProgress = (bytes: number) => {
        // Retrying a smaller replacement for the same part must not move the UI backwards.
        reportedProgress = Math.max(reportedProgress, Math.min(99, Math.floor((bytes / file.size) * 100)))
        onProgress(reportedProgress)
    }
    try {
        if (!token || !Number.isSafeInteger(partSize) || partSize <= 0 || partSize > DRAMA_MAX_PART_BYTES) throw new Error('上传内容无效')
        const parts: UploadPart[] = []
        for (let offset = 0; offset < file.size;) {
            const number = parts.length + 1
            let chunk = file.slice(offset, offset + partSize)
            let part: UploadPart | undefined
            let elapsed = 0
            for (let attempt = 0; attempt < 3; attempt++) {
                const started = performance.now()
                try {
                    part = await dramaUploadRequest<UploadPart>(`${endpoint}?part=${number}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/octet-stream', 'x-upload-token': token },
                        body: chunk,
                        signal,
                        timeoutMs: adaptive ? partTimeout : 60_000,
                        suppressRateLimitToast: true
                    })
                    if (part?.number !== number || typeof part.etag !== 'string' || !part.etag || (adaptive && part.size !== chunk.size)) throw new Error('上传内容无效')
                    elapsed = Math.max(1, performance.now() - started)
                    break
                } catch (error) {
                    const tooLarge = adaptive && chunk.size > DRAMA_PART_BYTES && error instanceof UploadRequestError && error.status === 413
                    if (signal.aborted || attempt === 2 || !(canRetry(error) || tooLarge)) throw error
                    // A lost response can leave the previous local write running.
                    // The locked staging store safely replaces the same part number.
                    if (kind !== 'subtitle' && (tooLarge || (adaptive && isTimeout(error)))) {
                        // Some gateways also impose a smaller body-size limit than the application.
                        maximumPartSize = tooLarge ? DRAMA_PART_BYTES : Math.max(DRAMA_MIN_PART_BYTES, Math.min(DRAMA_PART_BYTES, Math.floor(chunk.size / 2)))
                        partSize = Math.min(partSize, maximumPartSize)
                        // The local staging store replaces a part with the same number, even if a previous response was lost.
                        chunk = file.slice(offset, offset + partSize)
                    }
                    await waitToRetry(error, attempt, signal)
                }
            }
            parts.push(part!)
            offset += chunk.size
            reportProgress(offset)
            if (adaptive) {
                const estimated = Math.floor(((chunk.size / elapsed) * targetPartDuration) / DRAMA_MIN_PART_BYTES) * DRAMA_MIN_PART_BYTES
                partSize = Math.max(DRAMA_MIN_PART_BYTES, Math.min(maximumPartSize, estimated))
            }
        }
        for (let attempt = 0; ; attempt++) {
            try {
                const result = await dramaUploadRequest<DramaAsset>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'complete', token, parts }), signal, timeoutMs: 60_000 })
                onProgress(100)
                return result
            } catch (error) {
                if (signal.aborted || attempt === 2 || !canRetry(error)) throw error
                await waitToRetry(error, attempt, signal)
            }
        }
    } catch (error) {
        await clientFetch(endpoint, { method: 'DELETE', headers: { 'x-upload-token': token }, timeoutMs: 15_000 }).catch(() => {})
        if (!signal.aborted && isTimeout(error)) throw new Error(creatorUploadErrorMessage(error))
        throw error
    }
}
