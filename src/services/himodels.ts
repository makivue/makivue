import { localMediaKey } from './local-media'
import { localFetch } from '@/lib/local-fetch'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import {
    getHiModelsImageModelCapability,
    isRetiredHiModelsVideoApiModel,
    isHiModelsTextModel,
    normalizeHiModelsImageSize,
    type HiModelsImageApiModel,
    type HiModelsTextModel,
    type HiModelsVideoApiModel
} from '@/lib/himodels-models'
import { HIMODELS_VEO_MODEL } from '@/lib/provider-labels'
import type { HiModelsResponseObserver } from '@/lib/himodels-response-diagnostics'
import type { HiModelsUsageObserver } from '@/lib/himodels-token-usage'
import { fetchHiModels } from './himodels-http'

const HIMODELS_BASE_URL = 'https://api.himodels.ai'
export const HIMODELS_VEO_LABEL = HIMODELS_VEO_MODEL

type HiModelsConfig = {
    apiKey: string
    baseUrl: string
}

export type HiModelsUsage = Record<string, number | string | boolean>
export type HiModelsAspectRatio = '1:1' | '21:9' | '16:9' | '9:16' | '4:3' | '3:4'

type HiModelsImageErrorCode =
    | 'HIMODELS_IMAGE_THINKING_ROUTE'
    | 'HIMODELS_IMAGE_ROUTE_UNAVAILABLE'
    | 'HIMODELS_IMAGE_EMPTY_RESPONSE'
    | 'HIMODELS_IMAGE_ASYNC_PENDING'
    | 'HIMODELS_IMAGE_SAFETY_BLOCK'
    | 'HIMODELS_IMAGE_PROVIDER_RESPONSE'

class HiModelsImageError extends Error {
    readonly name = 'HiModelsImageError'

    constructor(
        readonly code: HiModelsImageErrorCode,
        message: string,
        options?: ErrorOptions
    ) {
        super(`[${code}] ${message}`, options)
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

const HI_MODELS_UNSUPPORTED_THINKING_FIELDS = new Set(['thinkinglevel', 'thinkingconfig'])

/** Keep unsupported thinking controls out of every HiModels request family. */
export function stringifyHiModelsRequest(payload: unknown): string {
    return JSON.stringify(payload, (key, value) => (HI_MODELS_UNSUPPORTED_THINKING_FIELDS.has(key.replace(/[_-]/g, '').toLowerCase()) ? undefined : value))
}

/** Extract billing/token counters without exposing the rest of the provider response. */
export function extractHiModelsUsage(payload: unknown): HiModelsUsage | null {
    const usage: HiModelsUsage = {}
    const metricKey = /(?:usage|tokens?|token_count|tokencount|credits?|cost|billable)/i

    const collect = (value: unknown, pathParts: string[], insideUsage: boolean, depth: number) => {
        if (depth > 8 || (!isRecord(value) && !Array.isArray(value))) return
        for (const [key, child] of Object.entries(value)) {
            const nextPath = [...pathParts, key]
            const usageBranch = insideUsage || metricKey.test(key)
            if (typeof child === 'number' && Number.isFinite(child) && usageBranch) {
                usage[nextPath.join('.')] = child
            } else if (typeof child === 'boolean' && usageBranch) {
                usage[nextPath.join('.')] = child
            } else if (typeof child === 'string' && usageBranch && /^-?\d+(?:\.\d+)?$/.test(child.trim())) {
                usage[nextPath.join('.')] = child.trim()
            } else if (isRecord(child) || Array.isArray(child)) {
                collect(child, nextPath, usageBranch, depth + 1)
            }
        }
    }

    collect(payload, [], false, 0)
    return Object.keys(usage).length > 0 ? usage : null
}

/** Usage from the same idempotent image/video operation is cumulative, not additive. */
export function mergeHiModelsUsage(current: HiModelsUsage | null, incoming: HiModelsUsage | null): HiModelsUsage | null {
    if (!incoming) return current
    if (!current) return { ...incoming }

    return { ...current, ...incoming }
}

export async function getHiModelsRuntimeConfig(): Promise<HiModelsConfig> {
    const apiKey = process.env.HIMODELS_API_KEY?.trim()
    if (!apiKey) {
        throw new Error('Himodels API key 未配置，请在 .env 填写自己的 HIMODELS_API_KEY')
    }
    return {
        apiKey,
        baseUrl: (process.env.HIMODELS_BASE_URL?.trim() || HIMODELS_BASE_URL).replace(/\/$/, '')
    }
}

async function hiModelsError(response: Response, action: string) {
    const raw = (await response.text()).slice(0, 1200)
    try {
        const parsed: unknown = JSON.parse(raw)
        const record = isRecord(parsed) ? parsed : null
        const error = record && isRecord(record.error) ? record.error : null
        const providerMessage =
            (error && typeof error.message === 'string' ? error.message : null) ??
            (record && typeof record.error === 'string' ? record.error : null) ??
            (record && typeof record.error_msg === 'string' ? record.error_msg : null) ??
            (record && typeof record.message === 'string' ? record.message : null)
        const detail = providerMessage ? redactHiModelsDiagnostic(providerMessage) : inspectHiModelsEmptyImageResponse(parsed).details
        return new Error(`${action}失败（${response.status}）：${detail || '上游返回错误响应'}`)
    } catch {
        return new Error(`${action}失败（${response.status}）：${redactHiModelsDiagnostic(raw || '空响应')}`)
    }
}

export function isUnsupportedHiModelsThinkingParameter(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /(?:thinking[_ ]?level|thinkingConfig|thinking[_ ]?config)/i.test(message) && /(?:not\s+supported|unsupported|unknown|not\s+allowed|unrecognized)/i.test(message)
}

const HI_MODELS_IMAGE_ROUTE_MAX_ATTEMPTS = 3
const HI_MODELS_IMAGE_ROUTE_RETRY_DELAYS_MS = [2_000, 5_000] as const
const HI_MODELS_THINKING_ROUTE_RETRY_DELAYS_MS = [250, 750] as const
const HI_MODELS_EMPTY_IMAGE_RETRY_DELAY_MS = 500

function isHiModelsImageRouteUnavailable(status: number, error: unknown): boolean {
    if (status !== 503) return false
    const message = error instanceof Error ? error.message : String(error)
    return /global_price_route_exhausted|No available image provider for model/i.test(message)
}

function waitForHiModelsImageRouteRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Himodels 图片生成已取消'))
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, delayMs)
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal.reason instanceof Error ? signal.reason : new Error('Himodels 图片生成已取消'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

function imageMimeType(filePath: string, contentType?: string | null) {
    if (contentType?.startsWith('image/')) return contentType.split(';')[0]
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    if (ext === '.webp') return 'image/webp'
    if (ext === '.gif') return 'image/gif'
    return 'image/png'
}

async function referenceImagePart(source: string, signal?: AbortSignal) {
    if (/^data:image\//i.test(source)) {
        const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
        if (!match) throw new Error('Himodels Gemini 参考图 Data URL 格式无效')
        return { inlineData: { mimeType: match[1], data: match[2] } }
    }

    if (localMediaKey(source) || /^https?:\/\//i.test(source)) {
        const response = await localFetch(source, { signal: fetchTimeoutSignal(60_000, signal) })
        if (!response.ok) throw new Error(`Himodels Gemini 参考图下载失败（${response.status}）`)
        return {
            inlineData: {
                mimeType: imageMimeType(source, response.headers.get('content-type')),
                data: Buffer.from(await response.arrayBuffer()).toString('base64')
            }
        }
    }

    const localPath = resolveHiModelsLocalReferencePath(source)
    if (!localPath) throw new Error('Himodels Gemini 参考图路径无效')
    return { inlineData: { mimeType: imageMimeType(localPath), data: (await fs.readFile(/* turbopackIgnore: true */ localPath)).toString('base64') } }
}

export function resolveHiModelsLocalReferencePath(source: string, projectRoot = process.cwd()) {
    const publicRoot = path.resolve(/* turbopackIgnore: true */ projectRoot, 'public')
    const localPath = path.resolve(/* turbopackIgnore: true */ publicRoot, source.replace(/^[/\\]+/, ''))
    const relative = path.relative(publicRoot, localPath)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) ? localPath : null
}

export type HiModelsGeneratedImage = { url?: string; base64?: string }

function isSupportedImageBytes(bytes: Buffer): boolean {
    if (bytes.length < 12) return false
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
    if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return true
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return true
    if (bytes.subarray(0, 2).toString('ascii') === 'BM') return true
    if (bytes.subarray(0, 4).toString('hex') === '49492a00' || bytes.subarray(0, 4).toString('hex') === '4d4d002a') return true
    if (bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(?:avif|avis|heic|heix|mif1|msf1)$/.test(bytes.subarray(8, 12).toString('ascii'))) return true
    return false
}

function imageFromBase64(value: string): HiModelsGeneratedImage | null {
    const compact = value.replace(/\s+/g, '')
    if (compact.length < 16 || !/^[a-z0-9+/_-]+={0,2}$/i.test(compact)) return null
    try {
        return isSupportedImageBytes(Buffer.from(compact, 'base64')) ? { base64: compact } : null
    } catch {
        return null
    }
}

function imageFromString(value: unknown, allowBareBase64 = false, allowRemoteUrl = true): HiModelsGeneratedImage | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^https?:\/\//i.test(trimmed)) return allowBareBase64 && allowRemoteUrl ? { url: trimmed } : null
    const dataUrl = trimmed.match(/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?;base64,([\s\S]+)$/i)
    if (dataUrl?.[1]) return allowBareBase64 ? imageFromBase64(dataUrl[1]) : null
    if (!allowBareBase64) return null
    return imageFromBase64(trimmed)
}

/**
 * HiModels may return an OpenAI image payload, a native Gemini payload, a
 * Vertex prediction, or one of those wrapped in a gateway envelope.
 */
export function extractHiModelsGeneratedImage(payload: unknown): HiModelsGeneratedImage | null {
    const extract = (allowRemoteUrls: boolean): HiModelsGeneratedImage | null => {
        const visited = new WeakSet<object>()

        const visit = (value: unknown, depth: number, allowBareBase64 = false): HiModelsGeneratedImage | null => {
            if (depth > 8) return null
            if (typeof value === 'string') return imageFromString(value, allowBareBase64, allowRemoteUrls)
            if (Array.isArray(value)) {
                for (const item of value) {
                    const image = visit(item, depth + 1, allowBareBase64)
                    if (image) return image
                }
                return null
            }
            if (!isRecord(value) || visited.has(value)) return null
            visited.add(value)

            if (allowBareBase64 && allowRemoteUrls) {
                for (const key of ['url', 'uri', 'fileUri', 'file_uri'] as const) {
                    const image = imageFromString(value[key], true, true)
                    if (image) return image
                }
            }
            for (const key of ['b64_json', 'b64Json', 'base64', 'imageBytes', 'image_bytes', 'bytesBase64Encoded', 'bytes_base64_encoded'] as const) {
                const image = imageFromString(value[key], true, false)
                if (image) return image
            }
            if (allowBareBase64) {
                const image = imageFromString(value.data, true, false)
                if (image) return image
            }
            const mimeType = typeof value.mimeType === 'string' ? value.mimeType : typeof value.mime_type === 'string' ? value.mime_type : ''
            if (mimeType.toLowerCase().startsWith('image/')) {
                const image = imageFromString(value.data, true, false)
                if (image) return image
            }

            for (const key of ['inlineData', 'inline_data', 'fileData', 'file_data', 'image_url', 'imageUrl', 'image'] as const) {
                const child = value[key]
                if (isRecord(child)) {
                    const image = visit(child, depth + 1, true)
                    if (image) return image
                } else {
                    const image = imageFromString(child, true, allowRemoteUrls)
                    if (image) return image
                }
            }

            if (value.type === 'image_generation_call') {
                const image = imageFromString(value.result, true, false)
                if (image) return image
            }

            for (const key of ['images', 'generatedImages', 'generated_images', 'predictions'] as const) {
                const image = visit(value[key], depth + 1, true)
                if (image) return image
            }
            for (const key of ['data', 'candidates', 'response', 'result', 'output', 'choices', 'message', 'content', 'parts'] as const) {
                const image = visit(value[key], depth + 1, key === 'data')
                if (image) return image
            }
            return null
        }

        return visit(payload, 0)
    }

    // Prefer inline bytes over URLs so a task/status URL cannot hide an image
    // that exists elsewhere in the same gateway response.
    return extract(false) ?? extract(true)
}

export type HiModelsEmptyImageDiagnosis = {
    retryable: boolean
    blocked: boolean
    details: string
}

const HI_MODELS_DIAGNOSTIC_CHILD_KEYS = new Set([
    'response',
    'result',
    'output',
    'data',
    'candidates',
    'choices',
    'message',
    'content',
    'parts',
    'predictions',
    'images',
    'generatedImages',
    'generated_images',
    'promptFeedback',
    'prompt_feedback',
    'error'
])

function redactHiModelsDiagnostic(value: string, sensitiveValues: string[] = [], maxLength = 300) {
    let redacted = value.replace(/\s+/g, ' ').trim()
    for (const sensitiveValue of sensitiveValues) {
        const normalized = sensitiveValue.trim()
        if (normalized.length >= 8) redacted = redacted.split(normalized).join('[redacted-input]')
    }
    redacted = redacted
        .replace(/data:image\/[a-z0-9.+-]+(?:;[^,\s]*)?;base64,[a-z0-9+/_=-]+/gi, '[redacted-image-data]')
        .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
        .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|signature|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    return redacted.slice(0, maxLength)
}

/** Builds a bounded diagnostic without including prompts, image bytes or signed URLs. */
export function inspectHiModelsEmptyImageResponse(payload: unknown, sensitiveValues: string[] = []): HiModelsEmptyImageDiagnosis {
    const identifiers = new Set<string>()
    const reasons = new Set<string>()
    const messages = new Set<string>()
    let explicitError = false
    const visited = new WeakSet<object>()
    const identifierKeys = /^(?:request_?id|response_?id|trace_?id|gw_?trace_?id)$/i
    const reasonKeys = /^(?:finish_?reason|block_?reason|rai_?filtered_?reason|filtered_?reason|error_?code|code|status)$/i
    const messageKeys = /^(?:finish_?message|block_?reason_?message|error_?msg|error_?message|message)$/i

    const collect = (value: unknown, depth: number) => {
        if (depth > 7 || !value || typeof value !== 'object' || visited.has(value as object)) return
        visited.add(value as object)
        if (Array.isArray(value)) {
            for (const child of value.slice(0, 12)) collect(child, depth + 1)
            return
        }
        const record = value as Record<string, unknown>
        const errorCode = record.error_code
        const responseCode = record.code
        const normalizedErrorCode = typeof errorCode === 'string' || typeof errorCode === 'number' ? String(errorCode).trim() : ''
        const normalizedResponseCode = typeof responseCode === 'string' || typeof responseCode === 'number' ? String(responseCode).trim() : ''
        const isFailureCode = (code: string) => code !== '' && !/^(?:0|2\d\d|OK|SUCCESS|SUCCEEDED)$/i.test(code)
        const failedStatus = typeof record.status === 'string' && /^(?:failed|error|cancelled|canceled)$/i.test(record.status.trim())
        if (
            record.success === false ||
            (typeof record.error === 'string' && record.error.trim()) ||
            (isRecord(record.error) && Object.keys(record.error).length > 0) ||
            isFailureCode(normalizedErrorCode) ||
            isFailureCode(normalizedResponseCode) ||
            failedStatus
        ) {
            explicitError = true
        }
        for (const [key, child] of Object.entries(record)) {
            if (identifierKeys.test(key) && (typeof child === 'string' || typeof child === 'number')) {
                identifiers.add(`${key}=${redactHiModelsDiagnostic(String(child), sensitiveValues, 120)}`)
            }
            if (reasonKeys.test(key) && (typeof child === 'string' || typeof child === 'number')) {
                reasons.add(`${key}=${redactHiModelsDiagnostic(String(child), sensitiveValues, 120)}`)
            }
            if (messageKeys.test(key) && typeof child === 'string' && child.trim()) {
                messages.add(`${key}=${redactHiModelsDiagnostic(child, sensitiveValues)}`)
            }
            if (child && typeof child === 'object' && HI_MODELS_DIAGNOSTIC_CHILD_KEYS.has(key)) collect(child, depth + 1)
        }
    }
    collect(payload, 0)

    const reasonText = [...reasons].join(' | ')
    const messageText = [...messages].join(' | ')
    const blocked =
        /(?:IMAGE[_ ]?SAFETY|SAFETY|PROHIBITED(?:[_ ]?CONTENT)?|BLOCKLIST|RECITATION|CONTENT[_ ]?FILTER|BLOCKED|FILTERED)/i.test(reasonText) ||
        /(?:blocked by policy|unsafe generated image|usage guidelines|filtered out)/i.test(messageText)
    const topLevelKeys = isRecord(payload)
        ? Object.keys(payload)
              .filter(key => HI_MODELS_DIAGNOSTIC_CHILD_KEYS.has(key) || identifierKeys.test(key) || reasonKeys.test(key) || messageKeys.test(key) || key === 'success')
              .slice(0, 20)
              .join(',')
        : Array.isArray(payload)
          ? 'array'
          : typeof payload
    const details = [`topLevelKeys=${topLevelKeys || 'none'}`, ...identifiers, ...reasons, ...messages].filter(Boolean).join(' | ').slice(0, 1600)
    return { retryable: !blocked && !explicitError, blocked, details }
}

function extractHiModelsPendingImageTask(payload: unknown): { taskId?: string; status?: string } | null {
    const taskIds: string[] = []
    const pendingStatuses: string[] = []
    const visited = new WeakSet<object>()

    const visit = (value: unknown, depth: number) => {
        if (depth > 7 || !value || typeof value !== 'object' || visited.has(value as object)) return
        visited.add(value as object)
        if (Array.isArray(value)) {
            for (const child of value.slice(0, 12)) visit(child, depth + 1)
            return
        }
        const record = value as Record<string, unknown>
        for (const key of ['task_id', 'taskId', 'id', 'name'] as const) {
            const candidate = record[key]
            if (typeof candidate === 'string' && candidate.trim()) taskIds.push(candidate.trim())
        }
        if (typeof record.status === 'string' && /^(?:queued|pending|processing|running)$/i.test(record.status.trim())) {
            pendingStatuses.push(record.status.trim())
        }
        for (const [key, child] of Object.entries(record)) {
            if (child && typeof child === 'object' && HI_MODELS_DIAGNOSTIC_CHILD_KEYS.has(key)) visit(child, depth + 1)
        }
    }
    visit(payload, 0)

    if (pendingStatuses.length === 0) return null
    return { taskId: taskIds[0], status: pendingStatuses[0] }
}

async function writeValidatedGeneratedImage(bytes: Buffer, outputPath: string, invalidMessage: string) {
    if (!isSupportedImageBytes(bytes)) throw new Error(invalidMessage)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, bytes)
}

async function saveGeneratedImage(image: { url?: string; base64?: string }, outputPath: string, signal?: AbortSignal) {
    if (image.base64) {
        await writeValidatedGeneratedImage(Buffer.from(image.base64, 'base64'), outputPath, 'Himodels 返回的 Base64 内容不是受支持的图片格式')
        return
    }
    if (!image.url) throw new Error('Himodels 未返回图片内容')
    const download = await localFetch(image.url, { signal: fetchTimeoutSignal(120_000, signal) })
    if (!download.ok) throw new Error(`Himodels 图片下载失败（${download.status}）`)
    await writeValidatedGeneratedImage(Buffer.from(await download.arrayBuffer()), outputPath, 'Himodels 图片下载结果不是受支持的图片格式')
}

export function buildHiModelsImageRequest(params: {
    model: HiModelsImageApiModel
    prompt: string
    aspectRatio?: HiModelsAspectRatio
    imageSize?: '1K' | '2K' | '4K'
    referenceParts?: Array<{ inlineData: { mimeType: string; data: string } }>
}) {
    const capability = getHiModelsImageModelCapability(params.model)
    const imageSize = normalizeHiModelsImageSize(params.model, params.imageSize)
    if (capability.requestFamily === 'gemini') {
        return {
            model: params.model,
            contents: [{ role: 'user', parts: [{ text: params.prompt }, ...(params.referenceParts ?? [])] }],
            generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: params.aspectRatio ?? '9:16', imageSize }
            }
        }
    }
    return {
        model: params.model,
        prompt: params.prompt,
        ...(capability.sequentialImageGeneration ? { sequential_image_generation: 'disabled', response_format: 'url', stream: false } : {}),
        size: imageSize,
        output_format: 'png',
        watermark: false
    }
}

export async function generateHiModelsImage(params: {
    model: HiModelsImageApiModel
    prompt: string
    outputPath: string
    aspectRatio?: HiModelsAspectRatio
    imageSize?: '1K' | '2K' | '4K'
    referenceImages?: string[]
    signal?: AbortSignal
}) {
    const operationSignal = fetchTimeoutSignal(210_000, params.signal)
    const { apiKey, baseUrl } = await getHiModelsRuntimeConfig()
    const capability = getHiModelsImageModelCapability(params.model)
    const referenceParts =
        capability.maxReferenceImages > 0 ? await Promise.all((params.referenceImages ?? []).slice(0, capability.maxReferenceImages).map(source => referenceImagePart(source, operationSignal))) : []
    const createIdempotencyKey = () => `himodels-image-${randomUUID()}`
    const submit = (idempotencyKey: string) =>
        fetchHiModels(
            `${baseUrl}/v1/images/generations`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': idempotencyKey },
                body: stringifyHiModelsRequest(buildHiModelsImageRequest({ ...params, referenceParts })),
                signal: operationSignal
            },
            { model: `${params.model}`, apiKey }
        )
    const submitWithRouteRecovery = async (initialIdempotencyKey: string) => {
        let idempotencyKey = initialIdempotencyKey
        for (let routeAttempt = 0; routeAttempt < HI_MODELS_IMAGE_ROUTE_MAX_ATTEMPTS; routeAttempt += 1) {
            operationSignal.throwIfAborted()
            const response = await submit(idempotencyKey)
            if (response.ok) return { response, idempotencyKey }

            const providerError = await hiModelsError(response, `${params.model}`)
            const thinkingRouteIncompatible = response.status === 400 && isUnsupportedHiModelsThinkingParameter(providerError)
            const routeUnavailable = isHiModelsImageRouteUnavailable(response.status, providerError)
            if (!thinkingRouteIncompatible && !routeUnavailable) throw providerError
            if (routeAttempt === HI_MODELS_IMAGE_ROUTE_MAX_ATTEMPTS - 1) {
                if (thinkingRouteIncompatible) {
                    throw new HiModelsImageError(
                        'HIMODELS_IMAGE_THINKING_ROUTE',
                        `${params.model} 的上游图片线路不兼容：客户端请求未发送 thinkingLevel，但线路仍返回 thinking_level 不支持。已使用新幂等键保持同一模型重新选路 ${HI_MODELS_IMAGE_ROUTE_MAX_ATTEMPTS} 次，未切换模型；请检查 HiModels 上游路由配置。上游详情：${providerError.message}`,
                        { cause: providerError }
                    )
                }
                throw new HiModelsImageError(
                    'HIMODELS_IMAGE_ROUTE_UNAVAILABLE',
                    `HiModels 当前没有 ${params.model} 的可用图片线路，已保持所选模型重试 ${HI_MODELS_IMAGE_ROUTE_MAX_ATTEMPTS} 次，未切换其他模型。请稍后重试，或联系管理员检查该模型的价格路由与供应商库存。上游详情：${providerError.message}`,
                    { cause: providerError }
                )
            }
            if (thinkingRouteIncompatible) {
                // A 400 means generation was rejected before acceptance. A fresh
                // key lets the gateway choose another route without replaying a
                // potentially billable accepted request.
                idempotencyKey = createIdempotencyKey()
                await waitForHiModelsImageRouteRetry(HI_MODELS_THINKING_ROUTE_RETRY_DELAYS_MS[routeAttempt] ?? HI_MODELS_THINKING_ROUTE_RETRY_DELAYS_MS.at(-1)!, operationSignal)
            } else {
                // Keep the same key for availability retries so an ambiguous
                // gateway failure cannot create and bill a duplicate image.
                await waitForHiModelsImageRouteRetry(HI_MODELS_IMAGE_ROUTE_RETRY_DELAYS_MS[routeAttempt] ?? HI_MODELS_IMAGE_ROUTE_RETRY_DELAYS_MS.at(-1)!, operationSignal)
            }
        }
        throw new HiModelsImageError('HIMODELS_IMAGE_ROUTE_UNAVAILABLE', `${params.model} 图片线路重试状态异常`)
    }
    let usage: HiModelsUsage | null = null
    let idempotencyKey = createIdempotencyKey()
    for (let attempt = 0; attempt < 2; attempt += 1) {
        operationSignal.throwIfAborted()
        const submission = await submitWithRouteRecovery(idempotencyKey)
        const response = submission.response
        // An empty-response retry must reuse the key of the request that was
        // accepted. This makes the retry safe even when the upstream response
        // was ambiguous and may already have incurred a charge.
        idempotencyKey = submission.idempotencyKey

        const contentType = response.headers.get('content-type') ?? ''
        const responseBytes = Buffer.from(await response.arrayBuffer())
        if (isSupportedImageBytes(responseBytes)) {
            await writeValidatedGeneratedImage(responseBytes, params.outputPath, `${params.model} 返回的二进制内容不是受支持的图片格式`)
            return { referenceImagesApplied: referenceParts.length > 0, usage }
        }
        if (contentType.toLowerCase().startsWith('image/')) {
            throw new Error(`${params.model} 返回的二进制内容不是受支持的图片格式`)
        }

        const raw = responseBytes.toString('utf8')
        let payload: unknown
        try {
            payload = raw.trim() ? JSON.parse(raw) : null
        } catch {
            payload = raw
        }
        usage = mergeHiModelsUsage(usage, extractHiModelsUsage(payload))
        const image = extractHiModelsGeneratedImage(payload)
        if (image) {
            await saveGeneratedImage(image, params.outputPath, operationSignal)
            return { referenceImagesApplied: referenceParts.length > 0, usage }
        }

        const diagnosis = inspectHiModelsEmptyImageResponse(payload, [params.prompt])
        const headerIdentifiers = [
            ['x-request-id', response.headers.get('x-request-id')],
            ['request-id', response.headers.get('request-id')],
            ['x-trace-id', response.headers.get('x-trace-id')],
            ['trace-id', response.headers.get('trace-id')],
            ['gw-trace-id', response.headers.get('gw-trace-id')],
            ['gw_trace_id', response.headers.get('gw_trace_id')]
        ]
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
            .map(([key, value]) => `${key}=${redactHiModelsDiagnostic(value, [], 120)}`)
        const parseDetails = !raw.trim() ? 'empty response body' : typeof payload === 'string' ? `non-JSON response length=${raw.length}` : ''
        const details = [diagnosis.details, ...headerIdentifiers, parseDetails].filter(Boolean).join(' | ').slice(0, 1800)
        if (!diagnosis.retryable) {
            const category = diagnosis.blocked ? '上游安全策略未返回图片' : '上游在成功响应中返回错误'
            throw new HiModelsImageError(diagnosis.blocked ? 'HIMODELS_IMAGE_SAFETY_BLOCK' : 'HIMODELS_IMAGE_PROVIDER_RESPONSE', `${params.model} ${category}：${details}`)
        }
        const pendingTask = extractHiModelsPendingImageTask(payload)
        if (response.status === 202 || pendingTask) {
            const taskDetails = [
                pendingTask?.status ? `status=${redactHiModelsDiagnostic(pendingTask.status, [], 80)}` : '',
                pendingTask?.taskId ? `taskId=${redactHiModelsDiagnostic(pendingTask.taskId, [], 120)}` : ''
            ]
                .filter(Boolean)
                .join(' | ')
            throw new HiModelsImageError(
                'HIMODELS_IMAGE_ASYNC_PENDING',
                `${params.model} 返回异步图片任务但尚未返回图片；为避免重复生成和重复计费，未再次提交${taskDetails ? `（${taskDetails}）` : ''}：${details}`
            )
        }
        if (diagnosis.retryable && attempt === 0) {
            operationSignal.throwIfAborted()
            console.warn(`[Himodels] ${params.model} returned 2xx without a recognized image; retrying the same selected model once: ${details}`)
            await waitForHiModelsImageRouteRetry(HI_MODELS_EMPTY_IMAGE_RETRY_DELAY_MS, operationSignal)
            continue
        }
        throw new HiModelsImageError('HIMODELS_IMAGE_EMPTY_RESPONSE', `${params.model} 连续两次未返回图片内容：${details}`)
    }

    throw new HiModelsImageError('HIMODELS_IMAGE_EMPTY_RESPONSE', `${params.model} 未返回图片内容`)
}

export async function chatHiModels(
    model: HiModelsTextModel,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: { json?: boolean; temperature?: number; maxTokens?: number; signal?: AbortSignal; onResponse?: HiModelsResponseObserver; onUsage?: HiModelsUsageObserver } = {}
) {
    if (!isHiModelsTextModel(model)) throw new Error(`不支持的 Himodels 文本模型：${model}`)
    const { apiKey, baseUrl } = await getHiModelsRuntimeConfig()
    const callId = randomUUID()
    const response = await fetchHiModels(
        `${baseUrl}/v1/chat/completions`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: stringifyHiModelsRequest({
                model,
                messages,
                ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
                ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
                ...(options.json ? { response_format: { type: 'json_object' } } : {})
            }),
            signal: options.signal
        },
        { model, apiKey, callId, onResponse: options.onResponse, onUsage: options.onUsage }
    )
    if (!response.ok) throw await hiModelsError(response, model)
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content === 'string' && content) return content
    if (Array.isArray(content)) {
        const text = content.map(part => (typeof part.text === 'string' ? part.text : '')).join('')
        if (text) return text
    }
    throw new Error(`${model} 未返回文本内容`)
}

export type HiModelsVideoStatus = {
    id?: string
    name?: string
    task_id?: string
    status?: string
    done?: boolean
    error?: { message?: string } | string
    message?: string
    content?: unknown
    output?: unknown
    response?: unknown
}

export type HiModelsVideoReferenceImage = {
    url: string
    role: 'first_frame' | 'last_frame' | 'reference_image'
}

export function buildHiModelsVideoRequest(params: {
    model: HiModelsVideoApiModel
    prompt: string
    aspectRatio: '21:9' | '16:9' | '9:16' | '1:1'
    duration: number
    referenceImages?: HiModelsVideoReferenceImage[]
    referenceVideos?: Array<{ url: string; durationSeconds?: number }>
}) {
    if (params.model === 'seedance-2.0-global' || params.model === 'seedance-2.5-global' || params.model === 'MiniMax-H3') {
        return {
            model: params.model,
            content: [
                { type: 'text', text: params.prompt },
                ...(params.referenceImages ?? []).map(image => ({ type: 'image_url', image_url: { url: image.url }, role: image.role })),
                ...(params.referenceVideos ?? []).map(video => ({ type: 'video_url', video_url: { url: video.url }, role: 'reference_video' }))
            ],
            ratio: params.aspectRatio,
            duration: params.duration,
            resolution: params.model === 'MiniMax-H3' ? '2K' : '720p'
        }
    }
    return {
        model: params.model,
        instances: [{ prompt: params.prompt }],
        parameters: {
            aspectRatio: params.aspectRatio,
            duration: params.duration,
            resolution: '720p',
            personGeneration: 'allow_all',
            numberOfVideos: 1
        }
    }
}

export async function createHiModelsVideoTask(params: {
    model: HiModelsVideoApiModel
    prompt: string
    aspectRatio: '21:9' | '16:9' | '9:16' | '1:1'
    duration: number
    referenceImages?: HiModelsVideoReferenceImage[]
    referenceVideos?: Array<{ url: string; durationSeconds?: number }>
    signal?: AbortSignal
}) {
    if (isRetiredHiModelsVideoApiModel(params.model)) throw new Error('不支持的视频模型')
    const { apiKey, baseUrl } = await getHiModelsRuntimeConfig()
    const requestBody = {
        ...buildHiModelsVideoRequest(params),
        model: params.model === 'seedance-2.5-global' ? process.env.HIMODELS_SEEDANCE_25_MODEL?.trim() || params.model : params.model
    }
    const inputVideoDuration = (params.referenceVideos ?? []).reduce((total, video) => total + (Number.isFinite(video.durationSeconds) ? Math.max(0, video.durationSeconds ?? 0) : 0), 0)
    const response = await fetchHiModels(
        `${baseUrl}/v1/video/generations`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: stringifyHiModelsRequest(requestBody),
            signal: fetchTimeoutSignal(60_000, params.signal)
        },
        {
            model: `${requestBody.model}`,
            apiKey,
            billingRequestBody: inputVideoDuration > 0 ? { ...requestBody, input_video_duration: inputVideoDuration } : requestBody
        }
    )
    if (!response.ok) throw await hiModelsError(response, `${params.model}`)
    const payload = (await response.json()) as HiModelsVideoStatus
    const taskId = payload.name ?? payload.id ?? payload.task_id
    if (!taskId) throw new Error(`${params.model} 未返回任务 ID`)
    return { taskId, requestBody, usage: extractHiModelsUsage(payload) }
}

export async function getHiModelsVideoTask(taskId: string, signal?: AbortSignal, model = 'HiModels video status'): Promise<HiModelsVideoStatus> {
    const { apiKey, baseUrl } = await getHiModelsRuntimeConfig()
    const response = await fetchHiModels(
        `${baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`,
        {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: 'no-store',
            signal: fetchTimeoutSignal(30_000, signal)
        },
        { model, apiKey }
    )
    if (!response.ok) throw await hiModelsError(response, 'Himodels 视频任务查询')
    return response.json() as Promise<HiModelsVideoStatus>
}
