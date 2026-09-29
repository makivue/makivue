import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { prisma } from '@/lib/prisma'
import { serializeHiModelsUsage } from '@/lib/himodels-usage-ledger.server'
import { apiError, apiResponse } from '@/lib/utils'

export const runtime = 'nodejs'

/** Durable, owner-only per-call history; pagination totals are never billing totals. */
export async function GET(req: Request) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const params = new URL(req.url).searchParams
    const filters: { jobId?: bigint; generationId?: bigint; cursor?: bigint } = {}
    for (const key of ['jobId', 'generationId', 'cursor'] as const) {
        const raw = params.get(key)
        if (raw === null) continue
        const id = parseApiId(raw)
        if (id === null) return apiError(`${key} 格式无效`, 400)
        filters[key] = id
    }
    const limit = Number(params.get('limit') ?? 50)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return apiError('limit 必须为 1–100 的整数', 400)
    try {
        const rows = await prisma.hiModelsCall.findMany({
            where: {
                userId,
                ...(filters.jobId ? { OR: [{ jobId: filters.jobId }, { parentJobId: filters.jobId }] } : {}),
                ...(filters.generationId ? { generationId: filters.generationId } : {}),
                ...(filters.cursor ? { id: { lt: filters.cursor } } : {})
            },
            orderBy: { id: 'desc' },
            take: limit + 1
        })
        const page = rows.slice(0, limit)
        const response = apiResponse({
            usageTrackingAvailable: true,
            calls: page.map(row => ({
                ...serializeHiModelsUsage(row),
                ledgerId: row.id.toString(),
                jobId: row.jobId?.toString() ?? null,
                parentJobId: row.parentJobId?.toString() ?? null,
                generationId: row.generationId?.toString() ?? null
            })),
            nextCursor: rows.length > limit ? page.at(-1)!.id.toString() : null
        })
        response.headers.set('Cache-Control', 'private, no-store')
        return response
    } catch {
        return apiError('HiModels 用量记录暂不可用，请确认数据库迁移已执行', 503)
    }
}
