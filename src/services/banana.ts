import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import { NANO_BANANA_IMAGE_MODEL, NANO_BANANA_LOCATION } from '@/lib/gemini-models'
import { getNanoBananaImageSize, type ImageQuality, type NanoBananaImageSize } from '@/lib/image-quality'
import { localFetch } from '@/lib/local-fetch'
import { fetchMeteredProvider, reportProviderTokenUsage } from '@/lib/provider-token-usage.server'
import fs from 'fs'
import { GoogleAuth } from 'google-auth-library'
import path from 'path'
import { localMediaKey } from './local-media'
import { isSafetyDiagnosticsEnabled } from './safety-diagnostics'

/**
 * Nano Banana via Google Vertex AI
 * - 默认模型：gemini-3.1-flash-image（Nano Banana 2）
 * - 可通过环境变量覆盖：NANO_BANANA_MODEL / NANO_BANANA_LOCATION
 *
 * Uses Google service account credentials from env or an explicit credential path.
 */

let cachedClient: Awaited<ReturnType<GoogleAuth['getClient']>> | null = null
let cachedProjectId: string | null = null
let cachedToken: { token: string; expiry: number } | null = null

export class NanoBananaConfigurationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'NanoBananaConfigurationError'
    }
}

function readServiceAccountJson(): Record<string, unknown> {
    if (process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON)
    }
    if (process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON_B64) {
        return JSON.parse(Buffer.from(process.env.NANO_BANANA_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8'))
    }

    const candidates = [process.env.NANO_BANANA_CREDENTIALS_PATH, process.env.GOOGLE_APPLICATION_CREDENTIALS].filter(Boolean) as string[]

    const saPath = candidates.find(candidate => fs.existsSync(/* turbopackIgnore: true */ candidate))
    if (!saPath) {
        throw new Error('Nano Banana credentials not found. Set NANO_BANANA_SERVICE_ACCOUNT_JSON_B64 or NANO_BANANA_SERVICE_ACCOUNT_JSON.')
    }

    return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ saPath, 'utf-8'))
}

export function assertNanoBananaCredentialsConfigured(): void {
    try {
        const sa = readServiceAccountJson()
        if (typeof sa.client_email !== 'string' || typeof sa.project_id !== 'string' || typeof sa.private_key !== 'string') {
            throw new Error('service account JSON missing client_email, project_id, or private_key')
        }
    } catch (error) {
        if (error instanceof NanoBananaConfigurationError) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new NanoBananaConfigurationError(`Nano Banana credentials unavailable: ${message}`)
    }
}

async function getAuthClient() {
    if (cachedClient && cachedProjectId) return { client: cachedClient, projectId: cachedProjectId }

    const sa = readServiceAccountJson()
    if (typeof sa.client_email !== 'string' || typeof sa.project_id !== 'string' || typeof sa.private_key !== 'string') {
        throw new Error('Nano Banana service account JSON missing client_email, project_id, or private_key')
    }

    const auth = new GoogleAuth({
        credentials: {
            client_email: sa.client_email,
            project_id: sa.project_id,
            private_key: sa.private_key
        },
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
    cachedClient = await auth.getClient()
    cachedProjectId = sa.project_id
    return { client: cachedClient, projectId: cachedProjectId }
}

async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiry > Date.now() + 60_000) {
        return cachedToken.token
    }
    const { client } = await getAuthClient()
    const tokenRes = await client.getAccessToken()
    if (!tokenRes.token) throw new Error('Failed to acquire Google access token')
    cachedToken = { token: tokenRes.token, expiry: Date.now() + 50 * 60_000 }
    return tokenRes.token
}

function resetAuthCache() {
    cachedClient = null
    cachedProjectId = null
    cachedToken = null
}

// 导出共享给其他 Google 服务（如 Gemini 文本 adapter）
export async function getGoogleAuthClient() {
    return getAuthClient()
}

export async function getGoogleAccessToken(): Promise<string> {
    return getToken()
}

export function resetGoogleAuthCache() {
    resetAuthCache()
}

type GeminiSafetyRating = {
    category?: string
    probability?: string
    probabilityScore?: number
    severity?: string
    severityScore?: number
    blocked?: boolean
}

function formatSafetyRatings(ratings: GeminiSafetyRating[] | undefined) {
    if (!ratings?.length) return ''
    return ratings
        .map(rating => {
            const bits = [
                rating.category,
                rating.probability ? `probability=${rating.probability}` : null,
                typeof rating.probabilityScore === 'number' ? `probabilityScore=${rating.probabilityScore.toFixed(3)}` : null,
                rating.severity ? `severity=${rating.severity}` : null,
                typeof rating.severityScore === 'number' ? `severityScore=${rating.severityScore.toFixed(3)}` : null,
                rating.blocked ? 'blocked=true' : null
            ].filter(Boolean)
            return bits.join('/')
        })
        .join('; ')
}

function describeGenerateContentSafety(data: {
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        finishReason?: string
        safetyRatings?: GeminiSafetyRating[]
    }>
    promptFeedback?: { blockReason?: string; safetyRatings?: GeminiSafetyRating[] }
}) {
    const promptRatings = formatSafetyRatings(data.promptFeedback?.safetyRatings)
    if (data.promptFeedback?.blockReason) {
        return [`promptFeedback.blockReason=${data.promptFeedback.blockReason}`, promptRatings ? `promptSafetyRatings=${promptRatings}` : null].filter(Boolean).join(' | ')
    }

    const candidate = data.candidates?.[0]
    if (!candidate) return promptRatings ? `promptSafetyRatings=${promptRatings}` : ''

    const candidateRatings = formatSafetyRatings(candidate.safetyRatings)
    const text = (candidate.content?.parts ?? [])
        .map(part => part.text?.trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 300)

    return [candidate.finishReason ? `finishReason=${candidate.finishReason}` : null, candidateRatings ? `candidateSafetyRatings=${candidateRatings}` : null, text ? `text=${text}` : null]
        .filter(Boolean)
        .join(' | ')
}

export function isBananaImageSafetyResponse(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false
    const response = data as {
        candidates?: Array<{ finishReason?: string }>
        promptFeedback?: { blockReason?: string; blockReasonMessage?: string }
    }
    const blockReason = response.promptFeedback?.blockReason?.trim().toUpperCase() ?? ''
    const finishReason = response.candidates?.[0]?.finishReason?.trim().toUpperCase() ?? ''
    const blockMessage = response.promptFeedback?.blockReasonMessage ?? ''
    const safetyReasons = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'NO_IMAGE', 'OTHER'])

    return safetyReasons.has(blockReason) || safetyReasons.has(finishReason) || /safety|usage guidelines|filtered out/i.test(blockMessage)
}

function normalizeBananaError(status: number, body: string) {
    let message = body
    let reason = ''
    try {
        const parsed = JSON.parse(body)
        message = parsed?.error?.message ?? body
        reason = parsed?.error?.details?.find?.((item: Record<string, unknown>) => typeof item.reason === 'string')?.reason ?? ''
    } catch {
        // Keep the raw body.
    }

    if (status === 401 || reason === 'ACCESS_TOKEN_EXPIRED' || body.includes('ACCESS_TOKEN_EXPIRED')) {
        return 'Nano Banana Google 凭证已过期或无效：请更新 GOOGLE_APPLICATION_CREDENTIALS / NANO_BANANA_CREDENTIALS_PATH 指向的服务账号 JSON，或重新生成凭证后重启 dev server。'
    }
    return `Nano Banana error ${status}: ${message}`
}

function isWithinDirectory(root: string, candidate: string) {
    const relative = path.relative(root, candidate)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** Resolve public assets while rejecting traversal and arbitrary absolute file reads. */
export function resolveBananaLocalImagePath(src: string, projectRoot = process.cwd()) {
    const publicRoot = path.resolve(/* turbopackIgnore: true */ projectRoot, 'public')
    const absoluteCandidate = path.isAbsolute(src) ? path.resolve(/* turbopackIgnore: true */ src) : null
    if (absoluteCandidate && isWithinDirectory(publicRoot, absoluteCandidate)) return absoluteCandidate
    // Leading-slash public URLs (for example /storage/x.png) are not local
    // filesystem roots. Resolve them below public after removing the slash.
    const candidate = path.resolve(/* turbopackIgnore: true */ publicRoot, src.replace(/^[/\\]+/, ''))
    return isWithinDirectory(publicRoot, candidate) ? candidate : null
}

// 把 URL 或本地路径加载为 base64 供 Nano Banana inline 使用
async function loadImageAsBase64(src: string, signal?: AbortSignal): Promise<{ data: string; mimeType: string }> {
    if (localMediaKey(src) || src.startsWith('http://') || src.startsWith('https://')) {
        const res = await localFetch(src, { signal: fetchTimeoutSignal(20_000, signal) })
        if (!res.ok) throw new Error(`Failed to load reference image: ${src} (${res.status})`)
        const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
        const buf = Buffer.from(await res.arrayBuffer())
        return { data: buf.toString('base64'), mimeType }
    }
    // Local references may be absolute paths or /storage URLs.
    const absPath = resolveBananaLocalImagePath(src)
    if (!absPath) throw new Error(`Local reference image must stay under public: ${src}`)
    if (!fs.existsSync(/* turbopackIgnore: true */ absPath)) throw new Error(`Local reference image not found: ${absPath}`)
    const buf = fs.readFileSync(/* turbopackIgnore: true */ absPath)
    const ext = path.extname(absPath).toLowerCase()
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    return { data: buf.toString('base64'), mimeType }
}

/**
 * 用 Nano Banana 生成图像，返回本地文件路径
 * 支持多参考图（Multi-Reference），每张参考图作为一个 part inline 进 prompt
 */
export type BananaImageGenerationParams = {
    prompt: string
    outputPath: string // 本地绝对路径
    aspectRatio?: '1:1' | '21:9' | '16:9' | '9:16' | '4:3' | '3:4'
    referenceImages?: string[] // URL 或 /storage/xxx 相对路径，最多 14 张
    quality?: ImageQuality
    imageSize?: NanoBananaImageSize
    signal?: AbortSignal
}

async function generateImageWithBananaOnce(params: BananaImageGenerationParams): Promise<{ localPath: string }> {
    const { projectId } = await getAuthClient()

    // 模型可由环境变量覆盖；默认使用当前项目已开放的稳定图像模型。
    const location = process.env.NANO_BANANA_LOCATION ?? NANO_BANANA_LOCATION
    const model = process.env.NANO_BANANA_MODEL ?? NANO_BANANA_IMAGE_MODEL
    const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`
    const imageSize = params.imageSize ?? getNanoBananaImageSize(params.quality)
    const supportsImageSize = model.startsWith('gemini-3') && model.includes('image')

    // 构造 multi-part prompt：参考图在前，text 在后，让模型把图当 reference 看
    const parts: Array<Record<string, unknown>> = []
    const refs = (params.referenceImages ?? []).slice(0, 14)
    // Preserve reference order, but load independent URLs in parallel. A bad
    // URL can now delay this phase by at most one bounded request instead of
    // adding its timeout to every following reference.
    const loadedReferences = await Promise.all(
        refs.map(async refSrc => {
            try {
                const { data, mimeType } = await loadImageAsBase64(refSrc, params.signal)
                return { inlineData: { data, mimeType } }
            } catch (err) {
                console.warn(`[banana] skip bad reference image ${refSrc}:`, err)
                return null
            }
        })
    )
    parts.push(...loadedReferences.filter((part): part is { inlineData: { data: string; mimeType: string } } => part !== null))
    parts.push({ text: params.prompt })

    const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: {
                ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
                ...(supportsImageSize ? { imageSize } : {})
            }
        },
        safetySettings: [
            {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'OFF'
            },
            {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'OFF'
            },
            {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'OFF'
            },
            {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'OFF'
            }
        ]
    }

    let res: Response | null = null
    let errorBody = ''
    let sentAt = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = await getToken()
        sentAt = new Date().toISOString()
        res = await fetchMeteredProvider(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(body),
                signal: fetchTimeoutSignal(180_000, params.signal)
            },
            { provider: 'gemini', model: `gemini:${model}` }
        )

        if (res.ok) break
        errorBody = await res.text()
        const authExpired = res.status === 401 || errorBody.includes('ACCESS_TOKEN_EXPIRED')
        if (!authExpired || attempt === 1) break
        resetAuthCache()
    }

    if (!res?.ok) {
        throw new Error(normalizeBananaError(res?.status ?? 0, errorBody))
    }

    const data = await res.json()
    await reportProviderTokenUsage({
        provider: 'gemini',
        model: `gemini:${model}`,
        endpoint: new URL(url).pathname,
        response: res,
        payload: data,
        sentAt
    })
    const responseParts = data?.candidates?.[0]?.content?.parts ?? []
    for (const p of responseParts) {
        if (p.inlineData?.data) {
            fs.mkdirSync(path.dirname(params.outputPath), { recursive: true })
            fs.writeFileSync(params.outputPath, Buffer.from(p.inlineData.data, 'base64'))
            return { localPath: params.outputPath }
        }
    }
    const safetyDetails = describeGenerateContentSafety(data)
    const diagnosticSuffix = (await isSafetyDiagnosticsEnabled()) && safetyDetails ? `: ${safetyDetails}` : ''
    const raw = JSON.stringify(data).slice(0, 500)
    const finishReason = data?.candidates?.[0]?.finishReason
    const promptBlockReason = String(data?.promptFeedback?.blockReason ?? '')
        .trim()
        .toUpperCase()
    if (isBananaImageSafetyResponse(data) || /usage guidelines|filtered out/i.test(raw)) {
        const reason =
            promptBlockReason === 'OTHER'
                ? 'Nano Banana did not return an image (blockReason=OTHER)'
                : finishReason === 'NO_IMAGE'
                  ? 'Nano Banana did not return an image'
                  : 'Nano Banana safety filter blocked the image'
        throw new BananaImageSafetyError(`${reason}${diagnosticSuffix}`, raw, { retryWithoutRewrite: promptBlockReason === 'OTHER' })
    }
    throw new Error(`No image in Banana response${diagnosticSuffix}. Raw: ${raw}`)
}

export async function generateImageWithBanana(params: BananaImageGenerationParams): Promise<{ localPath: string }> {
    try {
        return await generateImageWithBananaOnce(params)
    } catch (error) {
        if (!(error instanceof BananaImageSafetyError) || !error.retryWithoutRewrite) throw error
        console.warn('[banana] image generation returned blockReason=OTHER; retrying the same request once')
        await new Promise(resolve => setTimeout(resolve, 1_000))
        return generateImageWithBananaOnce(params)
    }
}

export class BananaImageSafetyError extends Error {
    readonly code = 'BANANA_IMAGE_SAFETY'
    readonly retryWithoutRewrite: boolean

    constructor(
        message: string,
        readonly diagnostic: string,
        options: { retryWithoutRewrite?: boolean } = {}
    ) {
        super(message)
        this.name = 'BananaImageSafetyError'
        this.retryWithoutRewrite = options.retryWithoutRewrite === true
    }
}
