import { localFetch } from '@/lib/local-fetch'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import { createConcurrencyLimiter } from '@/lib/bounded-concurrency'
import { QWEN_IMAGE_MAX_REFERENCES } from '@/lib/provider-capabilities'
import { getQwenImageSize, type ImageQuality, type QwenImageAspectRatio } from '@/lib/image-quality'
import { fetchMeteredProvider, reportProviderTokenUsage } from '@/lib/provider-token-usage.server'

export const QWEN_IMAGE_3_PRO_MODEL = 'qwen-image-3.0-pro'
export const QWEN_IMAGE_MAX_CONCURRENCY = 5

const withGenerationSubmitSlot = createConcurrencyLimiter(QWEN_IMAGE_MAX_CONCURRENCY)
const synchronousOnlyBaseUrls = new Set<string>()

export class QwenImageRateLimitError extends Error {
    readonly code = 'QWEN_IMAGE_RATE_LIMIT'

    constructor(readonly responseBody: string) {
        super(`Qwen-Image API 限流（429）：${responseBody}`)
        this.name = 'QwenImageRateLimitError'
    }
}

type QwenImageResponse = {
    output?: {
        task_id?: string
        task_status?: string
        message?: string
        results?: Array<{ url?: string }>
        choices?: Array<{ message?: { content?: Array<{ image?: string; image_url?: { url?: string } | string }> } }>
    }
    data?: Array<{ url?: string }>
    message?: string
}

function isAsyncUnsupported(status: number, body: string) {
    return status === 403 && /does not support asynchronous calls/i.test(body)
}

function isRateLimited(status: number, body: string) {
    return status === 429 || /Throttling\.RateQuota/i.test(body)
}

function parseJsonResponse(body: string): QwenImageResponse {
    try {
        const parsed = JSON.parse(body)
        if (!parsed || typeof parsed !== 'object') throw new Error()
        return parsed as QwenImageResponse
    } catch {
        throw new Error(`Qwen-Image 返回了无效响应：${body || '空响应'}`)
    }
}

async function submitGeneration(params: { baseUrl: string; apiKey: string; requestBody: unknown; signal?: AbortSignal }) {
    return withGenerationSubmitSlot(async () => {
        let asynchronous = !synchronousOnlyBaseUrls.has(params.baseUrl)
        while (true) {
            const url = `${params.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`
            const sentAt = new Date().toISOString()
            const response = await fetchMeteredProvider(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${params.apiKey}`,
                        ...(asynchronous ? { 'X-DashScope-Async': 'enable' } : {})
                    },
                    body: JSON.stringify(params.requestBody),
                    signal: fetchTimeoutSignal(90_000, params.signal)
                },
                { provider: 'qwen', model: QWEN_IMAGE_3_PRO_MODEL }
            )
            const responseBody = await response.text()
            let responsePayload: unknown = responseBody
            try {
                responsePayload = JSON.parse(responseBody)
            } catch {}
            const taskId = (responsePayload as QwenImageResponse)?.output?.task_id
            await reportProviderTokenUsage({
                provider: 'qwen',
                model: QWEN_IMAGE_3_PRO_MODEL,
                endpoint: new URL(url).pathname,
                response,
                payload: responsePayload,
                sentAt,
                operationKey: taskId ? `qwen-image:${taskId}` : undefined
            })
            if (response.ok) return parseJsonResponse(responseBody)

            if (asynchronous && isAsyncUnsupported(response.status, responseBody)) {
                synchronousOnlyBaseUrls.add(params.baseUrl)
                asynchronous = false
                continue
            }

            if (isRateLimited(response.status, responseBody)) {
                throw new QwenImageRateLimitError(responseBody)
            }

            throw new Error(`Qwen-Image API 错误（${response.status}）：${responseBody}`)
        }
    })
}

function imageMimeType(filePath: string) {
    const extension = path.extname(filePath).toLowerCase()
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
    if (extension === '.webp') return 'image/webp'
    if (extension === '.gif') return 'image/gif'
    return 'image/png'
}

function isWithinDirectory(root: string, candidate: string) {
    const relative = path.relative(root, candidate)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** Resolve legacy /storage paths and absolute generated paths without allowing arbitrary project reads. */
export function resolveQwenLocalImagePath(source: string, projectRoot = process.cwd()) {
    const storageRoot = path.resolve(/* turbopackIgnore: true */ projectRoot, 'public', 'storage')
    let candidate: string
    if (source.startsWith('/storage/')) {
        candidate = path.resolve(/* turbopackIgnore: true */ storageRoot, source.slice('/storage/'.length))
    } else if (source.startsWith('storage/')) {
        candidate = path.resolve(/* turbopackIgnore: true */ storageRoot, source.slice('storage/'.length))
    } else if (path.isAbsolute(source)) {
        candidate = path.resolve(/* turbopackIgnore: true */ source)
    } else {
        return null
    }
    return isWithinDirectory(storageRoot, candidate) ? candidate : null
}

async function toQwenImageInput(source: string) {
    if (/^https?:\/\//i.test(source) || /^data:image\//i.test(source)) return source
    const localPath = resolveQwenLocalImagePath(source)
    if (!localPath || !fsSync.existsSync(/* turbopackIgnore: true */ localPath)) return null
    const content = await fs.readFile(/* turbopackIgnore: true */ localPath)
    return `data:${imageMimeType(localPath)};base64,${content.toString('base64')}`
}

function imageUrlFromOutput(data: unknown): string | null {
    const payload = data as QwenImageResponse
    const content = payload.output?.choices?.[0]?.message?.content ?? []
    for (const item of content) {
        const imageUrl = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url
        if (item.image || imageUrl) return item.image ?? imageUrl ?? null
    }
    return payload.output?.results?.[0]?.url ?? payload.data?.[0]?.url ?? null
}

async function downloadImage(source: string, outputPath: string, signal?: AbortSignal) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    if (/^data:image\//i.test(source)) {
        const comma = source.indexOf(',')
        if (comma < 0) throw new Error('Qwen-Image 返回了无效的 Data URL')
        await fs.writeFile(outputPath, Buffer.from(source.slice(comma + 1), 'base64'))
        return
    }
    const response = await localFetch(source, { signal: fetchTimeoutSignal(120_000, signal) })
    if (!response.ok) throw new Error(`Qwen-Image 图片下载失败（${response.status}）：${await response.text()}`)
    await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
}

export async function generateImageWithQwenImage3Pro(params: {
    prompt: string
    negativePrompt?: string
    referenceImages?: string[]
    outputPath: string
    aspectRatio: QwenImageAspectRatio
    quality?: ImageQuality
    apiKey: string
    baseUrl?: string | null
    signal?: AbortSignal
}) {
    const baseUrl = (params.baseUrl ?? 'https://dashscope.aliyuncs.com').replace(/\/$/, '')
    // Qwen-Image 3.0 Pro accepts at most three image content items. Keep this
    // provider-side guard even though callers also budget references, because
    // direct callers and stale capability data must never produce a 400.
    const requestedReferences = [...new Set((params.referenceImages ?? []).map(source => source.trim()).filter(Boolean))].slice(0, QWEN_IMAGE_MAX_REFERENCES)
    const references = (await Promise.all(requestedReferences.map(source => toQwenImageInput(source)))).filter((source): source is string => !!source)
    const content: Array<{ image: string } | { text: string }> = [...references.map(image => ({ image })), { text: params.prompt }]
    const quality = params.quality ?? 'standard'
    const requestBody = {
        model: QWEN_IMAGE_3_PRO_MODEL,
        input: { messages: [{ role: 'user', content }] },
        parameters: {
            size: getQwenImageSize(quality, params.aspectRatio),
            n: 1,
            prompt_extend: true,
            enable_thinking: quality !== 'standard',
            watermark: false,
            ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {})
        }
    }
    let responseData = await submitGeneration({ baseUrl, apiKey: params.apiKey, requestBody, signal: params.signal })
    let imageUrl = imageUrlFromOutput(responseData)
    const taskId = responseData?.output?.task_id as string | undefined

    if (!imageUrl && taskId) {
        for (let attempt = 0; attempt < 180; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 2_000))
            const statusUrl = `${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`
            const sentAt = new Date().toISOString()
            const statusResponse = await fetchMeteredProvider(
                statusUrl,
                {
                    headers: { Authorization: `Bearer ${params.apiKey}` },
                    cache: 'no-store',
                    signal: fetchTimeoutSignal(30_000, params.signal)
                },
                { provider: 'qwen', model: QWEN_IMAGE_3_PRO_MODEL }
            )
            if (!statusResponse.ok) throw new Error(`Qwen-Image 任务查询失败（${statusResponse.status}）：${await statusResponse.text()}`)
            responseData = await statusResponse.json()
            await reportProviderTokenUsage({
                provider: 'qwen',
                model: QWEN_IMAGE_3_PRO_MODEL,
                endpoint: '/api/v1/tasks/:taskId',
                response: statusResponse,
                payload: responseData,
                sentAt,
                operationKey: `qwen-image:${taskId}`
            })
            const status = String(responseData?.output?.task_status ?? '').toUpperCase()
            if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED' || status === 'UNKNOWN') {
                throw new Error(`Qwen-Image 生成失败：${responseData?.output?.message ?? responseData?.message ?? status}`)
            }
            imageUrl = imageUrlFromOutput(responseData)
            if (imageUrl) break
        }
    }

    if (!imageUrl) throw new Error('Qwen-Image 生成超时或未返回图片')
    await downloadImage(imageUrl, params.outputPath, params.signal)
    return { referenceImagesApplied: references.length > 0, taskId: taskId ?? null }
}
