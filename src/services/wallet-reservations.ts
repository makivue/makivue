import { walletBillingEnabled } from './billing'
import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { BillingError } from '@/lib/billing-error'
import { Prisma } from '@/generated/prisma/client'
import { WALLET_RECHARGE_REQUIRED_STATUS } from '@/lib/wallet-gate'
import { BILLING_TRANSACTION_OPTIONS } from '@/lib/billing-transaction'

/** balancePoints is spendable balance; reservations are refundable, not revenue. */
export async function reserveModelPoints(userId: bigint, scopeKey: string, key: string, points: number, transaction?: Prisma.TransactionClient) {
    if (!walletBillingEnabled()) return
    if (!Number.isFinite(points) || points < 0) throw new BillingError('模型预留金币报价无效', 503)
    const amount = new Prisma.Decimal(points).ceil()
    const reserve = async (tx: Prisma.TransactionClient) => {
        await tx.walletAccount.upsert({ where: { userId }, update: { balancePoints: { increment: 0 } }, create: { id: genId(), userId } })
        if (await tx.walletReservation.findFirst({ where: { userId, scopeKey, status: 'settled' } })) throw new BillingError('生成任务已经结算，不能追加模型调用', 409)
        const existing = await tx.walletReservation.findUnique({ where: { key } })
        if (existing) {
            if (existing.userId !== userId || existing.scopeKey !== scopeKey) throw new BillingError('模型预留标识冲突', 409)
            if (existing.status !== 'reserved') throw new BillingError('生成操作已经结束，请创建新任务', 409)
            return
        }
        const debited = await tx.walletAccount.updateMany({ where: { userId, balancePoints: { gte: amount } }, data: { balancePoints: { decrement: amount } } })
        if (debited.count !== 1) throw new BillingError(`可用金币不足，本次模型调用需要预留 ${amount} 金币，完成后按实际费用结算`, WALLET_RECHARGE_REQUIRED_STATUS)
        await tx.walletReservation.create({ data: { id: genId(), key, userId, scopeKey, amountPoints: amount } })
    }
    if (transaction) await reserve(transaction)
    else await prisma.$transaction(reserve, BILLING_TRANSACTION_OPTIONS)
}

export async function releaseReservationsInTransaction(tx: Prisma.TransactionClient, userId: bigint, scopeKey: string, status = 'released', key?: string) {
    // Always lock wallet before reservation rows, including settlement/recovery.
    await tx.walletAccount.updateMany({ where: { userId }, data: { balancePoints: { increment: 0 } } })
    const rows = await tx.walletReservation.findMany({
        where: { userId, scopeKey, status: 'reserved', ...(key ? { key } : {}) },
        select: { id: true, amountPoints: true }
    })
    let refund = new Prisma.Decimal(0)
    for (const row of rows) {
        const changed = await tx.walletReservation.updateMany({ where: { id: row.id, status: 'reserved' }, data: { status } })
        if (changed.count === 1) refund = refund.plus(row.amountPoints)
    }
    if (refund.gt(0)) await tx.walletAccount.update({ where: { userId }, data: { balancePoints: { increment: refund } } })
    return refund
}

export async function releaseModelReservations(scopeKey: string, userId?: bigint, key?: string) {
    const rows = await prisma.walletReservation.findMany({
        where: { ...(userId !== undefined ? { userId } : {}), ...(key ? { key, scopeKey } : { OR: [{ scopeKey }, { scopeKey: { startsWith: `${scopeKey}:` } }] }), status: 'reserved' },
        select: { userId: true, scopeKey: true },
        distinct: ['userId', 'scopeKey']
    })
    for (const row of rows) await prisma.$transaction(tx => releaseReservationsInTransaction(tx, row.userId, row.scopeKey, 'released', key), BILLING_TRANSACTION_OPTIONS)
}

/** Recover durable holds after cancellation/crashes; elapsed time alone is not proof of failure. */
export async function recoverTerminalModelReservations(userId: bigint) {
    const rows = await prisma.walletReservation.findMany({ where: { userId, status: 'reserved' }, select: { scopeKey: true }, distinct: ['scopeKey'] })
    for (const { scopeKey } of rows) {
        const [kind, id] = scopeKey.split(':')
        if (!/^\d+$/.test(id ?? '')) continue
        if (kind === 'generation') {
            const generation = await prisma.generation.findUnique({ where: { id: BigInt(id) }, select: { status: true } })
            if (generation && ['failed', 'cancelled'].includes(generation.status ?? '')) await releaseModelReservations(scopeKey, userId)
        } else if (kind === 'job') {
            const jobs = await Promise.all([
                prisma.projectAiJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } }),
                prisma.refImageJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } }),
                prisma.outlineJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } }),
                prisma.chapterJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } }),
                prisma.scriptJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } }),
                prisma.storyboardJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } }),
                prisma.extractJob.findUnique({ where: { id: BigInt(id) }, select: { phase: true } })
            ])
            const existing = jobs.filter(job => job !== null)
            if (existing.length && existing.every(job => ['error', 'cancelled'].includes(job.phase ?? ''))) await releaseModelReservations(scopeKey, userId)
        }
    }
}
