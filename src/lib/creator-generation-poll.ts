import { clientFetch, readApiJson } from './client-fetch'

/** A failed status request does not mean the already-submitted generation failed. */
export async function readCreatorGenerationPoll(url: string, fallback = '视频状态查询失败') {
    try {
        const response = await clientFetch(url, { timeoutMs: 45_000 })
        if ([408, 429, 502, 503, 504].includes(response.status)) return null
        const payload = await readApiJson(response)
        // Some gateways send their own JSON envelope, even with HTTP 200.
        if (payload?.error_code === 'GW.0402') return null
        if (!response.ok || !payload?.success) throw new Error(payload?.error ?? fallback)
        return payload.data
    } catch (error) {
        if (error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) return null
        throw error
    }
}
