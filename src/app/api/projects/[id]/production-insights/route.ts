import { NextRequest } from 'next/server'
import { apiError, apiResponse, handleApiError } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { getProjectProductionInsights, runProjectQualityReview } from '@/services/production-observability'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }

async function resolveOwnedProject(req: NextRequest, params: Params['params']) {
    const userId = currentUserId(req)
    if (userId === null) return { error: apiError('login required', 401) }
    const projectId = parseApiId((await params).id)
    if (projectId === null) return { error: apiError('invalid project id', 400) }
    const guard = await assertProjectOwner(projectId, userId)
    return guard ? { error: guard } : { projectId }
}

export async function GET(req: NextRequest, { params }: Params) {
    try {
        const owned = await resolveOwnedProject(req, params)
        if ('error' in owned) return owned.error
        return apiResponse(await getProjectProductionInsights(owned.projectId))
    } catch (error) {
        return handleApiError(error, 'Failed to load production insights')
    }
}

export async function POST(req: NextRequest, { params }: Params) {
    try {
        const owned = await resolveOwnedProject(req, params)
        if ('error' in owned) return owned.error
        const body = await req.json().catch(() => ({}))
        if (body.action !== 'quality-review') return apiError('unsupported action', 400)
        const quality = await runProjectQualityReview(owned.projectId)
        const insights = await getProjectProductionInsights(owned.projectId)
        return apiResponse({ quality, insights })
    } catch (error) {
        return handleApiError(error, 'Quality review failed')
    }
}
