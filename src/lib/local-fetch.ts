import 'server-only'
import { localMediaKey, localMediaResponse, readLocalMedia } from '@/services/local-media'

/** Inline owned files so model suppliers never need access to a local URL. */
export async function inlineLocalMediaRequest(init: RequestInit = {}): Promise<RequestInit> {
    if (typeof init.body !== 'string' || !init.body.includes('/api/local-media/')) return init
    if (!new Headers(init.headers).get('content-type')?.includes('application/json')) return init
    const cache = new Map<string, string>()
    const visit = async (value: unknown): Promise<unknown> => {
        if (typeof value === 'string' && localMediaKey(value)) {
            if (!cache.has(value)) {
                const { data, mime } = await readLocalMedia(value, 100 * 1024 * 1024)
                if (!/^(image|video|audio)\//.test(mime)) throw new Error('模型参考素材必须是图片、视频或音频')
                cache.set(value, `data:${mime};base64,${data.toString('base64')}`)
            }
            return cache.get(value)
        }
        if (Array.isArray(value)) return Promise.all(value.map(visit))
        if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await visit(child)])))
        return value
    }
    return { ...init, body: JSON.stringify(await visit(JSON.parse(init.body))) }
}

export const localFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (localMediaKey(url)) return localMediaResponse(url, init ?? (input instanceof Request ? { method: input.method, headers: input.headers } : {}))
    return fetch(input, await inlineLocalMediaRequest(init))
}
