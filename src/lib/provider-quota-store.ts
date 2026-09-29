import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import type { ProviderQuotaBudget } from '@/lib/provider-quota-policy'

const PROVIDER_QUOTA_LEASE_MS = 60_000

/** Row locks serialize admission across every app instance, only for this short transaction. */
export async function tryAcquireProviderQuota(budgets: ProviderQuotaBudget[]): Promise<{ ids: bigint[]; retryAfterMs: number }> {
    return prisma.$transaction(
        async tx => {
            const ordered = [...budgets].sort((a, b) => a.key.localeCompare(b.key))
            for (const budget of ordered) {
                await tx.$executeRaw`INSERT INTO provider_quotas (\`key\`) VALUES (${budget.key}) ON DUPLICATE KEY UPDATE \`key\` = VALUES(\`key\`)`
                await tx.$queryRaw`SELECT \`key\` FROM provider_quotas WHERE \`key\` = ${budget.key} FOR UPDATE`
            }
            const clocks = await tx.$queryRaw<Array<{ nowMs: bigint }>>`SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED) AS nowMs`
            const now = Number(clocks[0].nowMs)
            const entries = []
            for (const budget of ordered) {
                const row = await tx.providerQuota.findUniqueOrThrow({ where: { key: budget.key } })
                await tx.providerQuotaLease.deleteMany({ where: { scopeKey: budget.key, expiresAtMs: { lte: BigInt(now) } } })
                const active = await tx.providerQuotaLease.count({ where: { scopeKey: budget.key, expiresAtMs: { gt: BigInt(now) } } })
                const windowStart = now - Number(row.windowStartMs) >= 60_000 ? now : Number(row.windowStartMs)
                const usedTokens = windowStart === now ? 0 : Number(row.tokenBudget)
                const tokenDelay = budget.tokensPerMinute && usedTokens + budget.tokens > budget.tokensPerMinute ? windowStart + 60_000 - now : 0
                entries.push({ budget, windowStart, usedTokens, retryAfterMs: Math.max(active >= budget.concurrency ? 2_000 : 0, Number(row.nextStartAtMs) - now, tokenDelay) })
            }
            const retryAfterMs = Math.max(0, ...entries.map(entry => entry.retryAfterMs))
            if (retryAfterMs > 0) return { ids: [], retryAfterMs }
            const ids: bigint[] = []
            for (const { budget, windowStart, usedTokens } of entries) {
                const id = genId()
                await tx.providerQuotaLease.create({ data: { id, scopeKey: budget.key, expiresAtMs: BigInt(now + PROVIDER_QUOTA_LEASE_MS) } })
                await tx.providerQuota.update({
                    where: { key: budget.key },
                    data: {
                        nextStartAtMs: BigInt(now + Math.ceil(60_000 / budget.requestsPerMinute)),
                        windowStartMs: BigInt(windowStart),
                        tokenBudget: BigInt(usedTokens + budget.tokens)
                    }
                })
                ids.push(id)
            }
            return { ids, retryAfterMs: 0 }
        },
        // Renewals can commit while this transaction owns the quota row.
        // Count their latest expiry, not an older REPEATABLE READ snapshot.
        { maxWait: 5_000, timeout: 5_000, isolationLevel: 'ReadCommitted' }
    )
}

export async function renewProviderQuota(ids: bigint[]): Promise<boolean> {
    return prisma.$transaction(async tx => {
        const clocks = await tx.$queryRaw<Array<{ nowMs: bigint }>>`SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED) AS nowMs`
        const now = clocks[0].nowMs
        const result = await tx.providerQuotaLease.updateMany({ where: { id: { in: ids }, expiresAtMs: { gt: now } }, data: { expiresAtMs: now + BigInt(PROVIDER_QUOTA_LEASE_MS) } })
        return result.count === ids.length
    })
}

export async function releaseProviderQuota(ids: bigint[]) {
    await prisma.providerQuotaLease.deleteMany({ where: { id: { in: ids } } })
}
