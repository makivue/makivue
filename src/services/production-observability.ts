import { prisma } from '@/lib/prisma'
import { genId } from '@/lib/id'
import { chargeGenerationUsage, quoteGenerationCostUsd } from '@/services/billing'
import { releaseModelReservations } from './wallet-reservations'
import type { ProductionVideoProvider, VideoProviderFeedback, VideoProviderFeedbackStat } from '@/lib/video-production-plan'
import { HIMODELS_VIDEO_MODELS } from '@/lib/himodels-models'
import { reviewShotReadiness } from '@/lib/shot-readiness'
import { isAvailableProductionVideoProvider } from '@/lib/provider-capabilities'

const OBSERVED_VIDEO_PROVIDERS: ProductionVideoProvider[] = ['seedance', 'seedance25', 'wanx', 'wan3', 'wan3prime', 'veo3', ...HIMODELS_VIDEO_MODELS]

export type ProductionStage = 'frame' | 'video' | 'compose' | 'merge' | 'storyboard' | 'reference' | 'unknown'
type QualitySeverity = 'blocker' | 'warning' | 'info'
type RedoStage = 'storyboard' | 'reference' | 'frame' | 'video' | 'compose' | 'merge'

export interface QualityIssue {
    code: string
    severity: QualitySeverity
    stage: RedoStage
    message: string
    evidence?: string
    episodeNumber?: number
    storyboardOrder?: number
    storyboardId?: string
}

export interface RedoAction {
    stage: RedoStage
    reasonCodes: string[]
    label: string
    targets: Array<{ episodeNumber?: number; storyboardOrder?: number; storyboardId?: string }>
}

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

export async function getVideoProviderRoutingFeedback(windowDays = 30): Promise<{
    windowDays: number
    generatedAt: string
    providers: VideoProviderFeedback
}> {
    const normalizedWindowDays = Math.max(1, Math.min(90, Math.round(windowDays)))
    const since = new Date(Date.now() - normalizedWindowDays * 24 * 60 * 60 * 1000)
    try {
        const [events, reviews] = await Promise.all([
            prisma.productionEvent.findMany({
                where: { stage: 'video', createdAt: { gte: since }, provider: { in: OBSERVED_VIDEO_PROVIDERS }, status: { in: ['completed', 'failed'] } },
                select: { provider: true, status: true, durationMs: true, costUsd: true, storyboardId: true, generationId: true }
            }),
            prisma.qualityReview.findMany({
                where: { scope: 'storyboard', createdAt: { gte: since }, storyboardId: { not: null } },
                orderBy: { createdAt: 'desc' },
                select: { storyboardId: true, generationId: true, score: true }
            })
        ])
        const latestQualityByGeneration = new Map<string, number>()
        const latestQualityByStoryboard = new Map<string, number>()
        for (const review of reviews) {
            const generationKey = review.generationId?.toString()
            if (generationKey && !latestQualityByGeneration.has(generationKey)) latestQualityByGeneration.set(generationKey, Number(review.score))
            const key = review.storyboardId?.toString()
            if (key && !latestQualityByStoryboard.has(key)) latestQualityByStoryboard.set(key, Number(review.score))
        }
        const providers: VideoProviderFeedback = {}
        for (const provider of OBSERVED_VIDEO_PROVIDERS) {
            const matches = events.filter(event => event.provider === provider)
            if (matches.length === 0) continue
            const durations = matches.map(event => event.durationMs).filter((value): value is number => value !== null)
            const costs = matches.map(event => Number(event.costUsd)).filter(Number.isFinite)
            const qualityScores = matches
                .filter(event => event.status === 'completed')
                .map(event =>
                    event.generationId
                        ? (latestQualityByGeneration.get(event.generationId.toString()) ?? (event.storyboardId ? latestQualityByStoryboard.get(event.storyboardId.toString()) : undefined))
                        : event.storyboardId
                          ? latestQualityByStoryboard.get(event.storyboardId.toString())
                          : undefined
                )
                .filter((value): value is number => value !== undefined)
            const stat: VideoProviderFeedbackStat = {
                attempts: matches.length,
                successRate: matches.filter(event => event.status === 'completed').length / matches.length,
                averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
                averageCostUsd: costs.length ? Number((costs.reduce((sum, value) => sum + value, 0) / costs.length).toFixed(6)) : null,
                averageQualityScore: qualityScores.length ? Number((qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length).toFixed(2)) : null
            }
            providers[provider] = stat
        }
        return { windowDays: normalizedWindowDays, generatedAt: new Date().toISOString(), providers }
    } catch (error) {
        console.warn('[production-observability] video routing feedback unavailable, using rule-only recommendation:', error instanceof Error ? error.message : error)
        return { windowDays: normalizedWindowDays, generatedAt: new Date().toISOString(), providers: {} }
    }
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

function percentile(values: number[], ratio: number): number | null {
    if (values.length === 0) return null
    const sorted = values.slice().sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

export async function getProjectProductionInsights(projectId: bigint) {
    await reconcileGenerationTelemetry(projectId)
    const [events, project, latestProjectReview] = await Promise.all([
        prisma.productionEvent.findMany({ where: { projectId, stage: { not: 'audio' } }, orderBy: { createdAt: 'desc' } }),
        prisma.project.findUnique({
            where: { id: projectId },
            include: {
                episodes: {
                    where: { deletedAt: null },
                    include: { storyboards: { where: { deletedAt: null }, select: { id: true, firstFrameUrl: true, videoUrl: true, composedVideoUrl: true } } }
                }
            }
        }),
        prisma.qualityReview.findFirst({ where: { projectId, scope: 'project' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!project) throw new Error('Project not found')

    const terminal = events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.status))
    const completed = terminal.filter(event => event.status === 'completed')
    const failed = terminal.filter(event => event.status === 'failed')
    const durations = terminal.map(event => event.durationMs).filter((value): value is number => value !== null)
    const totalCost = terminal.reduce((sum, event) => sum + Number(event.costUsd ?? 0), 0)
    const attempts = new Set(
        terminal.map(event => {
            const metadata = event.metadata as { generationType?: string } | null
            const mergeId = (metadata as { mergeId?: string } | null)?.mergeId
            return mergeId ? `merge:${mergeId}` : `${event.storyboardId}:${metadata?.generationType ?? event.stage}`
        })
    )
    const shots = project.episodes.flatMap(episode => episode.storyboards)
    const groupMap = new Map<string, { stage: string; provider: string; attempts: number; completed: number; failed: number; durationTotal: number; durationCount: number; costUsd: number }>()
    for (const event of terminal) {
        const key = `${event.stage}:${event.provider ?? 'unknown'}`
        const group = groupMap.get(key) ?? { stage: event.stage, provider: event.provider ?? 'unknown', attempts: 0, completed: 0, failed: 0, durationTotal: 0, durationCount: 0, costUsd: 0 }
        group.attempts += 1
        if (event.status === 'completed') group.completed += 1
        if (event.status === 'failed') group.failed += 1
        if (event.durationMs !== null) {
            group.durationTotal += event.durationMs
            group.durationCount += 1
        }
        group.costUsd += Number(event.costUsd ?? 0)
        groupMap.set(key, group)
    }

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            attempts: terminal.length,
            completed: completed.length,
            failed: failed.length,
            successRate: terminal.length ? completed.length / terminal.length : null,
            reworkAttempts: Math.max(0, terminal.length - attempts.size),
            reworkRate: terminal.length ? Math.max(0, terminal.length - attempts.size) / terminal.length : null,
            averageDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
            p95DurationMs: percentile(durations, 0.95),
            estimatedCostUsd: Number(totalCost.toFixed(6)),
            costCoverageRate: terminal.length ? terminal.filter(event => event.costUsd !== null).length / terminal.length : 0,
            episodes: project.episodes.length,
            shots: shots.length,
            frameCompletionRate: shots.length ? shots.filter(shot => shot.firstFrameUrl).length / shots.length : null,
            videoCompletionRate: shots.length ? shots.filter(shot => shot.videoUrl).length / shots.length : null,
            composeCompletionRate: shots.length ? shots.filter(shot => shot.composedVideoUrl).length / shots.length : null
        },
        groups: [...groupMap.values()].map(group => ({
            ...group,
            successRate: group.attempts ? group.completed / group.attempts : null,
            averageDurationMs: group.durationCount ? Math.round(group.durationTotal / group.durationCount) : null,
            costUsd: Number(group.costUsd.toFixed(6))
        })),
        failureCategories: Object.entries(
            failed.reduce<Record<string, number>>((acc, event) => {
                const key = event.errorCode ?? 'unknown'
                acc[key] = (acc[key] ?? 0) + 1
                return acc
            }, {})
        )
            .map(([code, count]) => ({ code, count }))
            .sort((a, b) => b.count - a.count),
        latestQuality: latestProjectReview
            ? {
                  score: Number(latestProjectReview.score),
                  status: latestProjectReview.status,
                  issueCount: latestProjectReview.issueCount,
                  blockerCount: latestProjectReview.blockerCount,
                  issues: latestProjectReview.issues,
                  redoPlan: latestProjectReview.redoPlan,
                  createdAt: latestProjectReview.createdAt
              }
            : null
    }
}

function hasOpeningEnding(value: string | null | undefined) {
    return !!value && /Opening state\s*[:\uff1a]/i.test(value) && /Ending state\s*[:\uff1a]/i.test(value)
}

function buildRedoPlan(issues: QualityIssue[]): RedoAction[] {
    const stageOrder: RedoStage[] = ['storyboard', 'reference', 'frame', 'video', 'compose', 'merge']
    return stageOrder.flatMap(stage => {
        const matches = issues.filter(issue => issue.stage === stage)
        if (matches.length === 0) return []
        const labels: Record<RedoStage, string> = {
            storyboard: '\u53ea\u91cd\u505a\u5206\u955c\u7ed3\u6784\u4e0e\u63d0\u793a\u8bcd',
            reference: '\u8865\u9f50\u6216\u91cd\u505a\u53c2\u8003\u56fe',
            frame: '\u53ea\u91cd\u505a\u955c\u5934\u63d2\u56fe',
            video: '\u4fdd\u7559\u63d2\u56fe\uff0c\u53ea\u91cd\u505a\u89c6\u9891',
            compose: '\u4fdd\u7559\u7d20\u6750\uff0c\u53ea\u91cd\u65b0\u5408\u6210',
            merge: '\u53ea\u91cd\u65b0\u5408\u5e76\u6574\u96c6'
        }
        const targets = matches
            .map(issue => ({ episodeNumber: issue.episodeNumber, storyboardOrder: issue.storyboardOrder, storyboardId: issue.storyboardId }))
            .filter(target => target.episodeNumber !== undefined || target.storyboardId !== undefined)
        return [{ stage, reasonCodes: [...new Set(matches.map(issue => issue.code))], label: labels[stage], targets }]
    })
}

export async function runProjectQualityReview(projectId: bigint) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            episodes: {
                where: { deletedAt: null },
                orderBy: { episodeNumber: 'asc' },
                include: {
                    storyboards: {
                        where: { deletedAt: null },
                        orderBy: { order: 'asc' },
                        include: { scene: true, characters: { include: { character: true } }, generations: { orderBy: { createdAt: 'desc' } } }
                    }
                }
            }
        }
    })
    if (!project) throw new Error('Project not found')

    const reviews: Array<{
        episodeId: bigint
        episodeNumber: number
        storyboardId: bigint
        generationId: bigint | null
        order: number
        score: number
        status: string
        issues: QualityIssue[]
        redoPlan: RedoAction[]
    }> = []
    for (const episode of project.episodes) {
        for (const [shotIndex, shot] of episode.storyboards.entries()) {
            const issues: QualityIssue[] = []
            const push = (issue: QualityIssue) => issues.push(issue)
            const previousShot = shotIndex > 0 ? episode.storyboards[shotIndex - 1] : null
            const latestVideoProvider = shot.generations.find(item => item.type === 'video')?.provider
            for (const issue of reviewShotReadiness(shot, previousShot ?? undefined, isAvailableProductionVideoProvider(latestVideoProvider) ? latestVideoProvider : undefined)) {
                // The existing review already reports absent prompts/states.
                if (issue.code === 'missing_image_prompt' || issue.code === 'missing_boundary') continue
                push({ code: issue.code, severity: 'warning', stage: 'storyboard', message: issue.message, evidence: issue.suggestion })
            }
            if (!shot.imagePrompt?.trim()) push({ code: 'missing_image_prompt', severity: 'blocker', stage: 'storyboard', message: '\u7f3a\u5c11\u753b\u9762\u63d0\u793a\u8bcd' })
            else if (shot.imagePrompt.trim().length < 40)
                push({
                    code: 'weak_image_prompt',
                    severity: 'warning',
                    stage: 'storyboard',
                    message: '\u753b\u9762\u63d0\u793a\u8bcd\u8fc7\u77ed',
                    evidence: `${shot.imagePrompt.trim().length} chars`
                })
            if (!hasOpeningEnding(shot.actionDesc))
                push({ code: 'missing_action_states', severity: 'warning', stage: 'storyboard', message: '\u52a8\u4f5c\u7f3a\u5c11\u5f00\u573a/\u7ed3\u675f\u72b6\u6001' })
            if (!shot.scene) push({ code: 'unbound_scene', severity: 'warning', stage: 'storyboard', message: '\u672a\u7ed1\u5b9a\u573a\u666f' })
            else if (!shot.scene.referenceImageUrl) push({ code: 'missing_scene_reference', severity: 'warning', stage: 'reference', message: '场景缺少参考图，一致性只能依赖文字约束' })
            if (shot.dialogue?.trim() && shot.characters.length === 0)
                push({ code: 'dialogue_without_character', severity: 'warning', stage: 'storyboard', message: '\u6709\u53f0\u8bcd\u4f46\u672a\u7ed1\u5b9a\u89d2\u8272' })
            const missingAppearanceLocks = shot.characters.filter(item => !item.character.appearancePrompt?.trim())
            if (missingAppearanceLocks.length)
                push({
                    code: 'missing_character_appearance_lock',
                    severity: 'warning',
                    stage: 'reference',
                    message: '角色缺少人物/服装文字锁',
                    evidence: missingAppearanceLocks.map(item => item.character.name).join(', ')
                })
            const missingCharacterRefs = shot.characters.filter(item => !item.character.referenceImageUrl)
            if (missingCharacterRefs.length)
                push({
                    code: 'missing_character_reference',
                    severity: 'warning',
                    stage: 'reference',
                    message: '\u955c\u5934\u89d2\u8272\u7f3a\u5c11\u53c2\u8003\u56fe',
                    evidence: missingCharacterRefs.map(item => item.character.name).join(', ')
                })
            if (!shot.firstFrameUrl) push({ code: 'missing_frame', severity: 'blocker', stage: 'frame', message: '\u7f3a\u5c11\u4e3b\u63d2\u56fe' })
            else if (!/^https?:\/\//i.test(shot.firstFrameUrl)) push({ code: 'frame_not_public', severity: 'warning', stage: 'frame', message: '\u63d2\u56fe\u4e0d\u662f\u516c\u7f51 URL' })
            const isContinuous = shot.continuityMode === 'stateful' || shot.continuityMode === 'continuous' || shot.continuityMode === 'seamless'
            if (!shot.continuityState) {
                push({
                    code: 'missing_continuity_state',
                    severity: 'warning',
                    stage: 'storyboard',
                    message: '镜头缺少结构化连续性状态；重新生成主插图时会自动补齐'
                })
            }
            const latestOpeningFrame = shot.generations.find(item => item.type === 'first_frame' && item.status === 'completed')
            let latestOpeningRequest: { previousContinuityMode?: string | null } | null = null
            try {
                latestOpeningRequest = latestOpeningFrame?.requestBody ? JSON.parse(latestOpeningFrame.requestBody) : null
            } catch {}
            const previousEndingAnchor = previousShot?.plannedLastFrameUrl ?? previousShot?.actualVideoEndFrameUrl ?? previousShot?.lastFrameUrl
            if (isContinuous && shot.firstFrameUrl && previousEndingAnchor && !latestOpeningRequest?.previousContinuityMode) {
                push({
                    code: 'continuity_anchor_not_applied',
                    severity: 'warning',
                    stage: 'frame',
                    message: shot.continuityMode === 'stateful' ? '剧情连续镜头已有上一镜规划末图，但当前首帧未继承场景与人物状态' : '连续镜头已有上一镜规划末图，但当前首帧生成记录未使用该锚点',
                    evidence: `previous shot ${previousShot?.order ?? 'unknown'}`
                })
            }
            const openingMetrics = latestOpeningFrame?.metrics as {
                continuityInspection?: { overallScore?: number; identityScore?: number; wardrobeScore?: number; sceneScore?: number; lightingScore?: number; issues?: string[] }
                referenceConsistencyInspection?: { overallScore?: number; identityScore?: number; wardrobeScore?: number; sceneScore?: number; shotScore?: number; issues?: string[] }
            } | null
            const continuityMetrics = openingMetrics?.continuityInspection
            if (isContinuous && continuityMetrics && Number(continuityMetrics.overallScore ?? 0) < 75) {
                push({
                    code: 'visual_continuity_risk',
                    severity: 'warning',
                    stage: 'frame',
                    message: '人物、服装、场景或光线连续性需要人工复核',
                    evidence: `总分 ${continuityMetrics.overallScore ?? 0}；人物 ${continuityMetrics.identityScore ?? 0}，服装 ${continuityMetrics.wardrobeScore ?? 0}，场景 ${continuityMetrics.sceneScore ?? 0}，光线 ${continuityMetrics.lightingScore ?? 0}${continuityMetrics.issues?.length ? `；${continuityMetrics.issues.join('；')}` : ''}`
                })
            }
            const referenceMetrics = openingMetrics?.referenceConsistencyInspection
            if (referenceMetrics && Number(referenceMetrics.overallScore ?? 0) < 75) {
                push({
                    code: 'reference_consistency_risk',
                    severity: 'warning',
                    stage: 'frame',
                    message: '当前首帧与人物/服装/场景参考或镜头要求存在偏差，需要人工复核',
                    evidence: `总分 ${referenceMetrics.overallScore ?? 0}；人物 ${referenceMetrics.identityScore ?? 0}，服装 ${referenceMetrics.wardrobeScore ?? 0}，场景 ${referenceMetrics.sceneScore ?? 0}，镜头 ${referenceMetrics.shotScore ?? 0}${referenceMetrics.issues?.length ? `；${referenceMetrics.issues.join('；')}` : ''}`
                })
            }
            if (shot.firstFrameUrl && !shot.videoUrl) push({ code: 'missing_video', severity: 'blocker', stage: 'video', message: '\u6709\u63d2\u56fe\u4f46\u7f3a\u5c11\u955c\u5934\u89c6\u9891' })
            const latestCompletedVideo = shot.generations.find(item => item.type === 'video' && item.status === 'completed')
            const videoQuality = (
                latestCompletedVideo?.metrics as {
                    videoQuality?: {
                        status?: string
                        meanFrameDifference?: number
                        activeMotionRatio?: number
                        blackRatio?: number
                        reasons?: string[]
                    }
                } | null
            )?.videoQuality
            if (videoQuality?.status === 'review') {
                push({
                    code: 'video_motion_review',
                    severity: 'warning',
                    stage: 'video',
                    message: '镜头视频有效运动偏少或存在疑似黑屏，需要确认表演质量后再进入成片',
                    evidence: `${videoQuality.reasons?.join('；') ?? '质量指标待确认'}；帧差 ${videoQuality.meanFrameDifference ?? 0}，有效运动 ${Math.round((videoQuality.activeMotionRatio ?? 0) * 100)}%，黑屏 ${Math.round((videoQuality.blackRatio ?? 0) * 100)}%`
                })
            }
            const failedGeneration = shot.generations.find(item => item.status === 'failed' && item.type !== 'audio')
            if (failedGeneration)
                push({
                    code: `generation_${classifyGenerationError(failedGeneration.errorMsg) ?? 'failed'}`,
                    severity: 'warning',
                    stage: stageForGeneration(failedGeneration.type) === 'unknown' ? 'video' : (stageForGeneration(failedGeneration.type) as RedoStage),
                    message: '\u6700\u8fd1\u6709\u751f\u6210\u5931\u8d25',
                    evidence: failedGeneration.errorMsg?.slice(0, 180)
                })
            const deduction = issues.reduce((sum, issue) => sum + (issue.severity === 'blocker' ? 25 : issue.severity === 'warning' ? 8 : 2), 0)
            const score = Math.max(0, 100 - deduction)
            const status = issues.some(issue => issue.severity === 'blocker') ? 'blocked' : issues.length ? 'needs_review' : 'passed'
            const locatedIssues = issues.map(issue => ({ ...issue, episodeNumber: episode.episodeNumber, storyboardOrder: shot.order, storyboardId: shot.id.toString() }))
            reviews.push({
                episodeId: episode.id,
                episodeNumber: episode.episodeNumber,
                storyboardId: shot.id,
                generationId: latestCompletedVideo?.id ?? null,
                order: shot.order,
                score,
                status,
                issues: locatedIssues,
                redoPlan: buildRedoPlan(locatedIssues)
            })
        }
    }

    const episodeIssues: QualityIssue[] = project.episodes.flatMap(episode => {
        if (episode.storyboards.length > 0 && episode.storyboards.every(shot => !!shot.videoUrl) && !episode.videoUrl) {
            return [
                {
                    code: 'missing_episode_merge',
                    severity: 'warning' as const,
                    stage: 'merge' as const,
                    message: `第 ${episode.episodeNumber} 集所有镜头已就绪，但尚未合并整集`,
                    episodeNumber: episode.episodeNumber
                }
            ]
        }
        return []
    })
    const allIssues = [...reviews.flatMap(review => review.issues), ...episodeIssues]
    const score = reviews.length ? Math.round(reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length) : 0
    const blockerCount = allIssues.filter(issue => issue.severity === 'blocker').length
    const status = blockerCount ? 'blocked' : allIssues.length ? 'needs_review' : 'passed'
    await prisma.$transaction([
        ...reviews.map(review =>
            prisma.qualityReview.create({
                data: {
                    id: genId(),
                    projectId,
                    episodeId: review.episodeId,
                    storyboardId: review.storyboardId,
                    generationId: review.generationId,
                    scope: 'storyboard',
                    status: review.status,
                    score: review.score,
                    issueCount: review.issues.length,
                    blockerCount: review.issues.filter(issue => issue.severity === 'blocker').length,
                    issues: review.issues as unknown as object,
                    redoPlan: review.redoPlan as unknown as object
                }
            })
        ),
        prisma.qualityReview.create({
            data: {
                id: genId(),
                projectId,
                scope: 'project',
                status,
                score,
                issueCount: allIssues.length,
                blockerCount,
                issues: allIssues as unknown as object,
                redoPlan: buildRedoPlan(allIssues) as unknown as object
            }
        })
    ])
    return { score, status, issueCount: allIssues.length, blockerCount, shots: reviews, redoPlan: buildRedoPlan(allIssues) }
}
