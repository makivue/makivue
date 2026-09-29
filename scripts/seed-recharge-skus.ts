import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { RECHARGE_TIERS_USD, usdCentsToPoints } from '@/lib/recharge'
import { SUPPORTED_COUNTRIES } from '@/lib/country-config'

// All supported countries share the canonical USD tiers. Historical rows remain intact.
const DEFAULT_SKUS = Object.fromEntries(
    Object.keys(SUPPORTED_COUNTRIES).map(country => [
        country,
        RECHARGE_TIERS_USD.map((usd, index) => ({
            skuCode: country + '_' + usd * 100,
            amountUsdCents: usd * 100,
            sortOrder: index + 1,
            label: usd === 100 ? '热门' : usd === 1000 ? '超值' : undefined
        }))
    ])
)

async function seedRechargeSkus() {
    let created = 0
    let updated = 0

    for (const [countryCode, skus] of Object.entries(DEFAULT_SKUS)) {
        for (const sku of skus) {
            const existing = await prisma.countryRechargeSku.findUnique({ where: { skuCode: sku.skuCode } })
            if (existing) {
                await prisma.countryRechargeSku.update({
                    where: { skuCode: sku.skuCode },
                    data: {
                        countryCode,
                        amountUsdCents: sku.amountUsdCents,
                        points: usdCentsToPoints(sku.amountUsdCents),
                        sortOrder: sku.sortOrder,
                        label: sku.label ?? null,
                        enabled: true,
                        updatedAt: new Date()
                    }
                })
                updated++
            } else {
                await prisma.countryRechargeSku.create({
                    data: {
                        id: genId(),
                        countryCode,
                        skuCode: sku.skuCode,
                        amountUsdCents: sku.amountUsdCents,
                        points: usdCentsToPoints(sku.amountUsdCents),
                        sortOrder: sku.sortOrder,
                        label: sku.label ?? null,
                        enabled: true
                    }
                })
                created++
            }
        }
    }

    console.log(`Seeded country_recharge_skus: ${created} created, ${updated} updated (${Object.keys(DEFAULT_SKUS).length} countries)`)
}

seedRechargeSkus()
    .then(() => {
        console.log('Seed complete.')
        process.exit(0)
    })
    .catch(error => {
        console.error('Seed failed:', error)
        process.exit(1)
    })
