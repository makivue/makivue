import 'server-only'
import { isIP } from 'node:net'

export function getForwardedClientIp(headers: Pick<Headers, 'get'>): string | undefined {
    // Read the client address supplied by the ingress, not the downstream proxy chain.
    const candidates = [headers.get('x-forwarded-for')?.split(',')[0], headers.get('x-real-ip'), headers.get('cf-connecting-ip')]
    for (const value of candidates) {
        const ip = value?.trim()
        if (ip && isIP(ip)) return ip
    }
    return undefined
}
