import { prisma } from '@/lib/prisma'
import { parseNovelSetup } from '@/lib/novel'
import type { ImageQuality } from '@/lib/image-quality'
import type { ProductionImageProvider } from '@/lib/provider-capabilities'
import { BillingError, getWalletBalance, walletBillingEnabled } from '@/services/billing'
import { buildSceneReferenceGenerationPlan } from '@/services/ai'
import { calculateAffordableBatch, quoteImageGenerationReservationPoints } from '@/services/image-reservation-quote'
import { recoverTerminalModelReservations } from '@/services/wallet-reservations'

const QUOTE_GENERATION_NONCE = '00000000-0000-4000-8000-000000000000'

export async function quoteSceneReferenceBatch(params: { userId: bigint; projectId: bigint; sceneIds: string[]; provider: ProductionImageProvider; quality: ImageQuality }) {
    await recoverTerminalModelReservations(params.userId)
    const [project, balancePoints] = await Promise.all([
        prisma.project.findFirst({
            where: { id: params.projectId, userId: params.userId, deletedAt: null },
            select: {
                novelSetup: true,
                scenes: {
                    where: { id: { in: params.sceneIds.map(id => BigInt(id)) }, deletedAt: null },
                    select: { id: true, name: true, description: true, locationPrompt: true, timeOfDay: true }
                }
            }
        }),
        getWalletBalance(params.userId)
    ])
    if (!project) throw new BillingError('项目不存在或无权访问', 404)

    const sceneById = new Map(project.scenes.map(scene => [scene.id.toString(), scene]))
    const missingSceneId = params.sceneIds.find(sceneId => !sceneById.has(sceneId))
    if (missingSceneId) throw new BillingError('场景不属于当前项目或已删除', 400)

    if (!walletBillingEnabled()) {
        return {
            requestedCount: params.sceneIds.length,
            affordableCount: params.sceneIds.length,
            balancePoints,
            requiredPoints: 0,
            affordablePoints: 0,
            minimumPoints: 0,
            affordableSceneIds: params.sceneIds
        }
    }

    const setup = parseNovelSetup(project.novelSetup)
    const quotedItems = await Promise.all(
        params.sceneIds.map(async id => {
            const scene = sceneById.get(id)!
            const plan = buildSceneReferenceGenerationPlan(scene, setup, QUOTE_GENERATION_NONCE)
            const reservationPoints = await quoteImageGenerationReservationPoints({
                provider: params.provider,
                prompt: plan.prompt,
                negativePrompt: plan.negativePrompt,
                referenceCount: plan.styleReferences.length,
                aspectRatio: plan.aspectRatio,
                quality: params.quality
            })
            return { id, reservationPoints }
        })
    )
    const affordability = calculateAffordableBatch(quotedItems, balancePoints)
    return {
        requestedCount: quotedItems.length,
        affordableCount: affordability.affordableItems.length,
        balancePoints,
        requiredPoints: affordability.requiredPoints,
        affordablePoints: affordability.affordablePoints,
        minimumPoints: affordability.minimumPoints,
        affordableSceneIds: affordability.affordableItems.map(item => item.id)
    }
}
