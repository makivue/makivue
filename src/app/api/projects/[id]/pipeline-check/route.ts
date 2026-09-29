import { NextRequest } from 'next/server'
import { apiResponse, apiError } from '@/lib/utils'
import { getProjectPipelineReport } from '@/services/pipeline'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const idNum = parseApiId(id)
    if (idNum === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(idNum, userId)
    if (guard) return guard
    try {
        const report = await getProjectPipelineReport(idNum)
        return apiResponse(report)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return apiError(msg, msg === 'Project not found' ? 404 : 500)
    }
}
