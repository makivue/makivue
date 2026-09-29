import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { genId } from './id'
import { Prisma, type HiModelsCall } from '@/generated/prisma/client'
import { createProviderTokenUsageCollector, type HiModelsUsageCall, type TokenUsageProvider } from './himodels-token-usage'
import { currentHiModelsUsageScope } from './himodels-usage-context.server'
import { reserveModelPoints } from '@/services/wallet-reservations'
import { BillingError } from './billing-error'
import { BILLING_TRANSACTION_OPTIONS } from './billing-transaction'

function providerId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const record = payload as Record<string, unknown>
    for (const key of ['name', 'task_id', 'id']) if (typeof record[key] === 'string' && record[key]) return record[key]
    return providerId(record.data) ?? providerId(record.response) ?? providerId(record.result) ?? providerId(record.output)
}

export function hiModelsOperationKey(url: string, init: RequestInit, callId: string, payload?: unknown) {
    const parsed = new URL(url)
    const video = parsed.pathname.match(/(?:\/v1\/video\/generations|\/v1\/videos\/image2video|\/api\/v3\/contents\/generations\/tasks|\/api\/v1\/tasks)(?:\/(.+))?$/)
    const taskId = video ? (video[1] ? decodeURIComponent(video[1]) : providerId(payload)) : null
    // The same accepted request may initially omit its provider ID. Prefer the
    // stable idempotency key so empty-response retries cannot double count it.
    const imageId = /\/v1\/images\/generations$/.test(parsed.pathname) ? (new Headers(init.headers).get('idempotency-key') ?? providerId(payload)) : null
    const asyncId = taskId ?? (parsed.pathname.includes('/api/v1/services/aigc/') ? providerId(payload) : null)
    const key = asyncId ? `video:${asyncId}` : imageId ? `image:${imageId}` : `call:${callId}`
    return createHash('sha256').update(`${parsed.origin}:${key}`).digest('hex')
}

/** Fail before dispatch if an authenticated call cannot have a durable record. */
export async function startHiModelsUsage(call: HiModelsUsageCall, userId: bigint | null, reservationPoints?: number): Promise<bigint | null> {
    if (userId === null) return null // CLI callers still receive usage via their observer/result.
    const scope = currentHiModelsUsageScope()
    const id = genId()
    try {
        const create = async (db: Prisma.TransactionClient | typeof prisma) => {
            if (reservationPoints !== undefined && call.billing) {
                await reserveModelPoints(userId, call.billing.scopeKey, call.billing.reservationKey, reservationPoints, db as Prisma.TransactionClient)
            }
            await db.hiModelsCall.create({
                data: {
                    id,
                    callId: call.id,
                    userId,
                    jobId: scope?.jobId ? BigInt(scope.jobId) : null,
                    parentJobId: scope?.parentJobId ? BigInt(scope.parentJobId) : null,
                    generationId: scope?.generationId ? BigInt(scope.generationId) : null,
                    provider: call.provider ?? 'himodels',
                    model: call.model.slice(0, 100),
                    endpoint: call.endpoint!.slice(0, 100),
                    operationKey: call.operationKey!,
                    sentAt: new Date(call.sentAt!),
                    captureState: 'pending',
                    billing: call.billing ? (call.billing as unknown as Prisma.InputJsonValue) : undefined
                }
            })
        }
        if (reservationPoints !== undefined) await prisma.$transaction(create, BILLING_TRANSACTION_OPTIONS)
        else await create(prisma)
        return id
    } catch (error) {
        if (error instanceof BillingError) throw error
        const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'unknown'
        console.error('[Model Usage] Pre-dispatch persistence failed', { callId: call.id, code })
        if (['P2028', 'P2034', 'P2024', 'P1008'].includes(code)) throw new BillingError('模型用量记录暂时繁忙，尚未调用模型；请稍后重试', 503)
        throw new BillingError('模型用量记录不可用，尚未调用模型；请确认数据库迁移已执行后重试', 503)
    }
}

/** Only retry the database write, never an already-billable provider call. */
export async function finishHiModelsUsage(id: bigint | null, call: HiModelsUsageCall): Promise<void> {
    if (id === null) return
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await prisma.hiModelsCall.update({
                where: { id },
                data: {
                    model: call.model.slice(0, 100),
                    operationKey: call.operationKey,
                    httpStatus: call.status,
                    captureState: call.captureState ?? 'received',
                    requestId: call.requestId?.slice(0, 255) ?? null,
                    usage: call.usage ? (call.usage as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
                    rawUsage: call.rawUsage ? (call.rawUsage as Prisma.InputJsonValue) : Prisma.DbNull,
                    receivedAt: call.receivedAt ? new Date(call.receivedAt) : new Date(),
                    billing: call.billing ? (call.billing as unknown as Prisma.InputJsonValue) : undefined
                }
            })
            return
        } catch {
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)))
        }
    }
    // The pre-dispatch row remains pending/unknown, never falsely reported as 0.
    console.error(`[HiModels Usage] Response usage persistence failed for call=${call.id}; existing ledger row remains incomplete`)
}

export function serializeHiModelsUsage(row: HiModelsCall): HiModelsUsageCall {
    return {
        id: row.callId,
        provider: row.provider as TokenUsageProvider,
        model: row.model,
        operationKey: row.operationKey,
        endpoint: row.endpoint,
        status: row.httpStatus,
        captureState: row.captureState,
        requestId: row.requestId,
        usage: row.usage as HiModelsUsageCall['usage'],
        rawUsage: row.rawUsage,
        sentAt: row.sentAt.toISOString(),
        receivedAt: row.receivedAt?.toISOString() ?? null
    }
}

export function summarizeHiModelsCalls(rows: HiModelsCall[]) {
    const collector = createProviderTokenUsageCollector()
    for (const row of rows) collector.record(serializeHiModelsUsage(row))
    const result = collector.snapshot()
    const tokenUsageCalls = result.tokenUsageCalls
    return {
        ...result,
        tokenUsage: rows.length ? result.tokenUsage : null,
        tokenUsageCalls,
        himodelsUsageCalls: tokenUsageCalls.filter(call => (call.provider ?? 'himodels') === 'himodels'),
        usageTrackingAvailable: true
    }
}

/** Called after the existing job/project ownership guard, also filtered by owner. */
export async function readHiModelsUsage(userId: bigint, scope: { jobId: string } | { generationId: string }) {
    try {
        const rows = await prisma.hiModelsCall.findMany({
            where: { userId, ...('jobId' in scope ? { OR: [{ jobId: BigInt(scope.jobId) }, { parentJobId: BigInt(scope.jobId) }] } : { generationId: BigInt(scope.generationId) }) },
            orderBy: { id: 'asc' }
        })
        return summarizeHiModelsCalls(rows)
    } catch {
        return { tokenUsage: null, tokenUsageCalls: [], himodelsUsageCalls: [], usageTrackingAvailable: false }
    }
}

/** Batch query for episode snapshots; avoid one DB read per storyboard. */
export async function readHiModelsGenerationUsage(userId: bigint, generationIds: bigint[]) {
    const byGeneration = new Map<string, ReturnType<typeof summarizeHiModelsCalls>>()
    if (!generationIds.length) return byGeneration
    const rows = await prisma.hiModelsCall.findMany({ where: { userId, generationId: { in: generationIds } }, orderBy: { id: 'asc' } })
    const groups = new Map<string, HiModelsCall[]>()
    for (const row of rows) {
        const key = String(row.generationId)
        groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const [key, group] of groups) byGeneration.set(key, summarizeHiModelsCalls(group))
    return byGeneration
}
