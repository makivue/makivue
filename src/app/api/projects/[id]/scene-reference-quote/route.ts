import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { parseApiId } from '@/lib/api-id'
import { assertProjectOwner } from '@/lib/ownership'
import { apiError, apiResponse } from '@/lib/utils'
import { normalizeImageQuality } from '@/lib/image-quality'
import { isImageProvider } from '@/services/ai'
import { BillingError } from '@/services/billing'
import { quoteSceneReferenceBatch } from '@/services/scene-reference-batch-quote'

type Params = { params: Promise<{ id: string }> }
const MAX_SCENE_REFERENCE_QUOTE_SIZE = 200

function parseSceneIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCENE_REFERENCE_QUOTE_SIZE) return null
    const ids: string[] = []
    const seen = new Set<string>()
    for (const valueId of value) {
        const id = typeof valueId === 'string' ? parseApiId(valueId) : null
        if (id === null) return null
        const normalized = id.toString()
        if (seen.has(normalized)) continue
        seen.add(normalized)
        ids.push(normalized)
    }
    return ids.length > 0 ? ids : null
}

export async function POST(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const body = await req.json().catch(() => ({}))
    const sceneIds = parseSceneIds(body.sceneIds)
    if (!sceneIds) return apiError('sceneIds 必须包含有效场景列表', 400)
    if (!isImageProvider(body.provider)) return apiError('图片模型无效', 400)

    try {
        return apiResponse(
            await quoteSceneReferenceBatch({
                userId,
                projectId,
                sceneIds,
                provider: body.provider,
                quality: normalizeImageQuality(body.imageQuality)
            })
        )
    } catch (error) {
        if (error instanceof BillingError) return apiError(error.message, error.status)
        console.error('[scene-reference-quote] failed', error)
        return apiError(error instanceof Error ? error.message : '场景参考图金币核算失败', 500)
    }
}
