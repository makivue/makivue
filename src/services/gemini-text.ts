/**
 * Gemini 文本生成 adapter (Vertex AI)
 *
 * - 复用 banana.ts 的 GoogleAuth (服务账号 JSON)
 * - 走 publishers/google/models/{model}:generateContent
 * - 支持 system / user / assistant 三种 role；OpenAI 的 system 会被映射到 systemInstruction
 * - chatJSON 走 responseMimeType=application/json 让模型严格输出 JSON
 */

import { getGoogleAccessToken, getGoogleAuthClient, resetGoogleAuthCache } from './banana'
import { isSafetyDiagnosticsEnabled } from './safety-diagnostics'
import { fetchTimeoutSignal } from '@/lib/fetch-timeout'
import { fetchMeteredProvider, reportProviderTokenUsage } from '@/lib/provider-token-usage.server'
import type { ProviderTokenUsageObserver } from '@/lib/himodels-token-usage'

export interface GeminiChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

interface GeminiCallOptions {
    json?: boolean
    temperature?: number
    maxTokens?: number
    timeoutMs?: number
    onUsage?: ProviderTokenUsageObserver
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

function appendSafetyDetails(message: string, ratings: GeminiSafetyRating[] | undefined) {
    const detail = formatSafetyRatings(ratings)
    return detail ? `${message} | safetyRatings: ${detail}` : message
}

async function appendSafetyDetailsIfEnabled(message: string, ratings: GeminiSafetyRating[] | undefined) {
    return (await isSafetyDiagnosticsEnabled()) ? appendSafetyDetails(message, ratings) : message
}

function normalizeGeminiError(status: number, body: string) {
    let message = body
    let reason = ''
    try {
        const parsed = JSON.parse(body)
        message = parsed?.error?.message ?? body
        reason = parsed?.error?.status ?? ''
    } catch {
        // keep raw
    }

    if (status === 401 || status === 403 || reason === 'UNAUTHENTICATED' || reason === 'PERMISSION_DENIED' || body.includes('ACCESS_TOKEN_EXPIRED')) {
        return 'Gemini Google 凭证已过期或权限不足：请检查 GOOGLE_APPLICATION_CREDENTIALS / NANO_BANANA_CREDENTIALS_PATH 指向的服务账号 JSON 是否启用了 aiplatform.user 角色，并重启 dev server。'
    }
    if (status === 404 && body.includes('was not found')) {
        return `Gemini 模型未找到（${status}）：可能是 region/global 不支持该模型，或服务账号的项目没有开启 Vertex AI Gemini。原始错误：${message}`
    }
    return `Gemini error ${status}: ${message}`
}

/**
 * 调用 Gemini 文本模型。返回模型 first candidate 的拼接文本。
 */
export async function chatGemini(model: string, messages: GeminiChatMessage[], options: GeminiCallOptions = {}): Promise<string> {
    const { projectId } = await getGoogleAuthClient()
    const location = process.env.GEMINI_TEXT_LOCATION?.trim() || 'global'
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
    const url = `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`

    // 把 OpenAI 风格 messages 转换成 Gemini 格式：
    //   - system → systemInstruction（独立字段，全部合并）
    //   - user / assistant → contents[]，role: user / model
    const systemTexts: string[] = []
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
    for (const m of messages) {
        if (m.role === 'system') {
            if (m.content?.trim()) systemTexts.push(m.content)
        } else {
            contents.push({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            })
        }
    }

    const body: Record<string, unknown> = {
        contents,
        generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens ?? 32768,
            ...(options.json ? { responseMimeType: 'application/json' } : {})
        },
        safetySettings: [
            {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'BLOCK_ONLY_HIGH'
            },
            {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_ONLY_HIGH'
            },
            {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'BLOCK_ONLY_HIGH'
            },
            {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'BLOCK_ONLY_HIGH'
            }
        ]
    }
    if (systemTexts.length > 0) {
        body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] }
    }

    const sentAt = new Date().toISOString()
    let res: Response | null = null
    let errorBody = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = await getGoogleAccessToken()
        res = await fetchMeteredProvider(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(body),
                signal: fetchTimeoutSignal(options.timeoutMs ?? 180_000)
            },
            { provider: 'gemini', model: `gemini:${model}` }
        )
        if (res.ok) break
        errorBody = await res.text()
        const authExpired = res.status === 401 || errorBody.includes('ACCESS_TOKEN_EXPIRED')
        if (!authExpired || attempt === 1) break
        resetGoogleAuthCache()
    }

    if (!res?.ok) {
        throw new Error(normalizeGeminiError(res?.status ?? 0, errorBody))
    }

    const data = (await res.json()) as {
        candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> }
            finishReason?: string
            safetyRatings?: GeminiSafetyRating[]
        }>
        promptFeedback?: { blockReason?: string; safetyRatings?: GeminiSafetyRating[] }
        usageMetadata?: Record<string, unknown>
    }

    await reportProviderTokenUsage({
        provider: 'gemini',
        model: `gemini:${model}`,
        endpoint: `/publishers/google/models/${model}:generateContent`,
        response: res,
        payload: data,
        sentAt,
        observer: options.onUsage
    })

    if (data.promptFeedback?.blockReason) {
        throw new Error(await appendSafetyDetailsIfEnabled(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`, data.promptFeedback.safetyRatings))
    }

    const cand = data.candidates?.[0]
    if (!cand) {
        throw new Error(await appendSafetyDetailsIfEnabled(`Gemini returned no candidates: ${JSON.stringify(data).slice(0, 300)}`, data.promptFeedback?.safetyRatings))
    }
    if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
        throw new Error(await appendSafetyDetailsIfEnabled(`Gemini finish reason: ${cand.finishReason}`, cand.safetyRatings))
    }
    const text = (cand.content?.parts ?? [])
        .map(p => p.text ?? '')
        .join('')
        .trim()
    if (!text) {
        if (cand.finishReason === 'MAX_TOKENS') {
            throw new Error('Gemini input too long: the combined prompt exceeded the model context window and produced no output. Reduce input size or switch to a model with a larger context.')
        }
        throw new Error(`Gemini returned empty text: ${JSON.stringify(data).slice(0, 300)}`)
    }
    return text
}
