import { createHmac, timingSafeEqual } from 'node:crypto'

export const ROOT_ADMIN_EMAIL = 'local@localhost'
const ISSUER = 'makivue'
const AUDIENCE = 'makivue-web'
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

export type AppSession = {
    userId: bigint
    email: string
    userType: number
    issuedAt: number
    expiresAt: number
}

type SessionPayload = {
    sub: string
    email: string
    userType: number
    iat: number
    exp: number
    iss: string
    aud: string
}

function sessionSecret(): string | null {
    const configured = process.env.APP_SESSION_SECRET?.trim() || process.env.AUTH_SESSION_SECRET?.trim()
    if (configured) return configured
    if (process.env.NODE_ENV === 'production') return null
    return 'development-only-session-secret-change-before-production'
}

function encode(value: string | Buffer) {
    return Buffer.from(value).toString('base64url')
}

function sign(input: string, secret: string) {
    return createHmac('sha256', secret).update(input).digest('base64url')
}

export function issueSessionToken(input: { userId: string | bigint; email: string; userType?: number }, now = Math.floor(Date.now() / 1000)) {
    const secret = sessionSecret()
    if (!secret) throw new Error('APP_SESSION_SECRET is required in production')
    const userId = String(input.userId)
    if (!/^[1-9]\d{0,18}$/.test(userId)) throw new Error('Invalid application user id')
    const email = input.email.trim().toLowerCase()
    if (!email) throw new Error('Verified email is required')
    const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload: SessionPayload = {
        sub: userId,
        email,
        userType: Number.isInteger(input.userType) ? Number(input.userType) : 0,
        iat: now,
        exp: now + DEFAULT_TTL_SECONDS,
        iss: ISSUER,
        aud: AUDIENCE
    }
    const encodedPayload = encode(JSON.stringify(payload))
    const unsigned = `${header}.${encodedPayload}`
    return `${unsigned}.${sign(unsigned, secret)}`
}

export function verifySessionToken(token: string, now = Math.floor(Date.now() / 1000)): AppSession | null {
    const secret = sessionSecret()
    if (!secret) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const unsigned = `${parts[0]}.${parts[1]}`
    const expected = Buffer.from(sign(unsigned, secret))
    const actual = Buffer.from(parts[2])
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: unknown }
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Partial<SessionPayload>
        if (header.alg !== 'HS256' || payload.iss !== ISSUER || payload.aud !== AUDIENCE) return null
        if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || Number(payload.exp) <= now || Number(payload.iat) > now + 60) return null
        if (typeof payload.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(payload.sub)) return null
        if (typeof payload.email !== 'string' || !payload.email.trim()) return null
        return {
            userId: BigInt(payload.sub),
            email: payload.email.trim().toLowerCase(),
            userType: Number.isInteger(payload.userType) ? Number(payload.userType) : 0,
            issuedAt: Number(payload.iat),
            expiresAt: Number(payload.exp)
        }
    } catch {
        return null
    }
}

export function bearerToken(req: Request): string | null {
    const authorization = req.headers.get('authorization')?.trim() ?? ''
    const match = authorization.match(/^Bearer\s+(\S+)$/i)
    return match?.[1] ?? null
}
