import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_TTL_SECONDS = 10 * 60

interface DestructiveOperationPayload {
    projectId: string
    operationVersion: number
    scope: string
    issuedAt: number
    expiresAt: number
}

function tokenSecret(): string {
    const configured = process.env.APP_SESSION_SECRET?.trim() || process.env.AUTH_SESSION_SECRET?.trim()
    if (configured) return configured
    if (process.env.NODE_ENV === 'production') throw new Error('APP_SESSION_SECRET is required for destructive-operation confirmation')
    return 'development-only-destructive-operation-secret'
}

function signature(body: string) {
    return createHmac('sha256', tokenSecret()).update(body).digest('base64url')
}

export function issueDestructiveOperationToken(input: { projectId: bigint | string; operationVersion: number; scope: string }, now = Math.floor(Date.now() / 1000)) {
    const payload: DestructiveOperationPayload = {
        projectId: String(input.projectId),
        operationVersion: input.operationVersion,
        scope: input.scope,
        issuedAt: now,
        expiresAt: now + TOKEN_TTL_SECONDS
    }
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${body}.${signature(body)}`
}

export function verifyDestructiveOperationToken(
    token: string,
    expected: { projectId: bigint | string; operationVersion: number; scope: string },
    now = Math.floor(Date.now() / 1000)
): boolean {
    const [body, suppliedSignature, extra] = token.split('.')
    if (!body || !suppliedSignature || extra) return false
    const actual = Buffer.from(suppliedSignature)
    const signed = Buffer.from(signature(body))
    if (actual.length !== signed.length || !timingSafeEqual(actual, signed)) return false
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<DestructiveOperationPayload>
        return (
            payload.projectId === String(expected.projectId) &&
            payload.operationVersion === expected.operationVersion &&
            payload.scope === expected.scope &&
            Number.isInteger(payload.issuedAt) &&
            Number.isInteger(payload.expiresAt) &&
            Number(payload.issuedAt) <= now + 60 &&
            Number(payload.expiresAt) > now
        )
    } catch {
        return false
    }
}
