import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/current-user'
import { apiError, apiResponse } from '@/lib/utils'
import { deleteCreatorAsset, findCreatorAssetReference } from '@/services/creator-assets'
import { parseApiId } from '@/lib/api-id'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const { id } = await params
    const assetId = parseApiId(id)
    if (assetId === null) return apiError('作品 ID 无效')
    const result = await findCreatorAssetReference(userId, assetId)
    if (!result) return apiError('作品不存在', 404)
    return apiResponse(result.asset)
}

export async function DELETE(req: NextRequest, { params }: Params) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('请先登录', 401)
    const { id } = await params
    const assetId = parseApiId(id)
    if (assetId === null) return apiError('作品 ID 无效')
    if (!(await deleteCreatorAsset(userId, assetId))) return apiError('作品不存在', 404)
    return apiResponse({ deleted: true })
}
