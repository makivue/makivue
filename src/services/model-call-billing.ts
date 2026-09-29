import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { BillingError } from '@/lib/billing-error'
import { currentHiModelsUsageScope } from '@/lib/himodels-usage-context.server'
import type { HiModelsUsageCall, TokenUsageProvider } from '@/lib/himodels-token-usage'
import { actualModelCostUsd, meterModelRequest, modelBudgetUsd, modelRecord, resolveModelPrice, type ModelPrice, type ModelRequestMeter } from '@/lib/model-pricing'
import { getFxRate, RATE_SCALE } from './fx-rates'
import { releaseModelReservations } from './wallet-reservations'
import { POINTS_PER_USD } from '@/lib/recharge'
import { Prisma } from '@/generated/prisma/client'

export type ModelCallBilling = {
    scopeKey: string
    reservationKey: string
    price: ModelPrice
    meter: ModelRequestMeter
    state: 'pending' | 'priced' | 'failed' | 'missing_usage'
    costUsd: number | null
}

export function billingScopeKey() {
    const scope = currentHiModelsUsageScope()
    return scope?.generationId ? `generation:${scope.generationId}` : (scope?.billingKey ?? (scope?.jobId ? `job:${scope.jobId}` : null))
}

export async function quoteModelRequestReservation(provider: TokenUsageProvider, model: string, url: string, body: unknown) {
    const meter = meterModelRequest(body)
    const resolvedPrice = resolveModelPrice(provider, model, meter, url)
    if (!resolvedPrice) throw new BillingError(`${model} 的供应商成本单价尚未配置，请补齐价格后重试`, 503)
    const rate = await getFxRate(resolvedPrice.currency)
    if (rate === null || rate <= 0) throw new BillingError(`暂时无法取得 ${resolvedPrice.currency} 结算汇率，请稍后重试`, 503)
    const price = { ...resolvedPrice, usdPerCurrency: RATE_SCALE / rate }
    const reservationPoints = modelBudgetUsd(price, meter) * POINTS_PER_USD
    if (!Number.isFinite(reservationPoints) || reservationPoints < 0) throw new BillingError('模型预留金币报价无效', 503)
    return { meter, price, reservationPoints }
}

export async function prepareModelCallBilling(call: HiModelsUsageCall, userId: bigint | null, url: string, init: RequestInit) {
    if (userId === null || process.env.WALLET_BILLING_ENABLED === 'false') return
    const scopeKey = billingScopeKey()
    if (!scopeKey) throw new BillingError('模型调用缺少可结算的任务标识', 503)
    if ((init.method ?? 'GET').toUpperCase() === 'GET') {
        const previous = await prisma.hiModelsCall.findFirst({ where: { userId, operationKey: call.operationKey, billing: { not: Prisma.DbNull } }, orderBy: { id: 'desc' } })
        if (previous?.billing) {
            const billing = previous.billing as unknown as ModelCallBilling
            if (billing.scopeKey !== scopeKey) throw new BillingError('模型查询与计费任务不匹配', 409)
            call.billing = billing
        }
        return
    }
    let body: unknown
    try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
    } catch {
        throw new BillingError('模型计费请求格式无效', 503)
    }
    const { meter, price, reservationPoints } = await quoteModelRequestReservation(call.provider ?? 'himodels', call.model, url, body)
    const idempotency = new Headers(init.headers).get('idempotency-key')
    const reservationKey = idempotency
        ? createHash('sha256')
              .update(`${userId}:${scopeKey}:${new URL(url).origin}:${idempotency}`)
              .digest('hex')
        : `model:${call.id}`
    call.billing = { scopeKey, reservationKey, price, meter, state: 'pending', costUsd: null }
    // The ledger writer reserves this budget in the same database transaction
    // as the pre-dispatch record. A failed insert must never leave a hold.
    return reservationPoints
}

/** Post-response failures never retry a supplier request. Settlement remains pending. */
export async function finishModelCallBilling(call: HiModelsUsageCall, userId: bigint | null, payload: unknown, requestMethod = 'POST') {
    const billing = call.billing
    if (!billing || userId === null) return
    if (call.captureState === 'network_error' || call.captureState === 'body_error') {
        // A failed poll cannot cancel the paid video operation it observes.
        if (requestMethod.toUpperCase() === 'GET') return
        // No usable result or supplier usage reached us. Exclude this failed
        // attempt from the user's bill without claiming its supplier cost is zero.
        // This also lets an optional inspection fail without blocking a delivered image.
        call.billing = { ...billing, state: 'failed', costUsd: null }
        if (billing.reservationKey.startsWith('model:')) await releaseModelReservations(billing.scopeKey, userId, billing.reservationKey)
        return
    }
    const root = modelRecord(payload),
        output = modelRecord(root.output),
        data = modelRecord(root.data)
    const status = String(root.status ?? output.task_status ?? data.task_status ?? '').toLowerCase()
    // A failed status query says nothing about the running paid operation.
    if (call.endpoint?.endsWith(':taskId') && (call.status ?? 0) >= 400) return
    const failed =
        (call.status !== undefined && call.status !== null && call.status >= 400) ||
        ['failed', 'error', 'canceled', 'cancelled', 'unknown'].includes(status) ||
        !!root.error ||
        (call.provider === 'kling' && root.code !== undefined && Number(root.code) !== 0)
    if (failed) {
        call.billing = { ...billing, state: 'failed', costUsd: 0 }
        // Idempotent image retries share one reservation. Retain it until the
        // business operation ends; another attempt may already be in flight.
        if (billing.reservationKey.startsWith('model:')) await releaseModelReservations(billing.scopeKey, userId, billing.reservationKey)
        return
    }
    if (['pending', 'queued', 'running', 'processing', 'submitted'].includes(status) || (root.done === false && !['succeeded', 'completed', 'success'].includes(status))) return
    const asyncAccepted =
        !status &&
        !root.done &&
        (typeof output.task_id === 'string' || typeof data.task_id === 'string' || (billing.price.kind.startsWith('video') && (typeof root.id === 'string' || typeof root.task_id === 'string')))
    if (asyncAccepted) return
    const costUsd = actualModelCostUsd(billing.price, billing.meter, payload)
    call.billing = { ...billing, costUsd, state: costUsd === null ? 'missing_usage' : 'priced' }
}
