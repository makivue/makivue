import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, apiResponse } from '@/lib/utils'
import { currentUserId } from '@/lib/current-user'
import { assertProjectOwner } from '@/lib/ownership'
import { parseApiId } from '@/lib/api-id'
import { clearProjectExtractedEntitiesInTransaction } from '@/services/extracted-entities'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const userId = currentUserId(req)
    if (userId === null) return apiError('login required', 401)
    const { id } = await ctx.params
    const projectId = parseApiId(id)
    if (projectId === null) return apiError('项目 ID 格式无效', 400)
    const guard = await assertProjectOwner(projectId, userId)
    if (guard) return guard

    const result = await prisma.$transaction(tx => clearProjectExtractedEntitiesInTransaction(tx, projectId))
    return apiResponse(result)
}
