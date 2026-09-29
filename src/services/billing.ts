import { walletTransactionDestinations } from '@/services/wallet-transaction-destinations'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { formatLocalCurrency, normalizeRechargeAmount, POINTS_PER_USD, RECHARGE_TIERS_USD, RechargeTier, usdToPoints } from '@/lib/recharge'
import { WALLET_RECHARGE_REQUIRED_STATUS } from '@/lib/wallet-gate'
import { countryConfig, isValidCountry } from '@/lib/country-config'
import { getFxRate } from '@/services/fx-rates'
import { Prisma } from '@/generated/prisma/client'
import { BillingError } from '@/lib/billing-error'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'
import { billingScopeKey, type ModelCallBilling } from './model-call-billing'
import { recoverTerminalModelReservations, releaseReservationsInTransaction } from './wallet-reservations'

export { BillingError } from '@/lib/billing-error'

export { RECHARGE_TIERS_USD } from '@/lib/recharge'
export type { RechargeTier } from '@/lib/recharge'

export type BillingPointRate = { flatPoints?: number; perSecondPoints?: number }
type ProductionCostRate = { flatUsd?: number; perSecondUsd?: number }

// Screenshot price per delivered image; the displayed USD price is used without
// applying the gateway multiplier again. `doubao` is the legacy name for this SKU.
const SEEDREAM_LITE_USD_PER_IMAGE = 0.04
const SEEDREAM_IMAGE_RATE_KEYS = ['first_frame', 'middle_frame', 'last_frame', 'image', 'reference'].flatMap(type => ['seedream-5-0-lite', 'doubao'].map(provider => `${type}:${provider}`))

// Legacy admission hints only; never used to settle supplier costs. Dispatch
// reserves the model-pricing budget and chargeModelUsage settles real usage.
// BILLING_POINT_RATE_OVERRIDES_JSON only adjusts these early admission hints:
// {"video:seedance":{"perSecondPoints":9},"first_frame":{"flatPoints":6}}
export const DEFAULT_BILLING_POINT_RATES: Record<string, BillingPointRate> = {
    first_frame: { flatPoints: 5 },
    middle_frame: { flatPoints: 5 },
    last_frame: { flatPoints: 5 },
    image: { flatPoints: 5 },
    reference: { flatPoints: 5 },
    video: { perSecondPoints: 8 },
    'video:seedance': { perSecondPoints: 8 },
    'video:seedance25': { perSecondPoints: 8 },
    'video:wanx': { perSecondPoints: 12 },
    'video:wan3': { perSecondPoints: 8.4 },
    'video:wan3prime': { perSecondPoints: 25.2 },
    'video:kling': { perSecondPoints: 8 },
    compose: { flatPoints: 0 },
    merge: { flatPoints: 0 },
    ...Object.fromEntries(SEEDREAM_IMAGE_RATE_KEYS.map(key => [key, { flatPoints: new Prisma.Decimal(SEEDREAM_LITE_USD_PER_IMAGE).times(POINTS_PER_USD).toNumber() }]))
}

const DEFAULT_PRODUCTION_COST_RATES_USD: Record<string, ProductionCostRate> = {
    first_frame: { flatUsd: 0.05 },
    middle_frame: { flatUsd: 0.05 },
    last_frame: { flatUsd: 0.05 },
    image: { flatUsd: 0.05 },
    reference: { flatUsd: 0.05 },
    video: { perSecondUsd: 0.08 },
    'video:seedance': { perSecondUsd: 0.08 },
    'video:seedance25': { perSecondUsd: 0.08 },
    'video:wanx': { perSecondUsd: 0.12 },
    'video:wan3': { perSecondUsd: 0.084 },
    'video:wan3prime': { perSecondUsd: 0.252 },
    compose: { flatUsd: 0 },
    merge: { flatUsd: 0 },
    ...Object.fromEntries(SEEDREAM_IMAGE_RATE_KEYS.map(key => [key, { flatUsd: SEEDREAM_LITE_USD_PER_IMAGE }]))
}

/** Round a complete debit, never its individual rates or usage components. */
function roundUpUsagePoints(value: number | Prisma.Decimal): number {
    const amount = new Prisma.Decimal(value)
    if (!amount.isFinite()) throw new BillingError('消费金币数量无效')
    return Math.max(0, amount.ceil().toNumber())
}

function wholePointBalance(value: { toString(): string } | number | string | null | undefined): number {
    const amount = new Prisma.Decimal(value?.toString() ?? 0)
    return amount.isFinite() ? amount.floor().toNumber() : 0
}

function wholePointAmount(value: { toString(): string } | number | string | null | undefined): number {
    const amount = new Prisma.Decimal(value?.toString() ?? 0)
    if (!amount.isFinite()) return 0
    return (amount.isNegative() ? amount.floor() : amount.ceil()).toNumber()
}

function decimalNumber(value: { toString(): string } | number | string | null | undefined): number {
    const result = Number(value ?? 0)
    return Number.isFinite(result) ? Number(result.toFixed(6)) : 0
}

const MAX_RECHARGE_MEMO_BYTES = 2 * 1024

export function normalizeRechargeOrderMemo(value: unknown): string {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') throw new BillingError('订单 memo 必须是字符串')
    if (Buffer.byteLength(value, 'utf8') > MAX_RECHARGE_MEMO_BYTES) throw new BillingError('订单 memo 不能超过 2KB')
    return value
}

function rechargeOrderMetaObject(value: unknown): Prisma.InputJsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    try {
        return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject
    } catch {
        return {}
    }
}

/** New orders keep their quote across retries/deploys; unquoted legacy unpaid orders use the current rate. */
export function rechargeCreditForOrder(order: { paymentAmountUsd: { toString(): string } | number | string; metadata?: unknown }) {
    const metadata = rechargeOrderMetaObject(order.metadata)
    const pointsPerUsd = metadata.pointsPerUsd ?? POINTS_PER_USD
    if (typeof pointsPerUsd !== 'number' || !Number.isFinite(pointsPerUsd) || pointsPerUsd <= 0) throw new BillingError('充值订单的金币兑换比例无效', 409)
    const creditedPoints = roundUpUsagePoints(new Prisma.Decimal(order.paymentAmountUsd.toString()).times(pointsPerUsd))
    if (!Number.isFinite(creditedPoints) || creditedPoints <= 0 || (metadata.creditedPoints !== undefined && metadata.creditedPoints !== creditedPoints)) {
        throw new BillingError('充值订单的到账金币与金额不一致', 409)
    }
    return { pointsPerUsd, creditedPoints }
}

export function walletRechargeMode(): 'demo' | 'disabled' {
    return 'disabled'
}

export function walletBillingEnabled(): boolean {
    return false
}

/** One-time welcome credit per platform account, tracked by the bonus ledger. */
export const NEW_USER_BONUS_POINTS = 3_000

/**
 * Credit the new-user wallet bonus with a stable ledger key.
 *
 * Called on every verified login: upstream registration may already have
 * completed before this platform's first login or a failed credit attempt.
 * The ledger key, not the upstream registration flag, prevents repeat credit.
 * Bonus coins are not counted as paid top-ups.
 */
export async function grantNewUserBonus(userId: bigint) {
    const idempotencyKey = `welcome-bonus:${userId.toString()}`

    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } })
    if (existing) {
        if (existing.userId !== userId) throw new BillingError('注册赠送流水标识已被使用', 409)
        return { granted: false as const, balancePoints: wholePointBalance(existing.balanceAfterPoints) }
    }

    try {
        const result = await prisma.$transaction(async tx => {
            await tx.walletAccount.upsert({
                where: { userId },
                update: {},
                create: { id: genId(), userId }
            })

            const duplicate = await tx.walletTransaction.findUnique({ where: { idempotencyKey } })
            if (duplicate) {
                if (duplicate.userId !== userId) throw new BillingError('注册赠送流水标识已被使用', 409)
                return { granted: false as const, balancePoints: wholePointBalance(duplicate.balanceAfterPoints) }
            }

            const account = await tx.walletAccount.update({
                where: { userId },
                data: { balancePoints: { increment: NEW_USER_BONUS_POINTS } }
            })
            await tx.walletTransaction.create({
                data: {
                    id: genId(),
                    userId,
                    type: 'bonus',
                    amountPoints: NEW_USER_BONUS_POINTS,
                    balanceAfterPoints: account.balancePoints,
                    sourceType: 'welcome_bonus',
                    sourceId: userId.toString(),
                    idempotencyKey,
                    description: `新用户注册赠送 ${NEW_USER_BONUS_POINTS} 金币`,
                    metadata: { reason: 'new_user_registration', bonusPoints: NEW_USER_BONUS_POINTS }
                }
            })
            return { granted: true as const, balancePoints: wholePointBalance(account.balancePoints) }
        }, BILLING_TRANSACTION_OPTIONS)
        return result
    } catch (error) {
        // A concurrent login can win the unique ledger insert. Treat that
        // race as a successful, already-applied bonus.
        if ((error as { code?: string })?.code === 'P2002') {
            const duplicate = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } })
            if (duplicate) {
                if (duplicate.userId !== userId) throw new BillingError('注册赠送流水标识已被使用', 409)
                return { granted: false as const, balancePoints: wholePointBalance(duplicate.balanceAfterPoints) }
            }
        }
        throw error
    }
}

function pointRateOverrides(): Record<string, BillingPointRate> {
    const raw = process.env.BILLING_POINT_RATE_OVERRIDES_JSON
    if (!raw) return {}
    try {
        return JSON.parse(raw) as Record<string, BillingPointRate>
    } catch {
        console.error('[billing] ignored invalid point rate JSON')
        return {}
    }
}

function productionCostOverrides(): Record<string, ProductionCostRate> {
    const raw = process.env.PRODUCTION_COST_RATES_JSON
    if (!raw) return {}
    try {
        return JSON.parse(raw) as Record<string, ProductionCostRate>
    } catch {
        console.error('[billing] ignored invalid production cost rate JSON')
        return {}
    }
}

export function quoteGenerationPoints(type: string, provider: string, durationSeconds = 0): number | null {
    // "illustrations" is an orchestration record; its first/middle frame child
    // generations are billed individually, so the wrapper must stay free.
    if (type === 'illustrations') return 0
    const overrides = pointRateOverrides()
    const rates = { ...DEFAULT_BILLING_POINT_RATES, ...overrides }
    const billableType = type === 'video_comparison' || type === 'video_speech_comparison' ? 'video' : type
    const billingProvider = provider === 'doubao' ? 'seedream-5-0-lite' : provider
    const rate = overrides[`${type}:${provider}`] ?? rates[`${type}:${billingProvider}`] ?? rates[`${billableType}:${billingProvider}`] ?? rates[billableType] ?? rates[billingProvider]
    if (!rate) return null
    if ([rate.flatPoints, rate.perSecondPoints].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) return null
    const billableDuration = billableType === 'video' && provider === 'kling' ? (durationSeconds > 5 ? 10 : 5) : Math.max(0, durationSeconds)
    const amount = new Prisma.Decimal(rate.flatPoints ?? 0).plus(new Prisma.Decimal(rate.perSecondPoints ?? 0).times(billableDuration))
    return amount.isFinite() ? roundUpUsagePoints(amount) : null
}

/** Historical telemetry fallback only. New completed calls store actual supplier cost. */
export function quoteGenerationCostUsd(type: string, provider: string, durationSeconds = 0): number | null {
    if (type === 'illustrations') return 0
    const overrides = productionCostOverrides()
    const rates = { ...DEFAULT_PRODUCTION_COST_RATES_USD, ...overrides }
    const billableType = type === 'video_comparison' || type === 'video_speech_comparison' ? 'video' : type
    const billingProvider = provider === 'doubao' ? 'seedream-5-0-lite' : provider
    const rate = overrides[`${type}:${provider}`] ?? rates[`${type}:${billingProvider}`] ?? rates[`${billableType}:${billingProvider}`] ?? rates[billableType] ?? rates[billingProvider]
    if (!rate) return null
    const amount = (rate.flatUsd ?? 0) + (rate.perSecondUsd ?? 0) * Math.max(0, durationSeconds)
    return Number.isFinite(amount) ? Number(amount.toFixed(6)) : null
}

export function estimateTextTokens(text: string): number {
    if (!text) return 0
    const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length
    const remaining = Math.max(0, text.length - cjk)
    return Math.max(1, Math.ceil(cjk + remaining / 4))
}

export function quoteLlmTokenPoints(inputTokens: number, outputTokens: number): number {
    const inputRate = Number(process.env.LLM_INPUT_POINTS_PER_MILLION ?? 200)
    const outputRate = Number(process.env.LLM_OUTPUT_POINTS_PER_MILLION ?? 800)
    const amount = new Prisma.Decimal(Math.max(0, inputTokens))
        .times(inputRate)
        .plus(new Prisma.Decimal(Math.max(0, outputTokens)).times(outputRate))
        .dividedBy(1_000_000)
    return roundUpUsagePoints(Prisma.Decimal.max(0.5, amount))
}

export function quoteLlmBudgetPoints(input: unknown, expectedOutputTokens: number): number {
    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    return quoteLlmTokenPoints(estimateTextTokens(inputText), expectedOutputTokens)
}

export async function chargeLlmUsage(params: { userId: bigint; jobId: string; task: string; input: unknown; output: unknown; model?: string | null; tx?: Prisma.TransactionClient }) {
    return chargeModelUsage({
        userId: params.userId,
        tx: params.tx,
        scopeKey: /^\d+:\d+$/.test(params.jobId) ? `job:${params.jobId}` : (billingScopeKey() ?? `job:${params.jobId}`),
        idempotencyKey: `usage:llm-job:${params.jobId}`,
        sourceType: 'llm_job',
        sourceId: params.jobId,
        description: `${params.task} · ${params.model ?? 'default'}`,
        metadata: { task: params.task, model: params.model ?? null }
    })
}

/** Aggregate real supplier costs once per business operation, never per poll. */
export async function chargeModelUsage(params: {
    userId: bigint
    tx?: Prisma.TransactionClient
    scopeKey?: string
    idempotencyKey: string
    sourceType: string
    sourceId: string
    description: string
    metadata?: Record<string, string | number | boolean | null>
    /**
     * Some async video suppliers return a playable file but omit the final
     * output duration from their status payload. The completed file has
     * already been probed locally, so use that measured duration only for
     * providers priced per video second; token-priced models still require
     * supplier counters.
     */
    fallbackVideoDurationSeconds?: number | null
}) {
    if (!walletBillingEnabled()) return { charged: false as const }
    const db = params.tx ?? prisma
    const existing = await db.walletTransaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } })
    if (existing) {
        if (existing.userId !== params.userId) throw new BillingError('消费请求标识已被使用', 409)
        const metadata = rechargeOrderMetaObject(existing.metadata)
        return {
            charged: true as const,
            balancePoints: wholePointBalance(existing.balanceAfterPoints),
            supplierCostUsd: typeof metadata.supplierCostUsd === 'string' ? metadata.supplierCostUsd : undefined
        }
    }
    const scopeKey = params.scopeKey ?? billingScopeKey() ?? `${params.sourceType === 'generation' ? 'generation' : 'job'}:${params.sourceId}`
    const [kind, id] = scopeKey.split(':')
    if (!/^\d+$/.test(id ?? '') || !['generation', 'job'].includes(kind)) throw new BillingError('生成计费任务标识无效', 503)
    const calls = await db.hiModelsCall.findMany({
        where: { userId: params.userId, ...(kind === 'generation' ? { generationId: BigInt(id) } : { jobId: BigInt(id), generationId: null }) },
        orderBy: { id: 'asc' }
    })
    const operations = new Map<string, ModelCallBilling>()
    for (const call of calls) {
        const entry = call.billing as unknown as ModelCallBilling | null
        if (!entry || entry.scopeKey !== scopeKey) continue
        const previous = operations.get(entry.reservationKey)
        // A later status response without usage cannot erase a completed quote.
        if (previous?.state === 'priced' && entry.state !== 'priced') continue
        operations.set(entry.reservationKey, entry)
    }
    if (!operations.size) throw new BillingError('供应商用量尚未记录，暂不能完成金币结算', 503)
    let costUsd = new Prisma.Decimal(0)
    const settledOperations = new Map<string, ModelCallBilling>()
    for (const [reservationKey, originalEntry] of operations.entries()) {
        let entry = originalEntry
        if (entry.state === 'failed') continue
        if (
            entry.state !== 'priced' &&
            entry.price.kind === 'video_seconds' &&
            params.fallbackVideoDurationSeconds !== null &&
            params.fallbackVideoDurationSeconds !== undefined &&
            Number.isFinite(params.fallbackVideoDurationSeconds) &&
            params.fallbackVideoDurationSeconds > 0
        ) {
            const costUsd = fallbackVideoCostUsd(entry, params.fallbackVideoDurationSeconds)
            if (costUsd !== null) entry = { ...entry, state: 'priced', costUsd }
        }
        if (entry.state !== 'priced' || entry.costUsd === null || !Number.isFinite(entry.costUsd) || entry.costUsd < 0) throw new BillingError('供应商用量尚未齐全，暂不能完成金币结算', 503)
        settledOperations.set(reservationKey, entry)
        costUsd = costUsd.plus(entry.costUsd)
    }
    const charged = await chargeWalletUsage({
        ...params,
        amountPoints: costUsd.times(POINTS_PER_USD).ceil().toNumber(),
        reservationScopeKey: scopeKey,
        metadata: {
            ...params.metadata,
            supplierCostUsd: costUsd.toString(),
            pointsPerUsd: POINTS_PER_USD,
            operations: settledOperations.size,
            fallbackVideoDurationSeconds: params.fallbackVideoDurationSeconds ?? null,
            priceSnapshots: JSON.stringify([...settledOperations.values()].map(entry => entry.price))
        }
    })
    return { ...charged, supplierCostUsd: costUsd.toString() }
}

/** Calculate a per-second video cost from a measured delivered file duration. */
export function fallbackVideoCostUsd(entry: Pick<ModelCallBilling, 'price'> & { meter: Pick<ModelCallBilling['meter'], 'inputVideoSeconds' | 'inputImages'> }, durationSeconds: number): number | null {
    if (entry.price.kind !== 'video_seconds' || entry.price.second === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
    const inputSeconds = Number.isFinite(entry.meter.inputVideoSeconds) ? Math.max(0, entry.meter.inputVideoSeconds) : 0
    const excessInputImages = Math.max(0, entry.meter.inputImages - (entry.price.includedInputImages ?? entry.meter.inputImages))
    const cost = new Prisma.Decimal(durationSeconds + inputSeconds)
        .times(entry.price.second)
        .plus(new Prisma.Decimal(entry.price.inputImage ?? 0).times(excessInputImages))
        .times(entry.price.usdPerCurrency ?? 1)
    return cost.isFinite() && !cost.isNegative() ? cost.toDecimalPlaces(12).toNumber() : null
}

export async function chargeGenerationUsage(generationId: bigint, tx?: Prisma.TransactionClient, fallbackVideoDurationSeconds?: number | null) {
    const row = await (tx ?? prisma).generation.findUnique({
        where: { id: generationId },
        select: { type: true, provider: true, actualDuration: true, storyboard: { select: { episode: { select: { project: { select: { userId: true } } } } } } }
    })
    if (!row) throw new BillingError('生成任务不存在', 404)
    if (['illustrations', 'compose', 'merge'].includes(row.type)) return
    const result = await chargeModelUsage({
        userId: row.storyboard.episode.project.userId,
        tx,
        scopeKey: `generation:${generationId}`,
        idempotencyKey: `usage:generation:${generationId}`,
        sourceType: 'generation',
        sourceId: String(generationId),
        description: `${row.type} · ${row.provider}`,
        metadata: { provider: row.provider, generationType: row.type },
        fallbackVideoDurationSeconds: row.type === 'video' ? (fallbackVideoDurationSeconds ?? Number(row.actualDuration ?? 0)) : null
    })
    if ('supplierCostUsd' in result && result.supplierCostUsd !== undefined) {
        await (tx ?? prisma).generation.update({ where: { id: generationId }, data: { estimatedCostUsd: new Prisma.Decimal(result.supplierCostUsd) } })
    }
    return result
}

async function ensureWalletAccount(userId: bigint) {
    return prisma.walletAccount.upsert({
        where: { userId },
        update: {},
        create: { id: genId(), userId }
    })
}

export async function getWalletBalance(userId: bigint): Promise<number> {
    const existing = await prisma.walletAccount.findUnique({
        where: { userId },
        select: { balancePoints: true }
    })
    if (existing) return wholePointBalance(existing.balancePoints)

    const created = await ensureWalletAccount(userId)
    return wholePointBalance(created.balancePoints)
}

export async function getCountryRechargeTiers(countryCode: string): Promise<RechargeTier[]> {
    const countryCfg = countryConfig(countryCode)
    const quotedRate = await getFxRate(countryCfg?.currency ?? 'USD')
    // Keep recharge usable in USD when an actual local quote is unavailable.
    // Never label USD parity as a local-currency exchange rate.
    const currency = quotedRate === null ? 'USD' : (countryCfg?.currency ?? 'USD')
    const currencySymbol = quotedRate === null ? '$' : (countryCfg?.currencySymbol ?? '$')
    const fxRate = quotedRate ?? 1_000_000
    const labels = new Map<number, string>()

    try {
        const skus = await prisma.countryRechargeSku.findMany({ where: { countryCode, enabled: true }, orderBy: { sortOrder: 'asc' } })
        for (const sku of skus) if (sku.label) labels.set(sku.amountUsdCents, sku.label)
    } catch {
        // The five canonical tiers do not depend on optional merchandising rows.
    }

    return RECHARGE_TIERS_USD.map(usd => {
        const usdCents = Math.round(usd * 100)
        const localCents = Math.ceil((usdCents * fxRate) / 1_000_000)
        return {
            skuCode: `${countryCode}_${usdCents}`,
            amountUsdCents: usdCents,
            amountLocalCents: localCents,
            displayAmount: currency === 'USD' ? `$${usd.toFixed(2)}` : formatLocalCurrency(localCents, currency),
            points: usdToPoints(usd),
            currency,
            currencySymbol,
            label: labels.get(usdCents) ?? null
        }
    })
}

export async function getWalletSnapshot(userId: bigint, countryCode = 'US') {
    await recoverTerminalModelReservations(userId)
    const account = await ensureWalletAccount(userId)
    const reserved = await prisma.walletReservation.aggregate({ where: { userId, status: 'reserved' }, _sum: { amountPoints: true } })
    const transactions = await prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10
    })
    const destinations = await walletTransactionDestinations(userId, transactions)
    const countryCfg = isValidCountry(countryCode) ? countryConfig(countryCode) : undefined
    const rechargeTiers = await getCountryRechargeTiers(countryCode)

    return {
        balancePoints: wholePointBalance(account.balancePoints),
        reservedPoints: wholePointAmount(reserved._sum.amountPoints),
        lifetimeTopupPoints: wholePointAmount(account.lifetimeTopupPoints),
        lifetimeSpentPoints: wholePointAmount(account.lifetimeSpentPoints),
        pointsPerUsd: POINTS_PER_USD,
        rechargeTiersUsd: [...RECHARGE_TIERS_USD],
        rechargeTiers,
        country: countryCfg
            ? {
                  code: countryCode,
                  currency: countryCfg.currency,
                  currencySymbol: countryCfg.currencySymbol,
                  name: countryCfg.name
              }
            : { code: countryCode, currency: 'USD', currencySymbol: '$', name: 'Unknown' },
        demoRechargeEnabled: walletRechargeMode() === 'demo',
        rechargeMode: walletRechargeMode(),
        rechargeEnabled: walletRechargeMode() !== 'disabled',
        billingEnabled: walletBillingEnabled(),
        transactions: transactions.map(transaction => ({
            id: transaction.id.toString(),
            type: transaction.type,
            amountPoints: wholePointAmount(transaction.amountPoints),
            balanceAfterPoints: wholePointBalance(transaction.balanceAfterPoints),
            status: transaction.status,
            sourceType: transaction.sourceType,
            sourceId: transaction.sourceId,
            destinationPath: destinations.get(`${transaction.sourceType}:${transaction.sourceId}`) ?? null,
            description: transaction.description,
            createdAt: transaction.createdAt.toISOString()
        }))
    }
}

export async function assertSufficientPoints(userId: bigint, amountPoints: number | null) {
    if (!walletBillingEnabled()) return
    if (amountPoints === null || !Number.isFinite(amountPoints) || amountPoints < 0) throw new BillingError('生成费用配置无效', 503)
    if (amountPoints === 0) return
    const requiredPoints = roundUpUsagePoints(amountPoints)
    const account = await ensureWalletAccount(userId)
    if (decimalNumber(account.balancePoints) + 1e-9 < requiredPoints) {
        throw new BillingError(`积分不足，本次生成预计需要 ${requiredPoints} 积分`, WALLET_RECHARGE_REQUIRED_STATUS)
    }
}

export async function assertWalletHasCoins(userId: bigint) {
    if (!walletBillingEnabled()) return
    const account = await ensureWalletAccount(userId)
    if (decimalNumber(account.balancePoints) <= 0) {
        throw new BillingError('当前账户没有可用金币，请先充值后再继续。', WALLET_RECHARGE_REQUIRED_STATUS)
    }
}

export async function chargeWalletUsage(params: {
    userId: bigint
    tx?: Prisma.TransactionClient
    amountPoints: number | null
    idempotencyKey: string
    sourceType: string
    sourceId: string
    description: string
    metadata?: Record<string, string | number | boolean | null>
    reservationScopeKey?: string
}) {
    const { userId, idempotencyKey } = params
    if (!walletBillingEnabled()) return { charged: false as const }
    if (params.amountPoints === null || !Number.isFinite(params.amountPoints) || params.amountPoints < 0) throw new BillingError('生成费用配置无效', 503)
    if (params.amountPoints === 0 && !params.reservationScopeKey) return { charged: false as const }
    const amountPoints = roundUpUsagePoints(params.amountPoints)

    const existing = await (params.tx ?? prisma).walletTransaction.findUnique({ where: { idempotencyKey } })
    if (existing) {
        if (existing.userId !== userId) throw new BillingError('消费请求标识已被使用', 409)
        return { charged: true as const, balancePoints: wholePointBalance(existing.balanceAfterPoints) }
    }

    try {
        const debit = async (tx: Prisma.TransactionClient) => {
            await tx.walletAccount.upsert({
                where: { userId },
                update: { balancePoints: { increment: 0 } },
                create: { id: genId(), userId }
            })
            // A result transaction may already have a Repeatable Read snapshot.
            // Read the current committed claim after locking the user's wallet.
            const duplicate = await tx.walletTransaction.findUnique({ where: { idempotencyKey }, select: { userId: true, balanceAfterPoints: true } })
            if (duplicate) {
                if (duplicate.userId !== userId) throw new BillingError('消费请求标识已被使用', 409)
                return { balancePoints: duplicate.balanceAfterPoints }
            }
            if (params.reservationScopeKey) await releaseReservationsInTransaction(tx, userId, params.reservationScopeKey, 'settled')
            const debited = await tx.walletAccount.updateMany({
                where: { userId, balancePoints: { gte: amountPoints } },
                data: {
                    balancePoints: { decrement: amountPoints },
                    lifetimeSpentPoints: { increment: amountPoints }
                }
            })
            if (debited.count !== 1) throw new BillingError('积分不足，生成费用未能扣除', WALLET_RECHARGE_REQUIRED_STATUS)

            const updated = await tx.walletAccount.findUniqueOrThrow({ where: { userId } })
            await tx.walletTransaction.create({
                data: {
                    id: genId(),
                    userId,
                    type: 'usage',
                    amountPoints: -amountPoints,
                    balanceAfterPoints: updated.balancePoints,
                    sourceType: params.sourceType,
                    sourceId: params.sourceId,
                    idempotencyKey,
                    description: params.description,
                    metadata: params.metadata
                }
            })
            return updated
        }
        const account = params.tx ? await debit(params.tx) : await prisma.$transaction(debit, BILLING_TRANSACTION_OPTIONS)
        return { charged: true as const, balancePoints: wholePointBalance(account.balancePoints) }
    } catch (error) {
        // An outer transaction owns rollback. Never swallow a failed statement
        // after its debit and allow the caller to commit a partial settlement.
        if (params.tx) throw error
        if ((error as { code?: string })?.code === 'P2002' || (error instanceof BillingError && error.status === WALLET_RECHARGE_REQUIRED_STATUS)) {
            const duplicate = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } })
            if (duplicate) {
                if (duplicate.userId !== userId) throw new BillingError('消费请求标识已被使用', 409)
                return { charged: true as const, balancePoints: wholePointBalance(duplicate.balanceAfterPoints) }
            }
        }
        throw error
    }
}

export function validateRechargeRequest(amountUsd: number, idempotencyKey: string) {
    const normalizedAmountUsd = normalizeRechargeAmount(amountUsd)
    if (normalizedAmountUsd === null) throw new BillingError('充值金额无效，请选择页面提供的固定金额')
    if (!/^[A-Za-z0-9:_-]{12,120}$/.test(idempotencyKey)) {
        throw new BillingError('充值请求标识无效，请刷新页面后重试')
    }
    return normalizedAmountUsd
}

export async function completeDemoRecharge(userId: bigint, amountUsd: number, idempotencyKey: string) {
    const normalizedAmountUsd = validateRechargeRequest(amountUsd, idempotencyKey)
    const creditedPoints = usdToPoints(normalizedAmountUsd)
    if (walletRechargeMode() !== 'demo') {
        throw new BillingError('测试充值渠道尚未启用', 503)
    }

    const existing = await prisma.rechargeOrder.findUnique({ where: { idempotencyKey } })
    if (existing) {
        if (existing.userId !== userId) throw new BillingError('充值请求标识已被使用', 409)
        if (decimalNumber(existing.paymentAmountUsd) !== normalizedAmountUsd || existing.provider !== 'demo') {
            throw new BillingError('充值请求与已有订单不一致', 409)
        }
        return getWalletSnapshot(userId)
    }

    try {
        await prisma.$transaction(async tx => {
            await tx.walletAccount.upsert({
                where: { userId },
                update: {},
                create: { id: genId(), userId }
            })
            const orderId = genId()
            await tx.rechargeOrder.create({
                data: {
                    id: orderId,
                    userId,
                    paymentAmountUsd: normalizedAmountUsd,
                    status: 'paid',
                    provider: 'demo',
                    idempotencyKey,
                    metadata: { provider: 'demo', pointsPerUsd: POINTS_PER_USD, creditedPoints },
                    paidAt: new Date()
                }
            })
            const account = await tx.walletAccount.update({
                where: { userId },
                data: {
                    balancePoints: { increment: creditedPoints },
                    lifetimeTopupPoints: { increment: creditedPoints }
                }
            })
            await tx.walletTransaction.create({
                data: {
                    id: genId(),
                    userId,
                    type: 'recharge',
                    amountPoints: creditedPoints,
                    balanceAfterPoints: account.balancePoints,
                    sourceType: 'recharge_order',
                    sourceId: orderId.toString(),
                    idempotencyKey: `recharge:${idempotencyKey}`,
                    description: `积分充值 ${creditedPoints} 积分`,
                    metadata: { provider: 'demo', pointsPerUsd: POINTS_PER_USD, creditedPoints }
                }
            })
        })
    } catch (error) {
        const code = (error as { code?: string })?.code
        if (code !== 'P2002') throw error
    }

    return getWalletSnapshot(userId)
}
