import { genId } from '@/lib/id'
import { prisma } from '@/lib/prisma'
import { chargeGenerationUsage, quoteGenerationCostUsd } from '@/services/billing'
import { releaseModelReservations } from './wallet-reservations'

export type ProductionStage = 'frame' | 'video' | 'compose' | 'merge' | 'storyboard' | 'reference' | 'unknown'

function stageForGeneration(type: string): ProductionStage {
    if (['first_frame', 'middle_frame', 'last_frame', 'illustrations', 'image'].includes(type)) return 'frame'
    if (type === 'video' || type === 'video_comparison' || type === 'video_speech_comparison') return 'video'
    if (type === 'compose') return 'compose'
    return 'unknown'
}

export function classifyGenerationError(message: string | null | undefined): string | null {
    if (!message) return null
    const value = message.toLowerCase()
    if (/cancel|\u53d6\u6d88|\u505c\u6b62/.test(value)) return 'cancelled'
    if (/bucket acl|no right to access this object|assumerole|accessdenied.*(?:bucket|object)/.test(value)) return 'storage_permission'
    if (/translation was empty|自动转换为.*失败|返回了空翻译|翻译被截断|wrong language/.test(value)) return 'translation'
    if (/429|rate.?limit|quota|\u9650\u6d41|\u914d\u989d/.test(value)) return 'rate_limited'
    if (/timeout|timed out|\u8d85\u65f6/.test(value)) return 'timeout'
    if (/401|403|unauthor|forbidden|api.?key|\u9274\u6743|\u6743\u9650/.test(value)) return 'authentication'
    if (/content.?policy|safety|moderation|sensitive.?content|privacyinformation|real person|\u5b89\u5168|\u5ba1\u6838|\u771f\u4eba/.test(value)) return 'content_policy'
    if (/download|upload|storage|url|network|socket|\u4e0a\u4f20|\u4e0b\u8f7d|\u7f51\u7edc/.test(value)) return 'transport'
    if (/invalid|parse|json|\u683c\u5f0f|\u89e3\u6790|\u65e0\u6548/.test(value)) return 'invalid_response'
    if (/empty|missing|not found|\u7f3a\u5c11|\u4e0d\u5b58\u5728|\u8fd4\u56de\u4e3a\u7a7a/.test(value)) return 'missing_input_or_output'
    return 'upstream_or_unknown'
}

function inferModelName(requestBody: string | null | undefined): string | null {
    if (!requestBody) return null
    try {
        const value = JSON.parse(requestBody) as Record<string, unknown>
        for (const key of ['model', 'modelName', 'model_name', 'modelId', 'model_id']) {
            if (typeof value[key] === 'string' && value[key]) return value[key] as string
        }
    } catch {}
    return null
}

export async function reconcileGenerationTelemetry(projectId: bigint): Promise<number> {
    const [generations, merges, existingMergeEvents, project] = await Promise.all([
        prisma.generation.findMany({
            where: {
                storyboard: { episode: { projectId } },
                type: { not: 'audio' },
                status: { in: ['completed', 'failed', 'cancelled'] }
            },
            include: {
                storyboard: { select: { id: true, duration: true, episodeId: true } },
                productionEvents: { where: { eventType: 'generation_terminal' }, select: { id: true }, take: 1 }
            },
            orderBy: { createdAt: 'asc' }
        }),
        prisma.videoMerge.findMany({
            where: { episode: { projectId }, status: { in: ['completed', 'failed', 'cancelled'] } },
            include: { episode: { select: { id: true } } }
        }),
        prisma.productionEvent.findMany({
            where: { projectId, stage: 'merge', eventType: { startsWith: 'merge_terminal:' } },
            select: { eventType: true }
        }),
        prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } })
    ])
    const retryIndexes = new Map<bigint, number>()
    const attemptCounts = new Map<string, number>()
    for (const generation of generations) {
        const key = `${generation.storyboardId}:${generation.type}`
        const retryIndex = attemptCounts.get(key) ?? 0
        retryIndexes.set(generation.id, retryIndex)
        attemptCounts.set(key, retryIndex + 1)
    }
    const pending = generations.filter(item => item.productionEvents.length === 0)
    for (const generation of pending) {
        const startedAt = generation.startedAt ?? generation.createdAt ?? new Date()
        const completedAt = generation.completedAt ?? generation.updatedAt ?? new Date()
        const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime())
        const retryIndex = retryIndexes.get(generation.id) ?? 0
        const costUsd =
            generation.estimatedCostUsd === null
                ? quoteGenerationCostUsd(generation.type, generation.provider, Number(generation.plannedDuration ?? generation.storyboard.duration ?? 0))
                : Number(generation.estimatedCostUsd)
        const errorCode = classifyGenerationError(generation.errorMsg)
        const modelName = generation.modelName ?? inferModelName(generation.requestBody)
        await prisma.$transaction([
            prisma.generation.update({
                where: { id: generation.id },
                data: { durationMs, completedAt, retryIndex, errorCode, estimatedCostUsd: costUsd, modelName }
            }),
            prisma.productionEvent.upsert({
                where: { eventKey: `generation:${generation.id}` },
                update: {
                    status: generation.status ?? 'unknown',
                    durationMs,
                    costUsd,
                    errorCode,
                    metadata: { generationType: generation.type, retryIndex, qualityMetrics: generation.metrics }
                },
                create: {
                    id: genId(),
                    eventKey: `generation:${generation.id}`,
                    projectId,
                    episodeId: generation.storyboard.episodeId,
                    storyboardId: generation.storyboardId,
                    generationId: generation.id,
                    eventType: 'generation_terminal',
                    stage: stageForGeneration(generation.type),
                    provider: generation.provider,
                    modelName,
                    status: generation.status ?? 'unknown',
                    durationMs,
                    costUsd,
                    errorCode,
                    metadata: { generationType: generation.type, retryIndex, qualityMetrics: generation.metrics }
                }
            })
        ])
    }
    if (project) {
        for (const generation of generations) {
            if (generation.status !== 'completed') {
                await releaseModelReservations(`generation:${generation.id}`, project.userId)
                continue
            }
            try {
                await chargeGenerationUsage(generation.id)
            } catch (billingError) {
                console.error(`[billing] failed to charge generation ${generation.id}:`, billingError)
            }
        }
    }
    const existingMergeTypes = new Set(existingMergeEvents.map(event => event.eventType))
    const pendingMerges = merges.filter(merge => !existingMergeTypes.has(`merge_terminal:${merge.id}`))
    for (const merge of pendingMerges) {
        const startedAt = merge.createdAt ?? new Date()
        const completedAt = merge.updatedAt ?? new Date()
        await prisma.productionEvent.upsert({
            where: { eventKey: `merge:${merge.id}` },
            update: {},
            create: {
                id: genId(),
                eventKey: `merge:${merge.id}`,
                projectId,
                episodeId: merge.episode.id,
                eventType: `merge_terminal:${merge.id}`,
                stage: 'merge',
                provider: 'ffmpeg',
                status: merge.status ?? 'unknown',
                durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
                errorCode: classifyGenerationError(merge.errorMsg),
                metadata: { mergeId: merge.id.toString(), durationSeconds: merge.duration === null ? null : Number(merge.duration) }
            }
        })
    }
    return pending.length + pendingMerges.length
}
